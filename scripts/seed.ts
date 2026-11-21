/**
 * Seed D1 from the R2 raw archive (SPEC § 5.4), using the SAME normalizer/writer as the queue consumer.
 *
 *   pnpm seed                         # local D1 ← local R2 (wrangler dev state)
 *   pnpm seed -- --limit 500          # only the first 500 archived movies
 *   pnpm seed -- --ids 694,1091       # specific movies
 *   pnpm seed -- --remote             # dry run against the cloud: counts objects, writes nothing
 *   pnpm seed -- --remote --yes       # really write to the cloud D1 (costs D1 row writes!)
 *   pnpm seed -- --remote-db --yes    # cloud D1 ← LOCAL R2 (copy a locally crawled dataset to the cloud)
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { getMovieMeta, getPinned, getRaw, RAW_PREFIX, rawKey, refreshGenres, runStatementGroups, setState } from "@movies/sync/store";
import { buildMovieWrite, decideState, normalizeMovie, type Stmt, TmdbClient, type TmdbMovie } from "@movies/tmdb";
import { parse as parseJsonc } from "jsonc-parser";
import { getPlatformProxy } from "wrangler";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKER_DIR = path.join(ROOT, "workers", "sync");
const CONFIG = path.join(WORKER_DIR, "wrangler.jsonc");
const PERSIST = path.join(WORKER_DIR, ".wrangler", "state", "v3"); // matches `wrangler dev --persist-to .wrangler/state`

// pnpm 11+ forwards the "--" from `pnpm seed -- --flag`; node's parseArgs would treat what follows as positionals.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: {
    remote: { type: "boolean", default: false },
    "remote-db": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    limit: { type: "string" },
    ids: { type: "string" },
    "batch-size": { type: "string", default: "50" },
    "skip-genres": { type: "boolean", default: false },
  },
});

interface SeedEnv {
  DB: D1Database;
  RAW: R2Bucket;
  TMDB_READ_ACCESS_TOKEN?: string;
  TMDB_TOKEN?: string;
}

/** Remote seeding: a temporary config that marks DB (and, unless dbOnly, RAW) as remote bindings. */
function writeRemoteConfig(dbOnly: boolean): string {
  const cfg = parseJsonc(fs.readFileSync(CONFIG, "utf8")) as Record<string, unknown> & {
    d1_databases?: Record<string, unknown>[];
    r2_buckets?: Record<string, unknown>[];
  };
  if (!cfg.d1_databases?.every((d) => d.database_id)) {
    throw new Error("wrangler.jsonc has no database_id yet — create the cloud D1 first (docs/RUNBOOK.md § Cloud setup).");
  }
  for (const b of [...(cfg.d1_databases ?? []), ...(dbOnly ? [] : (cfg.r2_buckets ?? []))]) b.remote = true;
  delete cfg.queues;
  delete cfg.workflows;
  const out = path.join(WORKER_DIR, "wrangler.seed-remote.jsonc");
  fs.writeFileSync(out, JSON.stringify(cfg, null, 2));
  return out;
}

async function* listKeys(bucket: R2Bucket, limit: number): AsyncGenerator<string> {
  let cursor: string | undefined;
  let n = 0;
  do {
    const page = await bucket.list({ prefix: RAW_PREFIX, limit: 1000, ...(cursor ? { cursor } : {}) });
    for (const o of page.objects) {
      if (n++ >= limit) return;
      yield o.key;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function main(): Promise<void> {
  const remoteDbOnly = values["remote-db"];
  const remote = values.remote || remoteDbOnly;
  const limit = values.limit ? Number(values.limit) : Number.POSITIVE_INFINITY;
  const batchSize = Number(values["batch-size"]);
  const configPath = remote ? writeRemoteConfig(remoteDbOnly) : CONFIG;
  const proxy = await getPlatformProxy<SeedEnv>({ configPath, persist: { path: PERSIST }, remoteBindings: remote });
  const env = proxy.env;
  const started = Date.now();

  try {
    const keys: string[] = [];
    if (values.ids) keys.push(...values.ids.split(",").map((s) => rawKey(Number(s.trim()))));
    else for await (const k of listKeys(env.RAW, limit)) keys.push(k);
    console.log(`${remoteDbOnly ? "cloud D1 ← LOCAL R2" : remote ? "REMOTE" : "local"} seed: ${keys.length} archived movies found`);

    if (remote && !values.yes) {
      console.log("Dry run. Writing to the cloud D1 costs real row writes (~160–185 per movie, measured). Re-run with --yes to proceed.");
      return;
    }

    const now = Date.now();
    let rows = 0;
    let written = 0;
    let skipped = 0;
    let missing = 0;
    for (let i = 0; i < keys.length; i += batchSize) {
      const chunk = keys.slice(i, i + batchSize);
      const raws = await Promise.all(chunk.map((k) => getRaw(env.RAW, k)));
      const movies = raws.flatMap((r) => (r ? [{ movie: JSON.parse(r.text) as TmdbMovie, fetchedAt: r.fetchedAt }] : []));
      missing += raws.length - movies.length;
      const ids = movies.map((m) => m.movie.id);
      const [meta, pinned] = await Promise.all([getMovieMeta(env.DB, ids), getPinned(env.DB, ids)]);
      const groups: Stmt[][] = [];
      for (const { movie, fetchedAt } of movies) {
        const n = normalizeMovie(movie);
        const existing = meta.get(n.id) ?? null;
        const state = decideState({ movie: n, existingState: existing?.state ?? null, pinned: pinned.has(n.id) });
        if (!existing && state !== "active") {
          skipped++;
          continue;
        }
        groups.push(buildMovieWrite(n, existing?.hashes ?? null, { syncedAt: fetchedAt, now, state }).stmts);
      }
      rows += await runStatementGroups(env.DB, groups);
      written += groups.length;
      process.stdout.write(`\r  ${Math.min(i + batchSize, keys.length)}/${keys.length} movies · ${rows.toLocaleString("en-US")} rows written`);
    }
    process.stdout.write("\n");

    const token = env.TMDB_READ_ACCESS_TOKEN || env.TMDB_TOKEN;
    if (!values["skip-genres"] && token) rows += await refreshGenres(env.DB, new TmdbClient({ token }));
    await setState(env.DB, "seeded_at", now, now);
    console.log(
      `done in ${Math.round((Date.now() - started) / 1000)} s: ${written} movies written, ${skipped} not qualifying, ` +
        `${missing} missing, ${rows.toLocaleString("en-US")} D1 rows written`,
    );
  } finally {
    await proxy.dispose();
    if (remote) fs.rmSync(configPath, { force: true });
  }
}

await main();
