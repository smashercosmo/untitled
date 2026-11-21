import { describe, expect, it } from "vitest";
import { MIN_VOTE_COUNT } from "../src/config";
import { addDays, planChangesWindow } from "../src/dates";
import { planDaily, planVoteSlices, slicePages, sweepLimit } from "../src/membership";
import { normalizeMovie } from "../src/normalize";
import { decideState } from "../src/qualify";
import { syntheticMovie } from "./fixtures/synthetic";

describe("planVoteSlices", () => {
  // Skewed distribution like TMDB's: many movies with few votes.
  const votes: number[] = [];
  for (let v = MIN_VOTE_COUNT; v < 40_000; v = Math.ceil(v * 1.05)) {
    const howMany = Math.max(1, Math.floor(30_000 / v));
    for (let i = 0; i < howMany; i++) votes.push(v);
  }
  let calls = 0;
  const countFn = async (min: number, max: number) => {
    calls++;
    return votes.filter((v) => v >= min && v <= max).length;
  };

  it("covers every movie exactly once with slices ≤ cap", async () => {
    const slices = await planVoteSlices(countFn, MIN_VOTE_COUNT, 10_000_000, 10_000);
    expect(slices.reduce((s, x) => s + x.total, 0)).toBe(votes.length);
    expect(slices.every((s) => s.total <= 10_000 || s.overflow)).toBe(true);
    for (let i = 1; i < slices.length; i++) expect(slices[i]!.min).toBeGreaterThan(slices[i - 1]!.max);
    expect(calls).toBeLessThan(60);
    expect(slicePages(slices[0]!)).toBeLessThanOrEqual(500);
  });
});

describe("planDaily", () => {
  it("assigns one reason per movie with priority gone > new > changed", () => {
    const plan = planDaily({
      members: [{ id: 1, votes: 10 }, { id: 2, votes: 10 }, { id: 4, votes: 10 }],
      db: { active: [1, 3, 5], pinned: [5] },
      changed: [1, 3, 5, 99],
    });
    expect(Object.fromEntries(plan)).toEqual({ 3: "gone", 2: "new", 4: "new", 1: "changed", 5: "changed" });
  });

  it("sweep size keeps every movie within the cycle", () => {
    expect(sweepLimit(40_000, 80)).toBe(500);
    expect(sweepLimit(0, 80)).toBe(0);
  });
});

describe("planChangesWindow", () => {
  it("normal day: from last success − 1 day", () => {
    expect(planChangesWindow("2026-11-11", "2026-11-10")).toEqual({ start: "2026-11-09", end: "2026-11-11", gap: false });
  });
  it("first run or long outage: 14-day window with catch-up", () => {
    expect(planChangesWindow("2026-11-11", null)).toEqual({ start: "2026-10-29", end: "2026-11-11", gap: true });
    expect(planChangesWindow("2026-11-11", "2026-10-01").gap).toBe(true);
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("decideState", () => {
  const movie = (o: Parameters<typeof syntheticMovie>[0] = {}) => normalizeMovie(syntheticMovie(o));
  it("entry requires a member genre and enough votes", () => {
    expect(decideState({ movie: movie(), existingState: null, pinned: false })).toBe("active");
    expect(decideState({ movie: movie({ vote_count: 4 }), existingState: null, pinned: false })).toBe("excluded");
    expect(decideState({ movie: movie({ genres: [{ id: 35, name: "Comedy" }] }), existingState: null, pinned: false })).toBe("excluded");
  });
  it("votes dropping never removes an active movie (Q30)", () => {
    expect(decideState({ movie: movie({ vote_count: 1 }), existingState: "active", pinned: false })).toBe("active");
  });
  it("losing both genres excludes, unless pinned (Q31)", () => {
    const comedy = movie({ genres: [{ id: 35, name: "Comedy" }] });
    expect(decideState({ movie: comedy, existingState: "active", pinned: false })).toBe("excluded");
    expect(decideState({ movie: comedy, existingState: "active", pinned: true })).toBe("active");
  });
  it("adult or video always excludes", () => {
    expect(decideState({ movie: movie({ adult: true }), existingState: "active", pinned: false })).toBe("excluded");
  });
});
