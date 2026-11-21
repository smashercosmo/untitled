/** Membership = the set of movies that currently satisfy the entry rule, enumerated via /discover (SPEC § 5.1). */
import { DISCOVER_MAX_PAGES, DISCOVER_MAX_RESULTS, DISCOVER_PAGE_SIZE, MIN_VOTE_COUNT, VOTE_COUNT_CEILING } from "./config";

export interface VoteSlice {
  min: number;
  max: number;
  total: number;
  /** A single vote_count value with more results than discover can page through (only first 10k reachable). */
  overflow?: boolean;
}

/** Count results for vote_count ∈ [min, max]. Implemented with one discover page-1 request. */
export type CountFn = (min: number, max: number) => Promise<number>;

/**
 * Split [minVotes, ceiling] into ranges with ≤ `cap` results each. Vote counts are heavily skewed toward
 * small values, so we split at the geometric mean, which converges in a handful of requests.
 */
export async function planVoteSlices(
  count: CountFn,
  minVotes = MIN_VOTE_COUNT,
  ceiling = VOTE_COUNT_CEILING,
  cap = DISCOVER_MAX_RESULTS,
): Promise<VoteSlice[]> {
  const out: VoteSlice[] = [];
  const stack: [number, number][] = [[minVotes, ceiling]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    const total = await count(lo, hi);
    if (total === 0) continue;
    if (total <= cap) {
      out.push({ min: lo, max: hi, total });
      continue;
    }
    if (lo === hi) {
      out.push({ min: lo, max: hi, total, overflow: true });
      continue;
    }
    const mid = Math.min(hi - 1, Math.max(lo, Math.floor(Math.sqrt(Math.max(lo, 1) * hi))));
    stack.push([mid + 1, hi], [lo, mid]);
  }
  return out.sort((a, b) => a.min - b.min);
}

export function slicePages(slice: VoteSlice): number {
  return Math.min(DISCOVER_MAX_PAGES, Math.ceil(Math.min(slice.total, DISCOVER_MAX_RESULTS) / DISCOVER_PAGE_SIZE));
}

export interface Member {
  id: number;
  votes: number;
}

export function mergeMembers(chunks: Member[][]): Member[] {
  const byId = new Map<number, Member>();
  for (const chunk of chunks) for (const m of chunk) byId.set(m.id, m);
  return [...byId.values()];
}

export interface DbMembershipState {
  active: number[];
  pinned: number[];
}

export type Reason = "gone" | "new" | "changed" | "sweep" | "redirect" | "replay" | "bootstrap";

export interface DailyPlanInput {
  members: Member[];
  db: DbMembershipState;
  changed: number[];
}

/**
 * Daily plan with one reason per movie. Priority: gone > new > changed (SPEC § 5.2).
 * The sweep is planned separately (it needs a DB query) and must skip ids already planned.
 */
export function planDaily({ members, db, changed }: DailyPlanInput): Map<number, Reason> {
  const plan = new Map<number, Reason>();
  const memberIds = new Set(members.map((m) => m.id));
  const active = new Set(db.active);
  const pinned = new Set(db.pinned);

  for (const id of active) if (!memberIds.has(id) && !pinned.has(id)) plan.set(id, "gone");
  for (const id of memberIds) if (!active.has(id) && !plan.has(id)) plan.set(id, "new");
  const known = new Set([...active, ...pinned]);
  for (const id of changed) if (known.has(id) && !plan.has(id)) plan.set(id, "changed");
  return plan;
}

export function sweepLimit(activeCount: number, divisor: number): number {
  return activeCount === 0 ? 0 : Math.ceil(activeCount / divisor);
}
