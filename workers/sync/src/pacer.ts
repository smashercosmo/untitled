/** Spaces request starts evenly (≤ rps). Combined with mapLimit(…, 6) it respects the 6-connection limit. */
export class Pacer {
  #next = 0;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(rps: number, now: () => number = Date.now, sleep: (ms: number) => Promise<void> = defaultSleep) {
    this.#intervalMs = 1000 / rps;
    this.#now = now;
    this.#sleep = sleep;
  }

  async wait(): Promise<void> {
    const t = this.#now();
    const slot = Math.max(t, this.#next);
    this.#next = slot + this.#intervalMs;
    if (slot > t) await this.#sleep(slot - t);
  }
}

export function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs fn over items with at most `limit` in flight; results keep input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
