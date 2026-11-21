/**
 * Downloads a few REAL TMDB responses into fixtures/real/ (gitignored) for local integration checks.
 * TMDB terms: never commit these, and delete them within 6 months — this script wipes old files first.
 *
 *   pnpm fixtures:refresh                 # top 5 Horror|Thriller movies by votes
 *   pnpm fixtures:refresh -- --ids 694,348
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { TmdbClient } from "@movies/tmdb";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "fixtures", "real");

function tokenFromDevVars(): string {
  const file = path.join(ROOT, ".dev.vars");
  const vars = Object.fromEntries(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
  );
  const token = process.env.TMDB_READ_ACCESS_TOKEN || vars.TMDB_READ_ACCESS_TOKEN || vars.TMDB_TOKEN;
  if (!token) throw new Error("No TMDB token in env or .dev.vars");
  return token;
}

// pnpm 11+ forwards the "--" from `pnpm fixtures:refresh -- --ids …`; drop it before parsing.
const argv = process.argv.slice(2);
const { values } = parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options: { ids: { type: "string" } } });
const client = new TmdbClient({ token: tokenFromDevVars() });

let ids: number[];
if (values.ids) ids = values.ids.split(",").map((s) => Number(s.trim()));
else {
  const res = await client.discover({ with_genres: "27|53", sort_by: "vote_count.desc", page: 1 });
  if (!res.ok) throw new Error(`discover failed: ${res.status} ${res.message}`);
  ids = res.data.results.slice(0, 5).map((r) => r.id);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const id of ids) {
  const res = await client.movie(id);
  if (!res.ok) {
    console.warn(`movie ${id}: ${res.status} ${res.message}`);
    continue;
  }
  fs.writeFileSync(path.join(OUT, `${id}.json`), res.text);
  console.log(`saved fixtures/real/${id}.json (${Math.round(res.text.length / 1024)} KB)`);
}
