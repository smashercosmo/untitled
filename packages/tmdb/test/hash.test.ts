import { describe, expect, it } from "vitest";
import { changedSections, hashSections, SECTIONS, stableStringify } from "../src/hash";
import { normalizeMovie } from "../src/normalize";
import { syntheticMovie } from "./fixtures/synthetic";

describe("section hashes", () => {
  it("stableStringify ignores key order", () => {
    expect(stableStringify({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(stableStringify({ a: [{ x: 1, y: 2 }], b: 1 }));
  });

  it("are deterministic", () => {
    const a = hashSections(normalizeMovie(syntheticMovie()));
    const b = hashSections(normalizeMovie(syntheticMovie()));
    expect(a).toEqual(b);
    expect(changedSections(a, b)).toEqual([]);
  });

  it("a vote change only touches core", () => {
    const a = hashSections(normalizeMovie(syntheticMovie()));
    const b = hashSections(normalizeMovie(syntheticMovie({ vote_count: 322, vote_average: 6.5 })));
    expect(changedSections(b, a)).toEqual(["core"]);
  });

  it("a renamed cast member changes credits (people live in the credits section)", () => {
    const base = syntheticMovie();
    const renamed = syntheticMovie();
    renamed.credits!.cast![1]!.name = "Renamed Actor";
    expect(changedSections(hashSections(normalizeMovie(renamed)), hashSections(normalizeMovie(base)))).toEqual(["credits"]);
  });

  it("treats a missing previous hash set as everything changed", () => {
    expect(changedSections(hashSections(normalizeMovie(syntheticMovie())), null)).toEqual([...SECTIONS]);
  });
});
