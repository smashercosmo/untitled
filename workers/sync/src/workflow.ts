/**
 * Workflow "tmdb-sync" (SPEC § 3, § 5). Modes:
 *  - bootstrap: enumerate membership → enqueue crawl messages (R2 only), most-voted first, optional limit
 *  - daily (default, also the cron schedule): membership diff + /movie/changes + sweep + purge → enqueue sync messages
 *  - replay: re-enqueue parked messages and unresolved failures (after a guard trip / DLQ)
 * Every run waits for its messages to drain, then records the outcome and sends a Telegram summary.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  buildOrphanCleanup,
  buildPurgeMovie,
  DAY_MS,
  dayStartMs,
  DISCOVER_MAX_RESULTS,
  DISCOVER_PAGE_SIZE,
  type Member,
  mergeMembers,
  MIN_VOTE_COUNT,
  PURGE_AFTER_DAYS,
  planChangesWindow,
  planDaily,
  planVoteSlices,
  type Reason,
  slicePages,
  type Stmt,
  SWEEP_DIVISOR,
  sweepLimit,
  TmdbClient,
  utcDay,
  type VoteSlice,
} from "@movies/tmdb";
import { readConfig, tmdbToken } from "./config";
import { clearGuardStmt, describeTrip, readGuard, recordUsage } from "./guard";
import type { FetchMessage, FetchMode } from "./messages";
import { defaultSleep, Pacer } from "./pacer";
import {
  getRunCounters,
  getState,
  idFromRawKey,
  RAW_PREFIX,
  rawKey,
  refreshGenres,
  runStatements,
  setRunCounterStmt,
  setStateStmt,
} from "./store";
import { notify } from "./telegram";

export type SyncMode = "daily" | "bootstrap" | "replay";

export interface SyncParams {
  mode?: SyncMode;
  /**
   * Restrict membership to the top-N most-voted qualifying movies (local experiments with a subset).
   * bootstrap: crawl only those; daily: treat only those as members (no "new" movies beyond the subset).
   */
  limit?: number;
  /** replay only: clear a tripped guard first. */
  resetGuard?: boolean;
  /** How often to check whether the queue drained (default 300 s; use ~30 s locally). */
  drainIntervalSeconds?: number;
  /** Give up waiting after this many checks (default: 72 daily ≈ 6 h, 288 bootstrap ≈ 24 h). */
  maxDrainChecks?: number;
}

const NETWORK_STEP = {
  retries: { limit: 5, delay: "30 seconds", backoff: "exponential" },
  timeout: "20 minutes",
} as const;

const DISCOVER_FILTER = { with_genres: "27|53" } as const;
const LAST_SUCCESS_KEY = "last_success_date";

export class SyncWorkflow extends WorkflowEntrypoint<Env, SyncParams> {
  override async run(event: Readonly<WorkflowEvent<SyncParams>>, step: WorkflowStep): Promise<unknown> {
    const params: SyncParams = event.payload ?? {};
    const mode: SyncMode = params.mode ?? "daily";
    const runId = event.instanceId;
    const db = this.env.DB;

    // ---- start ----
    const start = await step.do("start run", async () => {
      const now = Date.now();
      const day = utcDay(now);
      if (!tmdbToken(this.env)) throw new NonRetryableError("TMDB token missing (set TMDB_READ_ACCESS_TOKEN)");
      if (mode === "replay" && params.resetGuard) await runStatements(db, [clearGuardStmt()]);
      const guard = await readGuard(db, day);
      await runStatements(db, [
        {
          sql: "INSERT INTO tmdb_sync_runs (run_id, mode, started_at, status) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO NOTHING",
          params: [runId, mode, now, guard.tripped ? "skipped_guard" : "running"],
        },
      ]);
      if (guard.tripped) {
        await notify(this.env, `⏸ movies-sync ${mode} run skipped: guard is tripped (${describeTrip(guard.tripped)}).`);
      }
      return { now, day, tripped: guard.tripped !== null };
    });
    if (start.tripped) return { status: "skipped_guard" };

    let planned: Record<string, number> = {};

    if (mode === "replay") {
      planned = await step.do("enqueue parked and failures", async () => {
        const { results } = await db
          .prepare(
            "SELECT movie_id AS id FROM tmdb_parked UNION SELECT DISTINCT movie_id FROM tmdb_sync_failures WHERE resolved_at IS NULL",
          )
          .all<{ id: number }>();
        const msgs = results.map((r): FetchMessage => ({ id: r.id, mode: "sync", reason: "replay", runId }));
        await this.recordEnqueued(runId, msgs.length);
        await sendAll(this.env.FETCH_QUEUE, msgs);
        await runStatements(db, [
          { sql: "DELETE FROM tmdb_parked", params: [] },
          { sql: "UPDATE tmdb_sync_failures SET resolved_at = ? WHERE resolved_at IS NULL", params: [Date.now()] },
        ]);
        return { replay: msgs.length };
      });
    } else {
      await step.do("refresh genres", NETWORK_STEP, async () => {
        const { client, usage } = this.client();
        await refreshGenres(db, client);
        await recordUsage(db, utcDay(Date.now()), usage());
      });

      let members: Member[];
      if (params.limit && params.limit <= DISCOVER_MAX_RESULTS) {
        // Local experiments: the top-N by votes come straight from discover, no full enumeration needed.
        const limit = params.limit;
        members = await step.do(`discover top ${limit} by votes`, NETWORK_STEP, () => this.discoverTop(limit));
      } else {
        const slices = await step.do("plan discover slices", NETWORK_STEP, async () => {
          const { client, usage } = this.client();
          const pacer = new Pacer(readConfig(this.env).discoverRps);
          const result = await planVoteSlices(async (min, max) => {
            await pacer.wait();
            const res = await client.discover({ ...DISCOVER_FILTER, "vote_count.gte": min, "vote_count.lte": max, page: 1 });
            if (!res.ok) throw new Error(`discover count failed: ${res.status} ${res.message}`);
            return res.data.total_results;
          }, MIN_VOTE_COUNT);
          await recordUsage(db, utcDay(Date.now()), usage());
          return result;
        });

        const chunks: Member[][] = [];
        for (const [i, slice] of slices.entries()) {
          chunks.push(await step.do(`discover slice ${i}: votes ${slice.min}-${slice.max}`, NETWORK_STEP, () => this.enumerateSlice(slice)));
        }
        members = mergeMembers(chunks);
      }

      if (mode === "bootstrap") {
        planned = await step.do("enqueue bootstrap", async () => {
          const sorted = [...members].sort((a, b) => b.votes - a.votes);
          const chosen = params.limit ? sorted.slice(0, params.limit) : sorted;
          const msgs = chosen.map((m): FetchMessage => ({ id: m.id, mode: "crawl", reason: "bootstrap", runId }));
          await this.recordEnqueued(runId, msgs.length);
          await sendAll(this.env.FETCH_QUEUE, msgs);
          return { members: members.length, bootstrap: msgs.length };
        });
      } else {
        const dbState = await step.do("load db state", async () => {
          const [active, pinned, oldest] = await Promise.all([
            db.prepare("SELECT id FROM tmdb_movies WHERE state = 'active'").all<{ id: number }>(),
            db.prepare("SELECT movie_id AS id FROM tmdb_pinned_movies").all<{ id: number }>(),
            db
              .prepare("SELECT MIN(last_synced_at) AS t FROM tmdb_movies WHERE state = 'active'")
              .first<{ t: number | null }>(),
          ]);
          return {
            active: active.results.map((r) => r.id),
            pinned: pinned.results.map((r) => r.id),
            lastSuccess: await getState<string>(db, LAST_SUCCESS_KEY),
            oldestSyncDay: oldest?.t ? utcDay(oldest.t) : null,
          };
        });
        // Before the first successful daily run, changes since the oldest fetch are what matter (SPEC § 5.2).
        const window = planChangesWindow(start.day, dbState.lastSuccess ?? dbState.oldestSyncDay);
        const known = new Set([...dbState.active, ...dbState.pinned]);

        const changed =
          known.size === 0
            ? []
            : await step.do(`collect changes ${window.start}..${window.end}`, NETWORK_STEP, () =>
                this.collectChanges(window.start, window.end, known),
              );

        const plan = planDaily({ members, db: dbState, changed });

        const sweep = await step.do("plan sweep", async () => {
          const exclude = new Set(plan.keys());
          const limit = sweepLimit(dbState.active.length, SWEEP_DIVISOR);
          const ids: number[] = [];
          const known = "(state = 'active' OR id IN (SELECT movie_id FROM tmdb_pinned_movies))";
          if (window.gap) {
            // Catch-up: anything last synced before the changes window can't be verified via /changes.
            const { results } = await db
              .prepare(`SELECT id FROM tmdb_movies WHERE ${known} AND last_synced_at < ?`)
              .bind(dayStartMs(window.start))
              .all<{ id: number }>();
            for (const r of results) if (!exclude.has(r.id)) ids.push(r.id);
          }
          const { results } = await db
            .prepare(`SELECT id FROM tmdb_movies WHERE ${known} ORDER BY last_synced_at ASC LIMIT ?`)
            .bind(limit + exclude.size + ids.length)
            .all<{ id: number }>();
          const seen = new Set(ids);
          let added = 0;
          for (const r of results) {
            if (added >= limit) break;
            if (exclude.has(r.id) || seen.has(r.id)) continue;
            ids.push(r.id);
            seen.add(r.id);
            added++;
          }
          return ids;
        });

        planned = await step.do("enqueue daily", async () => {
          const reasons = new Map<number, Reason>(plan);
          for (const id of sweep) if (!reasons.has(id)) reasons.set(id, "sweep");
          const msgs = [...reasons].map(([id, reason]): FetchMessage => ({ id, mode: "sync" as FetchMode, reason, runId }));
          await this.recordEnqueued(runId, msgs.length);
          await sendAll(this.env.FETCH_QUEUE, msgs);
          const byReason: Record<string, number> = { members: members.length };
          for (const m of msgs) byReason[m.reason] = (byReason[m.reason] ?? 0) + 1;
          return byReason;
        });

        await step.do("purge expired", () => this.purgeExpired());
      }
    }

    // ---- drain ----
    const interval = Math.max(5, params.drainIntervalSeconds ?? 300);
    const maxChecks = params.maxDrainChecks ?? (mode === "bootstrap" ? 288 : 72);
    let drained = false;
    for (let i = 0; i < maxChecks && !drained; i++) {
      await step.sleep(`drain wait ${i}`, interval * 1000);
      drained = await step.do(`drain check ${i}`, async () => {
        const c = await getRunCounters(db, runId);
        return (c.processed ?? 0) + (c.dead ?? 0) >= (c.enqueued ?? 0) + (c.enqueued_extra ?? 0);
      });
    }

    // ---- finish ----
    return step.do("finish run", async () => {
      const now = Date.now();
      const counters = await getRunCounters(db, runId);
      const status = drained ? "ok" : "drain_timeout";
      const stmts: Stmt[] = [
        {
          sql: "UPDATE tmdb_sync_runs SET finished_at = ?, status = ?, stats = ? WHERE run_id = ?",
          params: [now, status, JSON.stringify({ planned, counters }), runId],
        },
      ];
      // last_success only advances when a daily run fully drained (the changes window overlaps by a day).
      if (mode === "daily" && drained) stmts.push(setStateStmt(LAST_SUCCESS_KEY, start.day, now));
      await runStatements(db, stmts);
      const guard = await readGuard(db, utcDay(now));
      await notify(this.env, formatSummary({ mode, day: start.day, status, startedAt: start.now, now, planned, counters, today: guard.used }));
      return { status, planned, counters };
    });
  }

  private client() {
    let n = 0;
    const client = new TmdbClient({ token: tmdbToken(this.env), onRequest: () => n++ });
    return { client, usage: () => ({ tmdb_requests: n }) };
  }

  private async recordEnqueued(runId: string, n: number): Promise<void> {
    // Absolute value, so a retried step doesn't double count.
    await runStatements(this.env.DB, [setRunCounterStmt(runId, "enqueued", n)]);
  }

  private async enumerateSlice(slice: VoteSlice): Promise<Member[]> {
    const out = await this.discoverPages(
      { "vote_count.gte": slice.min, "vote_count.lte": slice.max, sort_by: "primary_release_date.asc" },
      slicePages(slice),
    );
    if (slice.overflow) console.warn(JSON.stringify({ message: "discover slice overflow: only first 10k reachable", slice }));
    return out;
  }

  private async discoverTop(limit: number): Promise<Member[]> {
    const out = await this.discoverPages(
      { "vote_count.gte": MIN_VOTE_COUNT, sort_by: "vote_count.desc" },
      Math.ceil(limit / DISCOVER_PAGE_SIZE),
    );
    return mergeMembers([out]).slice(0, limit);
  }

  /** Pages through discover (paced, with small in-step retries) and records the requests in the guard. */
  private async discoverPages(filter: Record<string, string | number>, pages: number): Promise<Member[]> {
    const { client, usage } = this.client();
    const pacer = new Pacer(readConfig(this.env).discoverRps);
    const out: Member[] = [];
    try {
      for (let page = 1; page <= pages; page++) {
        for (let attempt = 0; ; attempt++) {
          await pacer.wait();
          const res = await client.discover({ ...DISCOVER_FILTER, ...filter, page });
          if (res.ok) {
            for (const r of res.data.results) out.push({ id: r.id, votes: r.vote_count });
            if (page >= res.data.total_pages) pages = page; // fewer results than expected
            break;
          }
          if ((res.kind === "rate_limited" || res.kind === "transient") && attempt < 4) {
            await defaultSleep(2000 * 2 ** attempt);
            continue;
          }
          throw new Error(`discover page ${page} failed: ${res.status} ${res.message}`);
        }
      }
    } finally {
      await recordUsage(this.env.DB, utcDay(Date.now()), usage());
    }
    return out;
  }

  private async collectChanges(start: string, end: string, known: Set<number>): Promise<number[]> {
    const { client, usage } = this.client();
    const pacer = new Pacer(readConfig(this.env).discoverRps);
    const out = new Set<number>();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      await pacer.wait();
      const res = await client.movieChanges(start, end, page);
      if (!res.ok) throw new Error(`changes page ${page} failed: ${res.status} ${res.message}`);
      totalPages = res.data.total_pages;
      for (const r of res.data.results) if (known.has(r.id)) out.add(r.id);
    }
    await recordUsage(this.env.DB, utcDay(Date.now()), usage());
    return [...out];
  }

  /** 90-day purge of excluded/deleted rows + their R2 objects, orphan lookups, and R2 objects with no D1 row. */
  private async purgeExpired(): Promise<{ purged: number; r2Orphans: number }> {
    const db = this.env.DB;
    const now = Date.now();
    const { results } = await db
      .prepare(
        "SELECT id FROM tmdb_movies WHERE state IN ('excluded', 'deleted') AND state_changed_at < ? " +
          "AND id NOT IN (SELECT movie_id FROM tmdb_pinned_movies) LIMIT 500",
      )
      .bind(now - PURGE_AFTER_DAYS * DAY_MS)
      .all<{ id: number }>();
    const ids = results.map((r) => r.id);
    await runStatements(db, [...ids.flatMap(buildPurgeMovie), ...buildOrphanCleanup()]);
    for (let i = 0; i < ids.length; i += 1000) await this.env.RAW.delete(ids.slice(i, i + 1000).map(rawKey));

    // R2 objects without a D1 row (e.g. crawled but never seeded) would otherwise never be refreshed.
    let r2Orphans = 0;
    if (await getState<number>(db, "seeded_at")) {
      const known = new Set(
        (await db.prepare("SELECT id FROM tmdb_movies").all<{ id: number }>()).results.map((r) => r.id),
      );
      const stale: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await this.env.RAW.list({ prefix: RAW_PREFIX, ...(cursor ? { cursor } : {}), limit: 1000 });
        for (const obj of page.objects) {
          const id = idFromRawKey(obj.key);
          if (id !== null && !known.has(id) && obj.uploaded.getTime() < now - 7 * DAY_MS) stale.push(obj.key);
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      for (let i = 0; i < stale.length; i += 1000) await this.env.RAW.delete(stale.slice(i, i + 1000));
      r2Orphans = stale.length;
    }
    return { purged: ids.length, r2Orphans };
  }
}

async function sendAll(queue: Queue, msgs: FetchMessage[]): Promise<void> {
  for (let i = 0; i < msgs.length; i += 100) {
    await queue.sendBatch(msgs.slice(i, i + 100).map((body) => ({ body })));
  }
}

const fmt = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

export function formatSummary(s: {
  mode: SyncMode;
  day: string;
  status: string;
  startedAt: number;
  now: number;
  planned: Record<string, number>;
  counters: Record<string, number>;
  today: Record<string, number>;
}): string {
  const c = s.counters;
  const minutes = Math.round((s.now - s.startedAt) / 60_000);
  const plannedLine = Object.entries(s.planned)
    .map(([k, v]) => `${k} ${fmt(v)}`)
    .join(" · ");
  return [
    `🎬 movies-sync ${s.mode} ${s.day} — ${s.status === "ok" ? "✅" : "⚠️"} ${s.status} (${minutes} min)`,
    `planned: ${plannedLine || "—"}`,
    `fetched ${fmt(c.fetched)} · changed ${fmt(c.changed)} · unchanged ${fmt(c.unchanged)} · new rows ${fmt(c.inserted)} · skipped ${fmt(c.skipped_fresh)}`,
    `excluded ${fmt(c.excluded)} · deleted ${fmt(c.deleted)} (redirected ${fmt(c.redirected)}, review ${fmt(c.needs_review)}) · not qualified ${fmt(c.not_qualified)}`,
    `retries ${fmt(c.retried)} (429s ${fmt(c.rate_limited)}) · failed ${fmt(c.failed)} · dead ${fmt(c.dead)} · parked ${fmt(c.parked)}`,
    `today: TMDB requests ${fmt(s.today.tmdb_requests)} · R2 writes ${fmt(s.today.r2_writes)} · D1 rows ${fmt(s.today.d1_rows_written)}`,
  ].join("\n");
}
