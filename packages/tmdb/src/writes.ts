/**
 * Runtime-agnostic SQL builders for D1 (SQLite). They return plain { sql, params } so the
 * Worker, the seed script and Node tests (node:sqlite) can all execute them.
 *
 * Rules (SPEC § 4): idempotent upserts keyed by TMDB id; only changed sections are rewritten;
 * the tmdb_movies row (which stores section_hashes) is always the LAST statement for a movie, so a
 * partially applied batch can never record hashes for sections that were not written.
 */
import { changedSections, hashSections, type Section, type SectionHashes } from "./hash";
import type { NormalizedMovie } from "./normalize";
import type { MovieState } from "./schema";

export type SqlValue = string | number | null;
export interface Stmt {
  sql: string;
  params: SqlValue[];
}

/** D1 limit: 100 bound parameters per statement. */
export const MAX_PARAMS = 100;

export function insertMany(
  table: string,
  columns: readonly string[],
  rows: readonly SqlValue[][],
  suffix = "",
): Stmt[] {
  if (rows.length === 0) return [];
  const perStmt = Math.max(1, Math.floor(MAX_PARAMS / columns.length));
  const out: Stmt[] = [];
  const tuple = `(${columns.map(() => "?").join(",")})`;
  for (let i = 0; i < rows.length; i += perStmt) {
    const chunk = rows.slice(i, i + perStmt);
    out.push({
      sql: `INSERT INTO ${table} (${columns.join(",")}) VALUES ${chunk.map(() => tuple).join(",")}${suffix ? ` ${suffix}` : ""}`,
      params: chunk.flat(),
    });
  }
  return out;
}

/** `ON CONFLICT(key) DO UPDATE` that skips no-op updates (no rows_written when nothing changed). */
function upsertSuffix(key: string, table: string, cols: readonly string[]): string {
  const sets = cols.map((c) => `${c}=excluded.${c}`).join(",");
  const lhs = cols.map((c) => `${table}.${c}`).join(",");
  const rhs = cols.map((c) => `excluded.${c}`).join(",");
  return `ON CONFLICT(${key}) DO UPDATE SET ${sets} WHERE (${lhs}) IS NOT (${rhs})`;
}

const del = (table: string, movieId: number): Stmt => ({ sql: `DELETE FROM ${table} WHERE movie_id = ?`, params: [movieId] });

const MOVIE_DATA_COLS = [
  "imdb_id",
  "wikidata_id",
  "original_title",
  "original_language",
  "release_date",
  "runtime",
  "status",
  "budget",
  "revenue",
  "vote_average",
  "vote_count",
  "poster_path",
  "poster_path_ru",
  "backdrop_path",
  "collection_id",
  "homepage",
] as const;

export interface MovieWriteOptions {
  /** When the data was fetched from TMDB (ms epoch). Seed passes the R2 fetched_at. */
  syncedAt: number;
  /** Wall clock, used for state_changed_at / first_seen_at. */
  now: number;
  state: MovieState;
}

export interface MovieWrite {
  stmts: Stmt[];
  hashes: SectionHashes;
  changed: Section[];
}

export function buildMovieWrite(
  n: NormalizedMovie,
  prevHashes: Partial<SectionHashes> | null,
  opts: MovieWriteOptions,
): MovieWrite {
  const hashes = hashSections(n);
  const changed = changedSections(hashes, prevHashes);
  const id = n.id;
  const stmts: Stmt[] = [];
  const has = (s: Section) => changed.includes(s);

  if (has("translations")) {
    stmts.push(del("tmdb_movie_translations", id));
    stmts.push(
      ...insertMany(
        "tmdb_movie_translations",
        ["movie_id", "lang", "title", "overview", "tagline"],
        n.translations.map((t) => [id, t.lang, t.title, t.overview, t.tagline]),
      ),
    );
  }
  if (has("genres")) {
    stmts.push(del("tmdb_movie_genres", id));
    stmts.push(...insertMany("tmdb_movie_genres", ["movie_id", "genre_id"], n.genres.map((g) => [id, g])));
  }
  if (has("keywords")) {
    stmts.push(
      ...insertMany(
        "tmdb_keywords",
        ["id", "name"],
        n.keywords.map((k) => [k.id, k.name]),
        upsertSuffix("id", "tmdb_keywords", ["name"]),
      ),
    );
    stmts.push(del("tmdb_movie_keywords", id));
    stmts.push(...insertMany("tmdb_movie_keywords", ["movie_id", "keyword_id"], n.keywords.map((k) => [id, k.id])));
  }
  if (has("companies")) {
    const cols = ["name", "logo_path", "origin_country"] as const;
    stmts.push(
      ...insertMany(
        "tmdb_companies",
        ["id", ...cols],
        n.companies.map((c) => [c.id, c.name, c.logo_path, c.origin_country]),
        upsertSuffix("id", "tmdb_companies", cols),
      ),
    );
    stmts.push(del("tmdb_movie_companies", id));
    stmts.push(...insertMany("tmdb_movie_companies", ["movie_id", "company_id"], n.companies.map((c) => [id, c.id])));
  }
  if (has("countries")) {
    stmts.push(del("tmdb_movie_countries", id));
    stmts.push(...insertMany("tmdb_movie_countries", ["movie_id", "iso_3166_1"], n.countries.map((c) => [id, c])));
  }
  if (has("collection") && n.collection) {
    const c = n.collection;
    const cols = ["name", "poster_path", "backdrop_path"] as const;
    stmts.push(
      ...insertMany(
        "tmdb_collections",
        ["id", ...cols],
        [[c.id, c.name, c.poster_path, c.backdrop_path]],
        upsertSuffix("id", "tmdb_collections", cols),
      ),
    );
  }
  if (has("release_dates")) {
    stmts.push(del("tmdb_release_dates", id));
    stmts.push(
      ...insertMany(
        "tmdb_release_dates",
        ["movie_id", "country", "ord", "type", "release_date", "certification", "note"],
        n.releaseDates.map((r) => [id, r.country, r.ord, r.type, r.release_date, r.certification, r.note]),
      ),
    );
  }
  if (has("videos")) {
    const cols = ["movie_id", "iso_639_1", "key", "name", "type", "official", "published_at"] as const;
    stmts.push(del("tmdb_videos", id));
    stmts.push(
      ...insertMany(
        "tmdb_videos",
        ["id", ...cols],
        n.videos.map((v) => [v.id, id, v.iso_639_1, v.key, v.name, v.type, v.official, v.published_at]),
        upsertSuffix("id", "tmdb_videos", cols),
      ),
    );
  }
  if (has("credits")) {
    const personCols = ["name", "original_name", "gender", "known_for_department", "profile_path", "adult"] as const;
    stmts.push(
      ...insertMany(
        "tmdb_people",
        ["id", ...personCols],
        n.people.map((p) => [p.id, p.name, p.original_name, p.gender, p.known_for_department, p.profile_path, p.adult]),
        upsertSuffix("id", "tmdb_people", personCols),
      ),
    );
    const creditCols = ["movie_id", "person_id", "kind", "character", "job", "ord"] as const;
    stmts.push(del("tmdb_movie_credits", id));
    stmts.push(
      ...insertMany(
        "tmdb_movie_credits",
        ["credit_id", ...creditCols],
        n.credits.map((c) => [c.credit_id, id, c.person_id, c.kind, c.character, c.job, c.ord]),
        upsertSuffix("credit_id", "tmdb_movie_credits", creditCols),
      ),
    );
  }

  // Always last: core row + state + last_synced_at + section_hashes (one row written per fetch,
  // needed so the freshness sweep advances even when nothing else changed).
  const core = n.core;
  const values: SqlValue[] = [
    id,
    ...MOVIE_DATA_COLS.map((c) => core[c]),
    opts.state,
    opts.now,
    opts.now,
    opts.syncedAt,
    JSON.stringify(hashes),
  ];
  const allCols = ["id", ...MOVIE_DATA_COLS, "state", "state_changed_at", "first_seen_at", "last_synced_at", "section_hashes"];
  stmts.push({
    sql:
      `INSERT INTO tmdb_movies (${allCols.join(",")}) VALUES (${allCols.map(() => "?").join(",")}) ` +
      `ON CONFLICT(id) DO UPDATE SET ${MOVIE_DATA_COLS.map((c) => `${c}=excluded.${c}`).join(",")},` +
      `state=excluded.state,` +
      `state_changed_at=CASE WHEN tmdb_movies.state IS excluded.state THEN tmdb_movies.state_changed_at ELSE excluded.state_changed_at END,` +
      `last_synced_at=excluded.last_synced_at,section_hashes=excluded.section_hashes`,
    params: values,
  });

  return { stmts, hashes, changed };
}

/** State-only transition (404 → deleted) without touching data. No-op if already in that state. */
export function buildStateUpdate(id: number, state: MovieState, now: number): Stmt {
  return {
    sql: "UPDATE tmdb_movies SET state = ?, state_changed_at = ? WHERE id = ? AND state IS NOT ?",
    params: [state, now, id, state],
  };
}

export function buildRedirect(oldId: number, newId: number, method: "imdb" | "wikidata", now: number): Stmt {
  return {
    sql:
      "INSERT INTO tmdb_movie_redirects (old_id, new_id, method, created_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, method = excluded.method",
    params: [oldId, newId, method, now],
  };
}

export const MOVIE_CHILD_TABLES = [
  "tmdb_movie_translations",
  "tmdb_movie_genres",
  "tmdb_movie_keywords",
  "tmdb_movie_companies",
  "tmdb_movie_countries",
  "tmdb_release_dates",
  "tmdb_videos",
  "tmdb_movie_credits",
] as const;

/** Hard-delete a movie and its child rows (90-day purge). Redirect rows are kept: they hold only ids. */
export function buildPurgeMovie(id: number): Stmt[] {
  return [...MOVIE_CHILD_TABLES.map((t) => del(t, id)), { sql: "DELETE FROM tmdb_movies WHERE id = ?", params: [id] }];
}

/** Remove lookup rows no movie references any more. */
export function buildOrphanCleanup(): Stmt[] {
  return [
    {
      sql: "DELETE FROM tmdb_people WHERE NOT EXISTS (SELECT 1 FROM tmdb_movie_credits c WHERE c.person_id = tmdb_people.id)",
      params: [],
    },
    {
      sql: "DELETE FROM tmdb_keywords WHERE NOT EXISTS (SELECT 1 FROM tmdb_movie_keywords k WHERE k.keyword_id = tmdb_keywords.id)",
      params: [],
    },
    {
      sql: "DELETE FROM tmdb_companies WHERE NOT EXISTS (SELECT 1 FROM tmdb_movie_companies c WHERE c.company_id = tmdb_companies.id)",
      params: [],
    },
    {
      sql: "DELETE FROM tmdb_collections WHERE NOT EXISTS (SELECT 1 FROM tmdb_movies m WHERE m.collection_id = tmdb_collections.id)",
      params: [],
    },
  ];
}

export function buildGenreUpsert(genres: { id: number; name_en: string | null; name_ru: string | null }[]): Stmt[] {
  return insertMany(
    "tmdb_genres",
    ["id", "name_en", "name_ru"],
    genres.map((g) => [g.id, g.name_en, g.name_ru]),
    upsertSuffix("id", "tmdb_genres", ["name_en", "name_ru"]),
  );
}
