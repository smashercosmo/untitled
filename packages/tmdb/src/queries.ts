/**
 * Read queries for the app (SPEC § 4.1). Plain SQL + row mappers so the app (D1), tests (node:sqlite)
 * and any future consumer share one definition. "Popular" = most voted (we don't store TMDB popularity, Q16).
 */
import type { Stmt } from "./writes";

export interface MovieCard {
  id: number;
  title: string;
  titleRu: string | null;
  originalTitle: string;
  year: number | null;
  posterPath: string | null;
  posterPathRu: string | null;
  voteAverage: number | null;
  voteCount: number;
}

export interface PersonCredit {
  id: number;
  name: string;
  profilePath: string | null;
}

export interface MovieDetail extends MovieCard {
  overview: string | null;
  overviewRu: string | null;
  tagline: string | null;
  taglineRu: string | null;
  releaseDate: string | null;
  runtime: number | null;
  backdropPath: string | null;
  imdbId: string | null;
  certification: string | null;
  genres: { id: number; name: string | null; nameRu: string | null }[];
  directors: PersonCredit[];
  writers: (PersonCredit & { job: string })[];
  cast: (PersonCredit & { character: string | null })[];
  trailer: { key: string; name: string; lang: string } | null;
}

export interface MovieCardRow {
  id: number;
  original_title: string;
  release_date: string | null;
  poster_path: string | null;
  poster_path_ru: string | null;
  vote_average: number | null;
  vote_count: number;
  title_en: string | null;
  title_ru: string | null;
}

const CARD_COLUMNS = `m.id, m.original_title, m.release_date, m.poster_path, m.poster_path_ru, m.vote_average, m.vote_count,
  en.title AS title_en, ru.title AS title_ru`;
const TRANSLATION_JOINS = `LEFT JOIN tmdb_movie_translations en ON en.movie_id = m.id AND en.lang = 'en'
  LEFT JOIN tmdb_movie_translations ru ON ru.movie_id = m.id AND ru.lang = 'ru'`;

export function toMovieCard(r: MovieCardRow): MovieCard {
  return {
    id: r.id,
    title: r.title_en ?? r.original_title,
    titleRu: r.title_ru,
    originalTitle: r.original_title,
    year: r.release_date ? Number(r.release_date.slice(0, 4)) : null,
    posterPath: r.poster_path,
    posterPathRu: r.poster_path_ru,
    voteAverage: r.vote_average,
    voteCount: r.vote_count,
  };
}

export function popularMoviesStmt(limit: number): Stmt {
  return {
    sql: `SELECT ${CARD_COLUMNS} FROM tmdb_movies m ${TRANSLATION_JOINS}
      WHERE m.state = 'active' ORDER BY m.vote_count DESC, m.id LIMIT ?`,
    params: [limit],
  };
}

/** Same folding as the FTS index (migration 0001): ё → е. Case is folded by the unicode61 tokenizer. */
export function foldSearchText(s: string): string {
  return s.normalize("NFC").replaceAll("ё", "е").replaceAll("Ё", "Е");
}

/**
 * User input → safe FTS5 query: every word becomes a quoted prefix term, all terms must match.
 * Returns null when nothing searchable remains (punctuation only, too short).
 */
export function toFtsQuery(input: string, maxTerms = 8): string | null {
  const terms = foldSearchText(input)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, maxTerms);
  if (terms.length === 0 || terms.join("").length < 2) return null;
  return terms.map((t) => `"${t.replaceAll('"', '""')}"*`).join(" ");
}

export function searchMoviesStmt(input: string, limit: number): Stmt | null {
  const match = toFtsQuery(input);
  if (!match) return null;
  return {
    sql: `SELECT ${CARD_COLUMNS} FROM tmdb_movie_search s
      JOIN tmdb_movies m ON m.id = s.rowid ${TRANSLATION_JOINS}
      WHERE tmdb_movie_search MATCH ? AND m.state = 'active'
      ORDER BY m.vote_count DESC, m.id LIMIT ?`,
    params: [match, limit],
  };
}

/** Five statements, meant for one D1 batch (one round trip). Feed the results to assembleMovieDetail. */
export function movieDetailStmts(id: number): Stmt[] {
  return [
    {
      sql: `SELECT ${CARD_COLUMNS}, m.runtime, m.backdrop_path, m.imdb_id,
          en.overview AS overview_en, ru.overview AS overview_ru, en.tagline AS tagline_en, ru.tagline AS tagline_ru
        FROM tmdb_movies m ${TRANSLATION_JOINS} WHERE m.id = ? AND m.state = 'active'`,
      params: [id],
    },
    {
      sql: `SELECT mg.genre_id AS id, g.name_en, g.name_ru FROM tmdb_movie_genres mg
        LEFT JOIN tmdb_genres g ON g.id = mg.genre_id WHERE mg.movie_id = ? ORDER BY g.name_en`,
      params: [id],
    },
    {
      sql: `SELECT c.kind, c.character, c.job, c.ord, p.id, p.name, p.profile_path FROM tmdb_movie_credits c
        JOIN tmdb_people p ON p.id = c.person_id WHERE c.movie_id = ? ORDER BY c.kind, c.ord`,
      params: [id],
    },
    {
      sql: `SELECT key, name, iso_639_1 FROM tmdb_videos WHERE movie_id = ?
        ORDER BY (type = 'Trailer') DESC, official DESC, (iso_639_1 = 'en') DESC, published_at DESC LIMIT 1`,
      params: [id],
    },
    {
      sql: `SELECT certification FROM tmdb_release_dates WHERE movie_id = ? AND country = 'US'
        AND certification IS NOT NULL ORDER BY type LIMIT 1`,
      params: [id],
    },
  ];
}

type Row = Record<string, unknown>;

export function assembleMovieDetail([movieRows, genreRows, creditRows, videoRows, certRows]: Row[][]): MovieDetail | null {
  const m = movieRows?.[0];
  if (!m) return null;
  const credits = (creditRows ?? []) as {
    kind: "cast" | "crew";
    character: string | null;
    job: string | null;
    id: number;
    name: string;
    profile_path: string | null;
  }[];
  const person = (c: (typeof credits)[number]): PersonCredit => ({ id: c.id, name: c.name, profilePath: c.profile_path });
  const video = videoRows?.[0] as { key: string; name: string; iso_639_1: string } | undefined;
  return {
    ...toMovieCard(m as unknown as MovieCardRow),
    overview: (m.overview_en as string | null) ?? null,
    overviewRu: (m.overview_ru as string | null) ?? null,
    tagline: (m.tagline_en as string | null) ?? null,
    taglineRu: (m.tagline_ru as string | null) ?? null,
    releaseDate: (m.release_date as string | null) ?? null,
    runtime: (m.runtime as number | null) ?? null,
    backdropPath: (m.backdrop_path as string | null) ?? null,
    imdbId: (m.imdb_id as string | null) ?? null,
    certification: ((certRows?.[0] as { certification?: string } | undefined)?.certification ?? null) || null,
    genres: ((genreRows ?? []) as { id: number; name_en: string | null; name_ru: string | null }[]).map((g) => ({
      id: g.id,
      name: g.name_en,
      nameRu: g.name_ru,
    })),
    directors: dedupe(credits.filter((c) => c.kind === "crew" && c.job === "Director").map(person)),
    writers: credits
      .filter((c) => c.kind === "crew" && (c.job === "Writer" || c.job === "Screenplay"))
      .map((c) => ({ ...person(c), job: c.job as string })),
    cast: credits.filter((c) => c.kind === "cast").map((c) => ({ ...person(c), character: c.character })),
    trailer: video ? { key: video.key, name: video.name, lang: video.iso_639_1 } : null,
  };
}

function dedupe<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  return items.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
}
