import { describe, expect, it } from "vitest";
import { parseSectionHashes } from "../src/hash";
import { normalizeMovie } from "../src/normalize";
import {
  buildGenreUpsert,
  buildMovieWrite,
  buildOrphanCleanup,
  buildPurgeMovie,
  buildRedirect,
  buildStateUpdate,
  insertMany,
  MAX_PARAMS,
} from "../src/writes";
import { syntheticMovie } from "./fixtures/synthetic";
import { apply, count, migratedDb } from "./sqlite";

const T0 = Date.UTC(2026, 10, 11);

function write(db: ReturnType<typeof migratedDb>, movie = syntheticMovie(), now = T0) {
  const n = normalizeMovie(movie);
  const row = db.prepare("SELECT section_hashes FROM tmdb_movies WHERE id = ?").get(n.id) as { section_hashes: string } | undefined;
  const w = buildMovieWrite(n, parseSectionHashes(row?.section_hashes), { syncedAt: now, now, state: "active" });
  return { ...w, changes: apply(db, w.stmts) };
}

describe("insertMany", () => {
  it("never exceeds D1's 100 bound parameters per statement", () => {
    const rows = Array.from({ length: 250 }, (_, i) => [i, `n${i}`, null] as const).map((r) => [...r]);
    const stmts = insertMany("t", ["a", "b", "c"], rows);
    expect(stmts.every((s) => s.params.length <= MAX_PARAMS)).toBe(true);
    expect(stmts.reduce((acc, s) => acc + s.params.length, 0)).toBe(750);
  });
});

describe("buildMovieWrite against the real migration", () => {
  it("inserts a new movie with all sections", () => {
    const db = migratedDb();
    const w = write(db);
    expect(w.stmts.at(-1)?.sql).toMatch(/^INSERT INTO tmdb_movies/);
    expect(w.stmts.every((s) => s.params.length <= MAX_PARAMS)).toBe(true);
    expect(count(db, "tmdb_movies", "state = 'active'")).toBe(1);
    expect(count(db, "tmdb_movie_translations")).toBe(2);
    expect(count(db, "tmdb_movie_credits")).toBe(18);
    expect(count(db, "tmdb_people")).toBe(17);
    expect(count(db, "tmdb_movie_genres")).toBe(2);
    expect(count(db, "tmdb_release_dates")).toBe(3);
    expect(count(db, "tmdb_videos")).toBe(2);
    expect(count(db, "tmdb_collections")).toBe(1);
  });

  it("an unchanged refetch writes only the movie row", () => {
    const db = migratedDb();
    write(db);
    const second = write(db, syntheticMovie(), T0 + 1000);
    expect(second.changed).toEqual([]);
    expect(second.stmts).toHaveLength(1);
    expect(second.changes).toBe(1);
    const row = db.prepare("SELECT last_synced_at, first_seen_at FROM tmdb_movies").get() as Record<string, number>;
    expect(row).toEqual({ last_synced_at: T0 + 1000, first_seen_at: T0 });
  });

  it("rewrites only the changed section", () => {
    const db = migratedDb();
    write(db);
    const m = syntheticMovie();
    m.credits!.crew = m.credits!.crew!.filter((c) => c.job !== "Screenplay");
    const w = write(db, m, T0 + 1);
    expect(w.changed).toEqual(["credits"]);
    expect(count(db, "tmdb_movie_credits", "kind = 'crew'")).toBe(2);
    expect(count(db, "tmdb_movie_translations")).toBe(2);
  });

  it("skips no-op upserts of shared lookup rows (no rows_written)", () => {
    const db = migratedDb();
    write(db);
    const again = buildGenreUpsert([{ id: 27, name_en: "Horror", name_ru: "ужасы" }]);
    expect(apply(db, again)).toBe(1);
    expect(apply(db, again)).toBe(0);
  });

  it("state_changed_at only moves on a real state change", () => {
    const db = migratedDb();
    write(db);
    apply(db, [buildStateUpdate(900001, "active", T0 + 5)]);
    expect((db.prepare("SELECT state_changed_at AS s FROM tmdb_movies").get() as { s: number }).s).toBe(T0);
    apply(db, [buildStateUpdate(900001, "deleted", T0 + 6)]);
    expect(db.prepare("SELECT state, state_changed_at AS s FROM tmdb_movies").get()).toEqual({ state: "deleted", s: T0 + 6 });
  });

  it("purge removes the movie, its children and orphaned lookups but keeps redirects", () => {
    const db = migratedDb();
    write(db);
    apply(db, [buildRedirect(900001, 900002, "imdb", T0)]);
    apply(db, [...buildPurgeMovie(900001), ...buildOrphanCleanup()]);
    for (const t of ["tmdb_movies", "tmdb_movie_credits", "tmdb_people", "tmdb_keywords", "tmdb_companies", "tmdb_collections", "tmdb_videos"]) {
      expect(count(db, t), t).toBe(0);
    }
    expect(count(db, "tmdb_movie_redirects")).toBe(1);
  });
});
