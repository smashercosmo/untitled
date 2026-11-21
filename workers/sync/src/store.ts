/**
 * D1 + R2 operations shared by the Worker and the Node seed script (via getPlatformProxy).
 * Keep this module free of `cloudflare:*` imports so it also runs under Node.
 */
import {
  buildGenreUpsert,
  insertMany,
  type MovieState,
  parseSectionHashes,
  type SectionHashes,
  type Stmt,
  type TmdbClient,
} from "@movies/tmdb";

// ---------- R2 raw archive ----------

export const RAW_PREFIX = "raw/movie/";
export const rawKey = (id: number): string => `${RAW_PREFIX}${id}.json.gz`;
export function idFromRawKey(key: string): number | null {
  const m = /^raw\/movie\/(\d+)\.json\.gz$/.exec(key);
  return m ? Number(m[1]) : null;
}

export async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

export async function gunzip(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

export async function putRaw(bucket: R2Bucket, id: number, text: string, fetchedAt: number): Promise<void> {
  await bucket.put(rawKey(id), await gzip(text), {
    httpMetadata: { contentType: "application/gzip" },
    customMetadata: { fetched_at: String(fetchedAt), format: "tmdb-movie-json+gzip" },
  });
}

export async function getRaw(bucket: R2Bucket, key: string): Promise<{ text: string; fetchedAt: number } | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const fetchedAt = Number(obj.customMetadata?.fetched_at) || obj.uploaded.getTime();
  return { text: await gunzip(await obj.arrayBuffer()), fetchedAt };
}

export async function rawFetchedAt(bucket: R2Bucket, id: number): Promise<number | null> {
  const head = await bucket.head(rawKey(id));
  if (!head) return null;
  return Number(head.customMetadata?.fetched_at) || head.uploaded.getTime();
}

// ---------- D1 helpers ----------

/**
 * Executes per-movie statement groups. A group is never split across batches, and each db.batch()
 * is a transaction, so a movie is either fully written (incl. its section_hashes) or not at all.
 * Returns the total rows written (meta.rows_written) — the spending guard's d1_rows_written input.
 */
export async function runStatementGroups(db: D1Database, groups: Stmt[][], maxPerBatch = 400): Promise<number> {
  let written = 0;
  let pending: Stmt[] = [];
  const flush = async () => {
    if (pending.length === 0) return;
    const results = await db.batch(pending.map((s) => db.prepare(s.sql).bind(...s.params)));
    for (const r of results) written += r.meta.rows_written ?? 0;
    pending = [];
  };
  for (const group of groups) {
    if (group.length === 0) continue;
    if (pending.length > 0 && pending.length + group.length > maxPerBatch) await flush();
    pending.push(...group);
  }
  await flush();
  return written;
}

export const runStatements = (db: D1Database, stmts: Stmt[]): Promise<number> => runStatementGroups(db, [stmts]);

export interface MovieMeta {
  id: number;
  state: MovieState;
  hashes: Partial<SectionHashes> | null;
  imdbId: string | null;
  wikidataId: string | null;
}

export async function getMovieMeta(db: D1Database, ids: number[]): Promise<Map<number, MovieMeta>> {
  const out = new Map<number, MovieMeta>();
  if (ids.length === 0) return out;
  const { results } = await db
    .prepare(
      "SELECT id, state, section_hashes, imdb_id, wikidata_id FROM tmdb_movies WHERE id IN (SELECT value FROM json_each(?1))",
    )
    .bind(JSON.stringify(ids))
    .all<{ id: number; state: MovieState; section_hashes: string | null; imdb_id: string | null; wikidata_id: string | null }>();
  for (const r of results) {
    out.set(r.id, {
      id: r.id,
      state: r.state,
      hashes: parseSectionHashes(r.section_hashes),
      imdbId: r.imdb_id,
      wikidataId: r.wikidata_id,
    });
  }
  return out;
}

export async function getPinned(db: D1Database, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare("SELECT movie_id FROM tmdb_pinned_movies WHERE movie_id IN (SELECT value FROM json_each(?1))")
    .bind(JSON.stringify(ids))
    .all<{ movie_id: number }>();
  return new Set(results.map((r) => r.movie_id));
}

// ---------- sync state (key/value) ----------

export async function getState<T>(db: D1Database, key: string): Promise<T | null> {
  const row = await db.prepare("SELECT value FROM tmdb_sync_state WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? (JSON.parse(row.value) as T) : null;
}

export function setStateStmt(key: string, value: unknown, now: number): Stmt {
  return {
    sql:
      "INSERT INTO tmdb_sync_state (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    params: [key, JSON.stringify(value), now],
  };
}

export async function setState(db: D1Database, key: string, value: unknown, now: number): Promise<void> {
  await runStatements(db, [setStateStmt(key, value, now)]);
}

// ---------- per-run counters (drain detection + daily summary) ----------

export function addRunCountersStmts(runId: string, counters: Record<string, number>): Stmt[] {
  const rows = Object.entries(counters)
    .filter(([, v]) => v !== 0)
    .map(([metric, value]) => [runId, metric, value]);
  return insertMany(
    "tmdb_run_counters",
    ["run_id", "metric", "value"],
    rows,
    "ON CONFLICT(run_id, metric) DO UPDATE SET value = value + excluded.value",
  );
}

export function setRunCounterStmt(runId: string, metric: string, value: number): Stmt {
  return {
    sql:
      "INSERT INTO tmdb_run_counters (run_id, metric, value) VALUES (?, ?, ?) " +
      "ON CONFLICT(run_id, metric) DO UPDATE SET value = excluded.value",
    params: [runId, metric, value],
  };
}

export async function getRunCounters(db: D1Database, runId: string): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT metric, value FROM tmdb_run_counters WHERE run_id = ?")
    .bind(runId)
    .all<{ metric: string; value: number }>();
  return Object.fromEntries(results.map((r) => [r.metric, r.value]));
}

// ---------- genres ----------

/** Refreshes English + Russian genre names (2 TMDB requests). Returns rows written. */
export async function refreshGenres(db: D1Database, client: TmdbClient): Promise<number> {
  const [en, ru] = await Promise.all([client.genres("en"), client.genres("ru")]);
  if (!en.ok) throw new Error(`genre list (en) failed: ${en.status} ${en.message}`);
  if (!ru.ok) throw new Error(`genre list (ru) failed: ${ru.status} ${ru.message}`);
  const ruNames = new Map(ru.data.genres.map((g) => [g.id, g.name]));
  return runStatements(
    db,
    buildGenreUpsert(en.data.genres.map((g) => ({ id: g.id, name_en: g.name, name_ru: ruNames.get(g.id) ?? null }))),
  );
}
