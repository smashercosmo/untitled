import { beforeEach, describe, expect, it } from "vitest";
import { normalizeMovie } from "../src/normalize";
import {
  assembleMovieDetail,
  movieDetailStmts,
  type MovieCard,
  popularMoviesStmt,
  searchMoviesStmt,
  toFtsQuery,
  toMovieCard,
} from "../src/queries";
import type { TmdbMovie } from "../src/types";
import { buildMovieWrite, buildPurgeMovie, buildStateUpdate, type Stmt } from "../src/writes";
import { syntheticMovie } from "./fixtures/synthetic";
import { apply, migratedDb } from "./sqlite";

const T0 = Date.UTC(2026, 10, 11);
type Db = ReturnType<typeof migratedDb>;

function store(db: Db, m: TmdbMovie) {
  apply(db, buildMovieWrite(normalizeMovie(m), null, { syncedAt: T0, now: T0, state: "active" }).stmts);
}
const all = (db: Db, s: Stmt) => db.prepare(s.sql).all(...s.params) as Record<string, unknown>[];
const search = (db: Db, q: string): MovieCard[] => {
  const s = searchMoviesStmt(q, 20);
  return s ? all(db, s).map((r) => toMovieCard(r as never)) : [];
};

/** A second fake movie with a different title and Russian "ё". */
function otherMovie(): TmdbMovie {
  return syntheticMovie({
    id: 900002,
    original_title: "Night Shift",
    vote_count: 999,
    translations: {
      translations: [
        { iso_3166_1: "US", iso_639_1: "en", data: { title: "Night Shift", overview: "Fake.", tagline: "" } },
        { iso_3166_1: "RU", iso_639_1: "ru", data: { title: "Ёлки-палки и ночная смена", overview: "Фейк.", tagline: "" } },
      ],
    },
    // TMDB credit/video ids are globally unique: don't reuse the first fake movie's ones.
    credits: { cast: [], crew: [] },
    videos: { results: [] },
  });
}

describe("toFtsQuery", () => {
  it("turns words into quoted prefix terms and folds ё", () => {
    expect(toFtsQuery("Тёмный  рыцарь!")).toBe('"Темный"* "рыцарь"*');
    expect(toFtsQuery('a"b')).toBe('"a"* "b"*');
  });
  it("rejects input with nothing searchable", () => {
    expect(toFtsQuery("  !!! ")).toBeNull();
    expect(toFtsQuery("a")).toBeNull();
  });
});

describe("search, popular and detail against the real migrations", () => {
  let db: Db;
  beforeEach(() => {
    db = migratedDb();
    store(db, syntheticMovie());
    store(db, otherMovie());
  });

  it("finds movies by English prefix, any case", () => {
    expect(search(db, "fake haun").map((m) => m.id)).toEqual([900001]);
    expect(search(db, "NIGHT").map((m) => m.id)).toEqual([900002]);
  });

  it("finds movies by Russian title, with or without ё, any case", () => {
    expect(search(db, "фальш").map((m) => m.id)).toEqual([900001]);
    expect(search(db, "елки").map((m) => m.id)).toEqual([900002]);
    expect(search(db, "ЁЛКИ ночн").map((m) => m.id)).toEqual([900002]);
  });

  it("hides non-active movies and forgets purged ones", () => {
    apply(db, [buildStateUpdate(900002, "excluded", T0)]);
    expect(search(db, "night")).toEqual([]);
    apply(db, buildPurgeMovie(900001));
    expect(search(db, "fake")).toEqual([]);
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM tmdb_movie_search").get() as { n: number }).n)).toBe(1);
  });

  it("keeps the index in sync when a translation changes", () => {
    const renamed = syntheticMovie();
    renamed.translations!.translations![2]!.data.title = "Новое название";
    const prev = JSON.parse(String((db.prepare("SELECT section_hashes AS h FROM tmdb_movies WHERE id = 900001").get() as { h: string }).h));
    apply(db, buildMovieWrite(normalizeMovie(renamed), prev, { syncedAt: T0, now: T0, state: "active" }).stmts);
    expect(search(db, "новое").map((m) => m.id)).toEqual([900001]);
    expect(search(db, "фальш")).toEqual([]);
  });

  it("popular = most voted active movies, with en title and ru title", () => {
    const rows = all(db, popularMoviesStmt(4)).map((r) => toMovieCard(r as never));
    expect(rows.map((r) => r.id)).toEqual([900002, 900001]);
    expect(rows[1]).toMatchObject({ title: "The Fake Haunting", titleRu: "Фальшивое проклятие", year: 2021 });
  });

  it("assembles the movie page", () => {
    const detail = assembleMovieDetail(movieDetailStmts(900001).map((s) => all(db, s)));
    expect(detail).toMatchObject({
      id: 900001,
      title: "The Fake Haunting",
      titleRu: "Фальшивое проклятие",
      overviewRu: "Синтетическая семья переезжает в синтетический дом.",
      certification: "R",
      trailer: { key: "yt_en_1", lang: "en" },
      directors: [{ id: 200, name: "Dee Rector" }],
    });
    expect(detail?.writers.map((w) => w.job).sort()).toEqual(["Screenplay", "Writer"]);
    expect(detail?.cast).toHaveLength(15);
    expect(detail?.cast[0]).toMatchObject({ name: "Actor 1", character: "Character 1" });
    expect(detail?.genres.map((g) => g.id)).toEqual([27, 9648]);
  });

  it("returns null for unknown or inactive movies", () => {
    expect(assembleMovieDetail(movieDetailStmts(1).map((s) => all(db, s)))).toBeNull();
  });
});
