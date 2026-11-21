import type { Reason } from "@movies/tmdb";

export const FETCH_QUEUE_NAME = "tmdb-fetch";
export const DLQ_NAME = "tmdb-fetch-dlq";

/** crawl = R2 only (bootstrap, before the seed); sync = R2 + D1 (daily). */
export type FetchMode = "crawl" | "sync";

export interface FetchMessage {
  id: number;
  mode: FetchMode;
  reason: Reason;
  runId: string;
}
