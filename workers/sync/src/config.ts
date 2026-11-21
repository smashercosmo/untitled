import type { GuardCounters } from "./guard";

export interface SyncConfig {
  tmdbRps: number;
  discoverRps: number;
  caps: GuardCounters;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readConfig(env: Env): SyncConfig {
  return {
    tmdbRps: positive(env.TMDB_RPS, 20),
    discoverRps: positive(env.DISCOVER_RPS, 10),
    caps: {
      tmdb_requests: positive(env.GUARD_MAX_TMDB_REQUESTS, 50_000),
      r2_writes: positive(env.GUARD_MAX_R2_WRITES, 50_000),
      d1_rows_written: positive(env.GUARD_MAX_D1_ROWS, 1_000_000),
    },
  };
}

/** v4 Read Access Token preferred; TMDB_TOKEN (v3 key or v4) accepted as a fallback. */
export function tmdbToken(env: Env): string {
  return env.TMDB_READ_ACCESS_TOKEN || env.TMDB_TOKEN || "";
}
