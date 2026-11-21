/**
 * Spending guard / circuit breaker (SPEC § 7). Cloudflare has no hard spend cap, so we count real usage
 * per UTC day and stop everything when a cap is reached. Resume is manual (RUNBOOK).
 */
import type { Stmt } from "@movies/tmdb";

export const GUARD_METRICS = ["tmdb_requests", "r2_writes", "d1_rows_written"] as const;
export type GuardMetric = (typeof GUARD_METRICS)[number];
export type GuardCounters = Record<GuardMetric, number>;
export const GUARD_STATE_KEY = "guard_tripped";

export interface TripInfo {
  metric: GuardMetric | "tmdb_auth";
  value: number;
  cap: number | null;
  at: number;
  day: string;
  note?: string;
}

const zero = (): GuardCounters => ({ tmdb_requests: 0, r2_writes: 0, d1_rows_written: 0 });

export async function readGuard(db: D1Database, day: string): Promise<{ tripped: TripInfo | null; used: GuardCounters }> {
  const [state, counters] = await db.batch([
    db.prepare("SELECT value FROM tmdb_sync_state WHERE key = ?").bind(GUARD_STATE_KEY),
    db.prepare("SELECT metric, value FROM tmdb_guard_counters WHERE day = ?").bind(day),
  ]);
  const used = zero();
  for (const row of (counters?.results ?? []) as { metric: string; value: number }[]) {
    if ((GUARD_METRICS as readonly string[]).includes(row.metric)) used[row.metric as GuardMetric] = row.value;
  }
  const stateRow = (state?.results ?? [])[0] as { value: string } | undefined;
  return { tripped: stateRow ? (JSON.parse(stateRow.value) as TripInfo) : null, used };
}

/** Adds usage and returns today's new totals. */
export async function recordUsage(db: D1Database, day: string, usage: Partial<GuardCounters>): Promise<GuardCounters> {
  const rows = GUARD_METRICS.filter((m) => (usage[m] ?? 0) > 0);
  if (rows.length > 0) {
    await db
      .prepare(
        `INSERT INTO tmdb_guard_counters (day, metric, value) VALUES ${rows.map(() => "(?, ?, ?)").join(",")} ` +
          "ON CONFLICT(day, metric) DO UPDATE SET value = value + excluded.value",
      )
      .bind(...rows.flatMap((m) => [day, m, usage[m] ?? 0]))
      .run();
  }
  return (await readGuard(db, day)).used;
}

export function firstOverCap(used: GuardCounters, caps: GuardCounters): GuardMetric | null {
  return GUARD_METRICS.find((m) => used[m] >= caps[m]) ?? null;
}

/** Would doing `planned` more work cross a cap? Checked before a batch starts so we never overshoot by much. */
export function wouldExceed(used: GuardCounters, caps: GuardCounters, planned: Partial<GuardCounters>): GuardMetric | null {
  return GUARD_METRICS.find((m) => used[m] + (planned[m] ?? 0) > caps[m]) ?? null;
}

/** Returns true only for the call that actually tripped it (so the alert is sent once). */
export async function tripGuard(db: D1Database, info: TripInfo): Promise<boolean> {
  const res = await db
    .prepare("INSERT INTO tmdb_sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(GUARD_STATE_KEY, JSON.stringify(info), info.at)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export function clearGuardStmt(): Stmt {
  return { sql: "DELETE FROM tmdb_sync_state WHERE key = ?", params: [GUARD_STATE_KEY] };
}

export function describeTrip(t: TripInfo): string {
  const limit = t.cap === null ? "" : ` (cap ${t.cap.toLocaleString("en-US")})`;
  return `${t.metric} = ${t.value.toLocaleString("en-US")}${limit} on ${t.day}${t.note ? ` — ${t.note}` : ""}`;
}
