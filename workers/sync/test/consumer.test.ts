import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { syntheticMovie } from "../../../packages/tmdb/test/fixtures/synthetic";
import { handleFetchBatch, retryDelaySeconds } from "../src/consumer";
import { handleDeadLetters } from "../src/dlq";
import { GUARD_STATE_KEY } from "../src/guard";
import type { FetchMessage } from "../src/messages";
import { getRunCounters, putRaw, rawKey } from "../src/store";
import { fakeTmdb, makeBatch, movieRoute, recordingQueue, resetStorage, scalar } from "./helpers";

const NOW = Date.UTC(2026, 10, 11, 9, 30);
const msg = (id: number, o: Partial<FetchMessage> = {}): FetchMessage => ({ id, mode: "sync", reason: "new", runId: "run-1", ...o });
const deps = (fetch: ReturnType<typeof fakeTmdb>["fetch"]) => ({ fetch, now: () => NOW, random: () => 0 });

beforeEach(resetStorage);

describe("sync mode", () => {
  it("fetches, archives to R2 and writes D1", async () => {
    const movie = syntheticMovie();
    const tmdb = fakeTmdb(movieRoute(movie));
    const { batch, messages } = makeBatch([msg(movie.id)]);

    await handleFetchBatch(batch, env, deps(tmdb.fetch));

    expect(messages[0]!.acked).toBe(true);
    expect(await scalar("SELECT state FROM tmdb_movies WHERE id = ?", movie.id)).toBe("active");
    expect(await scalar("SELECT COUNT(*) FROM tmdb_movie_credits")).toBe(18);
    const raw = await env.RAW.head(rawKey(movie.id));
    expect(raw?.customMetadata?.fetched_at).toBe(String(NOW));
    expect(await getRunCounters(env.DB, "run-1")).toMatchObject({ processed: 1, fetched: 1, inserted: 1, changed: 1 });
    expect(await scalar("SELECT value FROM tmdb_guard_counters WHERE metric = 'tmdb_requests'")).toBe(1);
    expect(await scalar<number>("SELECT value FROM tmdb_guard_counters WHERE metric = 'd1_rows_written'")).toBeGreaterThan(50);
  });

  it("an unchanged refetch only touches the movie row", async () => {
    const movie = syntheticMovie();
    const tmdb = fakeTmdb(movieRoute(movie));
    await handleFetchBatch(makeBatch([msg(movie.id)]).batch, env, deps(tmdb.fetch));
    const before = await scalar<number>("SELECT value FROM tmdb_guard_counters WHERE metric = 'd1_rows_written'");

    await handleFetchBatch(makeBatch([msg(movie.id, { reason: "sweep", runId: "run-2" })]).batch, env, deps(tmdb.fetch));

    expect(await getRunCounters(env.DB, "run-2")).toMatchObject({ unchanged: 1, processed: 1 });
    const after = await scalar<number>("SELECT value FROM tmdb_guard_counters WHERE metric = 'd1_rows_written'");
    expect(after - before).toBeLessThan(15); // movie row + its index entries + bookkeeping
  });

  it("does not store a new movie that doesn't qualify", async () => {
    const comedy = syntheticMovie({ id: 777, genres: [{ id: 35, name: "Comedy" }] });
    const { batch, messages } = makeBatch([msg(777)]);
    await handleFetchBatch(batch, env, deps(fakeTmdb(movieRoute(comedy)).fetch));
    expect(messages[0]!.acked).toBe(true);
    expect(await scalar("SELECT COUNT(*) FROM tmdb_movies")).toBe(0);
    expect(await env.RAW.head(rawKey(777))).toBeNull();
  });

  it("excludes an active movie that lost both genres, unless pinned", async () => {
    const movie = syntheticMovie();
    await handleFetchBatch(makeBatch([msg(movie.id)]).batch, env, deps(fakeTmdb(movieRoute(movie)).fetch));
    const comedy = syntheticMovie({ genres: [{ id: 35, name: "Comedy" }] });

    await handleFetchBatch(makeBatch([msg(movie.id, { reason: "changed" })]).batch, env, deps(fakeTmdb(movieRoute(comedy)).fetch));
    expect(await scalar("SELECT state FROM tmdb_movies WHERE id = ?", movie.id)).toBe("excluded");

    await env.DB.prepare("INSERT INTO tmdb_pinned_movies (movie_id, created_at) VALUES (?, ?)").bind(movie.id, NOW).run();
    await handleFetchBatch(makeBatch([msg(movie.id, { reason: "changed" })]).batch, env, deps(fakeTmdb(movieRoute(comedy)).fetch));
    expect(await scalar("SELECT state FROM tmdb_movies WHERE id = ?", movie.id)).toBe("active");
  });
});

describe("404 → deletion flow", () => {
  it("redirects via imdb_id when exactly one movie matches", async () => {
    const movie = syntheticMovie();
    await handleFetchBatch(makeBatch([msg(movie.id)]).batch, env, deps(fakeTmdb(movieRoute(movie)).fetch));
    const tmdb = fakeTmdb({ "/find/tt9000001": () => Response.json({ movie_results: [{ id: 900002 }] }) });
    const { queue, sent } = recordingQueue();

    await handleFetchBatch(makeBatch([msg(movie.id, { reason: "gone" })]).batch, { ...env, FETCH_QUEUE: queue }, deps(tmdb.fetch));

    expect(await scalar("SELECT state FROM tmdb_movies WHERE id = ?", movie.id)).toBe("deleted");
    expect(await scalar("SELECT new_id FROM tmdb_movie_redirects WHERE old_id = ?", movie.id)).toBe(900002);
    expect(sent).toEqual([{ id: 900002, mode: "sync", reason: "redirect", runId: "run-1" }]);
    expect(await getRunCounters(env.DB, "run-1")).toMatchObject({ redirected: 1, enqueued_extra: 1 });
  });

  it("flags for review when no unique match exists", async () => {
    const movie = syntheticMovie({ external_ids: { imdb_id: "tt9000001", wikidata_id: null } });
    await handleFetchBatch(makeBatch([msg(movie.id)]).batch, env, deps(fakeTmdb(movieRoute(movie)).fetch));
    const tmdb = fakeTmdb({ "/find/tt9000001": () => Response.json({ movie_results: [] }) });

    await handleFetchBatch(makeBatch([msg(movie.id, { reason: "gone" })]).batch, env, deps(tmdb.fetch));

    expect(await scalar("SELECT state FROM tmdb_movies WHERE id = ?", movie.id)).toBe("deleted");
    expect(await scalar("SELECT reason FROM tmdb_sync_failures WHERE movie_id = ?", movie.id)).toBe("deleted_unmatched");
  });
});

describe("rate limiting and errors", () => {
  it("a 429 retries the message with backoff and stops the rest of the batch", async () => {
    const tmdb = fakeTmdb({ "/movie/1": () => new Response("slow down", { status: 429 }) });
    const { batch, messages } = makeBatch([msg(1), msg(2), msg(3)]);
    await handleFetchBatch(batch, env, deps(tmdb.fetch));
    expect(messages.every((m) => m.retriedWith && !m.acked)).toBe(true);
    expect(messages[0]!.retriedWith?.delaySeconds).toBe(60);
    expect(tmdb.calls).toEqual(["/movie/1"]);
  });

  it("backoff grows exponentially and is capped", () => {
    const r = () => 0;
    expect([1, 2, 3, 6, 10].map((a) => retryDelaySeconds(a, "transient", r))).toEqual([30, 60, 120, 960, 1800]);
  });

  it("a 401 parks the batch and trips the guard", async () => {
    const tmdb = fakeTmdb({ "/movie/1": () => Response.json({ status_message: "Invalid API key" }, { status: 401 }) });
    const { batch, messages } = makeBatch([msg(1), msg(2)]);
    await handleFetchBatch(batch, env, deps(tmdb.fetch));
    expect(messages.every((m) => m.acked)).toBe(true);
    expect(await scalar("SELECT COUNT(*) FROM tmdb_parked")).toBe(2);
    expect(await scalar<string>("SELECT value FROM tmdb_sync_state WHERE key = ?", GUARD_STATE_KEY)).toContain("tmdb_auth");
  });
});

describe("spending guard", () => {
  it("parks everything without calling TMDB when tripped", async () => {
    await env.DB.prepare("INSERT INTO tmdb_sync_state (key, value, updated_at) VALUES (?, ?, ?)")
      .bind(GUARD_STATE_KEY, JSON.stringify({ metric: "d1_rows_written", value: 1, cap: 1, at: NOW, day: "2026-11-11" }), NOW)
      .run();
    const tmdb = fakeTmdb({});
    const { batch, messages } = makeBatch([msg(1), msg(2)]);
    await handleFetchBatch(batch, env, deps(tmdb.fetch));
    expect(tmdb.calls).toEqual([]);
    expect(messages.every((m) => m.acked)).toBe(true);
    expect(await getRunCounters(env.DB, "run-1")).toMatchObject({ processed: 2, parked: 2 });
  });

  it("trips before a batch that would cross a cap", async () => {
    const tmdb = fakeTmdb({});
    const { batch } = makeBatch([msg(1), msg(2)]);
    await handleFetchBatch(batch, { ...env, GUARD_MAX_TMDB_REQUESTS: "1" as "50000" }, deps(tmdb.fetch));
    expect(tmdb.calls).toEqual([]);
    expect(await scalar<string>("SELECT value FROM tmdb_sync_state WHERE key = ?", GUARD_STATE_KEY)).toContain("tmdb_requests");
  });
});

describe("crawl mode", () => {
  it("writes R2 only and skips movies archived in the last 24 h", async () => {
    const movie = syntheticMovie();
    const tmdb = fakeTmdb(movieRoute(movie));
    await handleFetchBatch(makeBatch([msg(movie.id, { mode: "crawl", reason: "bootstrap" })]).batch, env, deps(tmdb.fetch));
    expect(await env.RAW.head(rawKey(movie.id))).not.toBeNull();
    expect(await scalar("SELECT COUNT(*) FROM tmdb_movies")).toBe(0);

    await putRaw(env.RAW, 42, "{}", NOW - 3_600_000);
    const again = fakeTmdb({});
    await handleFetchBatch(makeBatch([msg(42, { mode: "crawl", reason: "bootstrap", runId: "run-9" })]).batch, env, deps(again.fetch));
    expect(again.calls).toEqual([]);
    expect(await getRunCounters(env.DB, "run-9")).toMatchObject({ skipped_fresh: 1, processed: 1 });
  });
});

describe("dead-letter queue", () => {
  it("records failures and counts them as dead for drain detection", async () => {
    const { batch, messages } = makeBatch([msg(5), msg(6)], "tmdb-fetch-dlq", 6);
    await handleDeadLetters(batch, env, NOW);
    expect(messages.every((m) => m.acked)).toBe(true);
    expect(await scalar("SELECT COUNT(*) FROM tmdb_sync_failures WHERE reason = 'retries_exhausted'")).toBe(2);
    expect(await getRunCounters(env.DB, "run-1")).toMatchObject({ dead: 2 });
  });
});
