/** Server-side reads of the tmdb_* tables (owned by the sync pipeline) through the shared D1 binding. */
import {
  assembleMovieDetail,
  type MovieCard,
  type MovieCardRow,
  type MovieDetail,
  movieDetailStmts,
  popularMoviesStmt,
  searchMoviesStmt,
  type Stmt,
  toMovieCard,
} from "@movies/tmdb";

const prepare = (db: D1Database, s: Stmt) => db.prepare(s.sql).bind(...s.params);

export async function popularMovies(db: D1Database, limit: number): Promise<MovieCard[]> {
  const { results } = await prepare(db, popularMoviesStmt(limit)).all<MovieCardRow>();
  return results.map(toMovieCard);
}

export async function searchMovies(db: D1Database, q: string, limit: number): Promise<MovieCard[]> {
  const stmt = searchMoviesStmt(q, limit);
  if (!stmt) return [];
  const { results } = await prepare(db, stmt).all<MovieCardRow>();
  return results.map(toMovieCard);
}

export async function movieDetail(db: D1Database, id: number): Promise<MovieDetail | null> {
  const results = await db.batch(movieDetailStmts(id).map((s) => prepare(db, s)));
  return assembleMovieDetail(results.map((r) => r.results as Record<string, unknown>[]));
}
