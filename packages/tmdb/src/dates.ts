import { CHANGES_MAX_DAYS, DAY_MS } from "./config";

/** UTC calendar day, YYYY-MM-DD. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);
}

export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

export interface ChangesWindow {
  start: string;
  end: string;
  /**
   * True when the window can't reach back to the last successful run (first run or an outage of more
   * than 13 days). Then every movie last synced before `start` must be refetched (catch-up).
   */
  gap: boolean;
}

/**
 * /movie/changes window: from (coveredSince − 1 day) to today, clamped to 14 days (SPEC § 5.2).
 * `coveredSince` is the last successful daily run, or — before the first one — the day of the oldest
 * fetch in D1 (e.g. the bootstrap crawl): changes before that are already reflected in the data.
 */
export function planChangesWindow(today: string, coveredSince: string | null): ChangesWindow {
  const earliest = addDays(today, -(CHANGES_MAX_DAYS - 1));
  if (coveredSince) {
    const start = addDays(coveredSince, -1);
    if (start >= earliest) return { start, end: today, gap: false };
  }
  return { start: earliest, end: today, gap: true };
}
