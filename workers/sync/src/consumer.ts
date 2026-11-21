/**
 * Queue consumer for "tmdb-fetch" (SPEC § 5.3). Runs with max_concurrency: 1, so its pacing IS the global
 * TMDB rate limit. Per batch: guard check → paced fetches (≤ 6 in flight) → R2 → one set of D1 batches →
 * ack/retry → usage accounting → guard post-check.
 */
import {
  buildMovieWrite,
  buildRedirect,
  buildStateUpdate,
  CRAWL_SKIP_FRESH_HOURS,
  decideState,
  type FetchFn,
  insertMany,
  normalizeMovie,
  type Stmt,
  TmdbClient,
  utcDay,
} from "@movies/tmdb";
import { readConfig, tmdbToken } from "./config";
import { describeTrip, readGuard, recordUsage, firstOverCap, tripGuard, wouldExceed, type TripInfo } from "./guard";
import type { FetchMessage } from "./messages";
import { mapLimit, Pacer } from "./pacer";
import {
  addRunCountersStmts,
  getMovieMeta,
  getPinned,
  type MovieMeta,
  putRaw,
  rawFetchedAt,
  runStatementGroups,
  runStatements,
} from "./store";
import { notify } from "./telegram";

export const MAX_IN_FLIGHT = 6; // Workers: 6 simultaneous outgoing connections per invocation

export interface ConsumerDeps {
  fetch?: FetchFn;
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

type RetryReason = "rate_limited" | "transient" | "write_failed";

interface Failure {
  reason: string;
  error: string;
}

type Outcome =
  | { kind: "ack"; counters: string[]; stmts?: Stmt[]; enqueue?: FetchMessage; failure?: Failure; sections?: number }
  | { kind: "retry"; reason: RetryReason; error?: string }
  | { kind: "park"; reason: string };

export function retryDelaySeconds(attempts: number, reason: RetryReason, random: () => number = Math.random): number {
  const base = reason === "rate_limited" ? 60 : 30;
  const exp = Math.min(1800, base * 2 ** Math.max(0, attempts - 1));
  return Math.round(exp + random() * base);
}

const log = (data: Record<string, unknown>) => console.log(JSON.stringify(data));

export async function handleFetchBatch(batch: MessageBatch<FetchMessage>, env: Env, deps: ConsumerDeps = {}): Promise<void> {
  const now = deps.now?.() ?? Date.now();
  const day = utcDay(now);
  const cfg = readConfig(env);
  const db = env.DB;
  const messages = batch.messages;

  // 1. Guard pre-check: tripped, or this batch alone would cross a cap → park everything.
  const guard = await readGuard(db, day);
  const preTrip = guard.tripped
    ? null
    : wouldExceed(guard.used, cfg.caps, { tmdb_requests: messages.length, r2_writes: messages.length });
  if (guard.tripped || preTrip) {
    if (preTrip) {
      await tripAndAlert(env, { metric: preTrip, value: guard.used[preTrip], cap: cfg.caps[preTrip], at: now, day, note: "next batch would cross the cap" });
    }
    await parkAll(db, messages, "guard_tripped", now);
    return;
  }

  // 2. Fetch + build writes.
  const syncIds = messages.filter((m) => m.body.mode === "sync").map((m) => m.body.id);
  const [meta, pinned] = await Promise.all([getMovieMeta(db, syncIds), getPinned(db, syncIds)]);
  let tmdbRequests = 0;
  let r2Writes = 0;
  let rateLimited = 0;
  const client = new TmdbClient({
    token: tmdbToken(env),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    onRequest: () => tmdbRequests++,
  });
  const pacer = new Pacer(cfg.tmdbRps, deps.now ?? Date.now, deps.sleep);
  let stopped: "rate_limited" | "auth" | null = null;
  let authError = "";

  const processOne = async (msg: Message<FetchMessage>): Promise<Outcome> => {
    const { id, mode } = msg.body;
    if (mode === "crawl") {
      const fetchedAt = await rawFetchedAt(env.RAW, id);
      if (fetchedAt && now - fetchedAt < CRAWL_SKIP_FRESH_HOURS * 3_600_000) return { kind: "ack", counters: ["skipped_fresh"] };
    }
    if (stopped) return stopped === "auth" ? { kind: "park", reason: "tmdb_auth" } : { kind: "retry", reason: "rate_limited" };
    await pacer.wait();
    if (stopped) return stopped === "auth" ? { kind: "park", reason: "tmdb_auth" } : { kind: "retry", reason: "rate_limited" };

    const res = await client.movie(id);
    if (!res.ok) {
      switch (res.kind) {
        case "rate_limited":
          stopped = "rate_limited";
          rateLimited++;
          return { kind: "retry", reason: "rate_limited" };
        case "transient":
          return { kind: "retry", reason: "transient", error: `${res.status} ${res.message}` };
        case "auth":
          stopped = "auth";
          authError = `${res.status} ${res.message}`;
          return { kind: "park", reason: "tmdb_auth" };
        case "bad_request":
          return { kind: "ack", counters: ["failed"], failure: { reason: "bad_request", error: `${res.status} ${res.message}` } };
        case "not_found":
          return handleNotFound(msg, meta.get(id) ?? null);
      }
    }

    const n = normalizeMovie(res.data);
    const existing = meta.get(id) ?? null;
    const state = decideState({ movie: n, existingState: existing?.state ?? null, pinned: pinned.has(id) });
    // Never store (in R2 or D1) a movie that doesn't qualify and isn't already ours: keeps the 90-day rule simple.
    if (!existing && state !== "active") return { kind: "ack", counters: ["not_qualified"] };

    await putRaw(env.RAW, id, res.text, now);
    r2Writes++;
    if (mode === "crawl") return { kind: "ack", counters: ["fetched"] };

    const w = buildMovieWrite(n, existing?.hashes ?? null, { syncedAt: now, now, state });
    const counters = ["fetched", w.changed.length > 0 ? "changed" : "unchanged"];
    if (state === "excluded" && existing?.state === "active") counters.push("excluded");
    if (!existing) counters.push("inserted");
    return { kind: "ack", counters, stmts: w.stmts, sections: w.changed.length };
  };

  const handleNotFound = async (msg: Message<FetchMessage>, existing: MovieMeta | null): Promise<Outcome> => {
    const { id, mode, runId } = msg.body;
    if (mode === "crawl" || !existing || existing.state === "deleted") return { kind: "ack", counters: ["not_found"] };
    const stmts: Stmt[] = [buildStateUpdate(id, "deleted", now)];
    const lookups: ["imdb_id" | "wikidata_id", string | null, "imdb" | "wikidata"][] = [
      ["imdb_id", existing.imdbId, "imdb"],
      ["wikidata_id", existing.wikidataId, "wikidata"],
    ];
    for (const [source, value, method] of lookups) {
      if (!value) continue;
      await pacer.wait();
      const found = await client.find(value, source);
      if (!found.ok) {
        if (found.kind === "rate_limited" || found.kind === "transient") return { kind: "retry", reason: found.kind };
        continue;
      }
      const candidates = found.data.movie_results.filter((m) => m.id !== id);
      if (candidates.length === 1) {
        const newId = candidates[0]!.id;
        stmts.push(buildRedirect(id, newId, method, now));
        return {
          kind: "ack",
          counters: ["deleted", "redirected"],
          stmts,
          enqueue: { id: newId, mode: "sync", reason: "redirect", runId },
        };
      }
      if (candidates.length > 1) break; // ambiguous → manual review
    }
    return {
      kind: "ack",
      counters: ["deleted", "needs_review"],
      stmts,
      failure: { reason: "deleted_unmatched", error: "404 and no unique /find match by imdb_id/wikidata_id" },
    };
  };

  const outcomes = await mapLimit(messages, MAX_IN_FLIGHT, async (msg) => {
    try {
      return await processOne(msg);
    } catch (e) {
      return { kind: "retry", reason: "transient", error: e instanceof Error ? e.message : String(e) } satisfies Outcome;
    }
  });

  // 3. One write phase for the whole batch. If D1 fails, those messages are retried (R2 writes are idempotent).
  let rowsWritten = 0;
  const writeIdx = outcomes.flatMap((o, i) => (o.kind === "ack" && o.stmts?.length ? [i] : []));
  try {
    rowsWritten = await runStatementGroups(db, writeIdx.map((i) => (outcomes[i] as Extract<Outcome, { kind: "ack" }>).stmts!));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ message: "D1 write failed, retrying batch writes", error }));
    for (const i of writeIdx) outcomes[i] = { kind: "retry", reason: "write_failed", error };
  }

  // 4. Follow-ups: redirect targets, failures, parked, run counters.
  const followUps = outcomes.flatMap((o) => (o.kind === "ack" && o.enqueue ? [o.enqueue] : []));
  if (followUps.length > 0) await env.FETCH_QUEUE.sendBatch(followUps.map((body) => ({ body })));

  const bookkeeping: Stmt[] = [];
  const failures = outcomes.flatMap((o, i) => (o.kind === "ack" && o.failure ? [{ msg: messages[i]!, f: o.failure }] : []));
  bookkeeping.push(
    ...insertMany(
      "tmdb_sync_failures",
      ["movie_id", "run_id", "reason", "error", "attempts", "created_at"],
      failures.map(({ msg, f }) => [msg.body.id, msg.body.runId, f.reason, f.error, msg.attempts, now]),
    ),
  );
  const parked = outcomes.flatMap((o, i) => (o.kind === "park" ? [{ msg: messages[i]!, reason: o.reason }] : []));
  bookkeeping.push(...parkStmts(parked.map((p) => p.msg), parked[0]?.reason ?? "", now));

  const perRun = new Map<string, Record<string, number>>();
  const bump = (runId: string, metric: string, by = 1) => {
    const c = perRun.get(runId) ?? {};
    c[metric] = (c[metric] ?? 0) + by;
    perRun.set(runId, c);
  };
  outcomes.forEach((o, i) => {
    const runId = messages[i]!.body.runId;
    if (o.kind === "ack") {
      bump(runId, "processed");
      for (const c of o.counters) bump(runId, c);
      if (o.sections) bump(runId, "sections_changed", o.sections);
      if (o.enqueue) bump(runId, "enqueued_extra");
    } else if (o.kind === "park") {
      bump(runId, "processed");
      bump(runId, "parked");
    } else {
      bump(runId, "retried");
      if (o.reason === "rate_limited") bump(runId, "rate_limited");
    }
  });
  for (const [runId, c] of perRun) bookkeeping.push(...addRunCountersStmts(runId, c));
  try {
    rowsWritten += await runStatements(db, bookkeeping);
  } catch (e) {
    console.error(JSON.stringify({ message: "bookkeeping write failed", error: e instanceof Error ? e.message : String(e) }));
  }

  // 5. Ack / retry.
  outcomes.forEach((o, i) => {
    const msg = messages[i]!;
    if (o.kind === "retry") msg.retry({ delaySeconds: retryDelaySeconds(msg.attempts, o.reason, deps.random) });
    else msg.ack();
  });

  // 6. Usage accounting + guard post-check.
  const totals = await recordUsage(db, day, { tmdb_requests: tmdbRequests, r2_writes: r2Writes, d1_rows_written: rowsWritten });
  log({ message: "batch done", size: messages.length, tmdbRequests, r2Writes, rowsWritten, rateLimited, today: totals });
  const over = firstOverCap(totals, cfg.caps);
  if (over) await tripAndAlert(env, { metric: over, value: totals[over], cap: cfg.caps[over], at: now, day });
  if (stopped === "auth") await tripAndAlert(env, { metric: "tmdb_auth", value: 1, cap: null, at: now, day, note: authError });
}

function parkStmts(msgs: Message<FetchMessage>[], reason: string, now: number): Stmt[] {
  return insertMany(
    "tmdb_parked",
    ["movie_id", "reason", "parked_at"],
    msgs.map((m) => [m.body.id, reason, now]),
    "ON CONFLICT(movie_id) DO NOTHING",
  );
}

async function parkAll(db: D1Database, messages: readonly Message<FetchMessage>[], reason: string, now: number): Promise<void> {
  const counters = new Map<string, number>();
  for (const m of messages) counters.set(m.body.runId, (counters.get(m.body.runId) ?? 0) + 1);
  await runStatements(db, [
    ...parkStmts([...messages], reason, now),
    ...[...counters].flatMap(([runId, n]) => addRunCountersStmts(runId, { processed: n, parked: n })),
  ]);
  for (const m of messages) m.ack();
}

async function tripAndAlert(env: Env, info: TripInfo): Promise<void> {
  if (await tripGuard(env.DB, info)) {
    await notify(
      env,
      `🛑 movies-sync circuit breaker tripped: ${describeTrip(info)}.\n` +
        "All work is parked until a manual resume (docs/RUNBOOK.md → Resume after the guard tripped).",
    );
  }
}
