# Movie app — TMDB sync: specification

**Status:** approved 2026-11-11 (design interview Q1–Q32). This is the source of truth. `PRD.md` was the first draft and is superseded wherever the two differ (see § Changes vs PRD).
**Knowledge base:** measured facts live in [`docs/knowledge/`](knowledge/): [tmdb.md](knowledge/tmdb.md), [cloudflare.md](knowledge/cloudflare.md), [void.md](knowledge/void.md).
**Maintenance rule:** update this file whenever a decision or assumption changes. Mark superseded decisions instead of deleting them.

---

## 1. Goal and scope

A hobby movie app focused on **Horror and Thriller** films. The UI will be in English and Russian.

| Phase | What | Status |
|---|---|---|
| 1 | **TMDB → R2 → D1 sync pipeline and data model** | this spec |
| 2 | App (API and frontend) on [Void](knowledge/void.md), deployed **directly into our Cloudflare account**, reading the same D1 | later |

### Constraints

- **Non-commercial hobby project.** Any AI experiments over TMDB data stay private, because public AI features count as commercial use under TMDB's terms. The app must show TMDB's logo and attribution notice.
- **Budget:** Workers Paid, $5/mo. Steady state stays within the included quotas.
- **Local first.** Build and test everything locally (`wrangler dev`, with local D1, R2, Queues and Workflows, calling the real TMDB API). Then run a few field tests in the cloud.
- **TMDB's 6-month storage rule.** Nothing we store, in D1 or R2, is ever older than **90 days**. A purge-everything runbook exists for license termination.

---

## 2. Data scope

### Which movies get in

A movie enters when it has the Horror (27) **or** Thriller (53) genre, is not `adult`, is not `video`, **and has `vote_count ≥ 5`** (about 40k movies on 2026-11-11).

- **Entry rule only (Q30).** Once a movie is in, it leaves only if it **loses both genres** or is **deleted** on TMDB. A vote-count drop never removes it.
- **Pinned movies (Q31):** `tmdb_pinned_movies` holds movies that stay synced even when they no longer qualify. The app will fill it from user data. It's empty in phase 1.
- Locally we start with a subset: the top N by vote count (2–5k).

### People

People are built **only from movie credits**; there are no person-detail fetches (Q3, Q15):

- Credits kept per movie: the **top 15 cast** plus crew with job **Director, Writer or Screenplay** (Q27). About 16 rows per movie.
- Person columns: `id, name, original_name, gender, known_for_department, profile_path, adult`. No bio, birthday or Russian names; movie credits don't include them.
- A person is updated whenever any movie crediting them is refetched, so person data is never older than 90 days.

### Languages and fields

- **Languages:** `en` and `ru`. The app shows Russian, then English, then the original title. Only real translations are stored (82% of sampled movies have Russian).
- **Popularity:** not stored or refreshed (Q16).
- **Fetch wide, store narrow (Q14).** R2 keeps the full response. D1 keeps only the columns in § 4. Adding a column later means rebuilding from R2, with no TMDB calls.
  - Stored in D1: core fields, Russian/English translations, genres (names in English and Russian), keywords, production companies, production countries, collection, US and RU release dates and certifications, and YouTube trailers and teasers in English and Russian.
  - Kept in R2 only, for now: alternative titles, watch providers, the full image lists, spoken languages, and every other language's translations.
  - The search index (FTS5) is deferred to phase 2. It's additive and can be built from the tables.
- **Images** are never copied. We store `poster_path` and `backdrop_path` and serve them from `image.tmdb.org`. The Russian poster is the top-voted `ru` entry in `images.posters`.

---

## 3. Architecture

```
Workflow "tmdb-sync"  (schedules: daily 09:00 UTC; also triggered manually)
  mode=bootstrap | daily | replay
   1. guard check (circuit breaker tripped? → alert and stop)
   2. refresh genre names (en and ru: 2 requests)
   3. membership: /discover Horror|Thriller, vote_count ≥ 5, in vote_count slices (≤ 10k each)
   4. daily only: compare membership with D1 → new / gone
                  /movie/changes since last_success − 1 day (≤ 14 days) ∩ D1 → changed
                  sweep: the oldest last_synced_at, ≈ active/80 per day → ≤ 90-day cycle
                  purge: soft-deleted rows older than 90 days, orphaned people, their R2 objects
   5. enqueue {movie id, mode, reason} in batches of 100  ──►  Queue "tmdb-fetch"
   6. wait for the queue to drain (step.sleep polling) → record last_success → Telegram summary

Queue consumer (same Worker, max_concurrency: 1  ⇒  it is the global rate limiter)
   ├─ guard: daily counters; if a cap is hit → set the rest aside, alert, stop
   ├─ paced fetches: ≤ TMDB_RPS (20/s), ≤ 6 in flight, 15 s timeout
   ├─ GET /movie/{id}?…append_to_response…   (one request per movie)
   ├─ write raw JSON → R2  raw/movie/{id}.json.gz
   ├─ mode=sync: normalize → rewrite only changed sections → one db.batch per message batch
   └─ 429/5xx/network → retry with exponential backoff + jitter;
      after 5 attempts → DLQ "tmdb-fetch-dlq" → tmdb_sync_failures (+ Telegram)

Seed script (Node, getPlatformProxy): read R2 → the same normalizer → D1 (local or remote)
```

### Why this shape

- **No shared rate-limiter Durable Object (Q18).** A single consumer (`max_concurrency: 1`) paces itself. The Workflow's own discover calls are paced separately at `DISCOVER_RPS` (10/s), so the total stays under about 30/s, against TMDB's roughly 40/s.
- **Two stages (Q11).** Bootstrap runs in `crawl` mode, which writes **R2 only**. Then the seed script builds D1 from R2. Afterwards the daily run (`sync` mode) writes R2 and D1 together. Rebuilding D1 from R2 is a routine operation.
- **Membership comes from discover (Q25),** not from the export files, because genres aren't in the exports. The export files aren't used.

---

## 4. Database (D1)

**One D1 database** (`movies`), shared later with the Void app (Q13).

- All TMDB tables use the `tmdb_` prefix.
- TMDB migrations run through Wrangler with their own history: `migrations_dir: packages/tmdb/migrations`, `migrations_table: tmdb_migrations`.
- Void keeps its own migration history for user tables (Q26).
- The tables are defined in Drizzle in `packages/tmdb/src/schema.ts`. Migrations are generated with `drizzle-kit generate`. The app imports these definitions for typed reads, **never** in Void's `db/schema.ts`.
- User tables don't declare foreign keys to `tmdb_*` tables. Remapping is done in code (§ 6).

| Table | Key | Contents |
|---|---|---|
| `tmdb_movies` | `id` | imdb_id, wikidata_id, original_title, original_language, release_date, runtime, status, budget, revenue, vote_average, vote_count, poster_path, poster_path_ru, backdrop_path, collection_id, homepage, **state** (`active`/`excluded`/`deleted`), state_changed_at, first_seen_at, last_synced_at, section_hashes (JSON) |
| `tmdb_movie_translations` | (movie_id, lang) | lang ∈ {en, ru}; title, overview, tagline |
| `tmdb_genres` | `id` | name_en, name_ru |
| `tmdb_movie_genres` | (movie_id, genre_id) | |
| `tmdb_keywords` / `tmdb_movie_keywords` | id / (movie_id, keyword_id) | name |
| `tmdb_companies` / `tmdb_movie_companies` | id / (movie_id, company_id) | name, logo_path, origin_country |
| `tmdb_movie_countries` | (movie_id, iso_3166_1) | production countries |
| `tmdb_collections` | `id` | name, poster_path, backdrop_path (English only) |
| `tmdb_release_dates` | (movie_id, country, ord) | country ∈ {US, RU}; type, release_date, certification, note |
| `tmdb_videos` | `id` (TMDB video id) | movie_id, iso_639_1, key, name, type ∈ {Trailer, Teaser}, official, published_at; YouTube only |
| `tmdb_people` | `id` | name, original_name, gender, known_for_department, profile_path, adult |
| `tmdb_movie_credits` | `credit_id` | movie_id, person_id, kind (cast/crew), character, job, ord |
| `tmdb_movie_redirects` | `old_id` | new_id, method (imdb/wikidata), created_at |
| `tmdb_pinned_movies` | `movie_id` | reason, created_at |
| `tmdb_sync_state` | `key` | JSON value: last_success_date, guard_tripped, seeded_at |
| `tmdb_sync_runs` | `run_id` | mode, started_at, finished_at, status, stats JSON |
| `tmdb_run_counters` | (run_id, metric) | per-run counters: enqueued, enqueued_extra, processed, dead, fetched, changed, unchanged, … (drain detection + summary) |
| `tmdb_guard_counters` | (day, metric) | value; metric ∈ {tmdb_requests, r2_writes, d1_rows_written} |
| `tmdb_parked` | `movie_id` | messages set aside while the guard is tripped |
| `tmdb_sync_failures` | autoincrement id | movie_id, reason, error, attempts, created_at, resolved_at |
| `tmdb_movie_search` | rowid = movie id | **FTS5** virtual table: original_title, title_en, title_ru (match text only). Kept in sync by triggers (migration `0001_movie_search`). |

Migrations: `0000_init` (tables), `0001_movie_search` (FTS5 + 6 triggers + backfill, hand-written via `drizzle-kit generate --custom`), `0002_movie_votes_index` (`(state, vote_count)` for "most popular").

### Write rules

- Every write is idempotent: `INSERT … ON CONFLICT DO UPDATE`, keyed by TMDB ID.
- **Hash per section.** Each movie has a hash for each section: core, translations, genres, keywords, companies, countries, collection, release_dates, videos and credits. Only sections whose hash changed are rewritten. Child tables are rewritten by deleting the movie's rows and inserting the new set.
- A vote-count change rewrites only the `tmdb_movies` row.
- People are upserted only when the credits section changes. `DO UPDATE … WHERE` skips no-op updates.

### 4.1 Search index and app reads

- **Search:** FTS5 over the original, English and Russian titles, using the `unicode61 remove_diacritics 2` tokenizer.
  - Case folding works for Cyrillic.
  - Latin diacritics are stripped, but **`remove_diacritics` doesn't fold Cyrillic `ё`**. So `ё`→`е` is applied by hand, in the trigger SQL and in `foldSearchText()` on queries.
  - Each word of the query becomes a quoted prefix term, and all of them must match: `toFtsQuery("Тёмный рыц")` gives `"Темный"* "рыц"*`. Quoting makes any user input safe.
  - Results are active movies only, ordered by `vote_count` descending.
- **Triggers** on `tmdb_movies` (insert, title update, delete) and `tmdb_movie_translations` (insert, update, delete) rebuild a movie's row in the index. The sync and seed code needed no changes. The index adds about 2 rows written per movie.
- **"Most popular"** means the most-voted active movies. TMDB's popularity metric isn't stored (Q16); vote count is stable.
- **Read queries** (`popularMoviesStmt`, `searchMoviesStmt`, `movieDetailStmts` + `assembleMovieDetail`) live in `packages/tmdb/src/queries.ts` as SQL with row mappers. They're tested with `node:sqlite` against the real migrations and used by the app over the raw D1 binding.
  - The movie page is one D1 batch of five statements: movie with translations, genres, credits with people, the best trailer, and the US certification.

---

## 5. Pipeline details

### 5.1 Membership (discover slicing)

- Query: `/discover/movie?with_genres=27|53&include_adult=false&include_video=false&vote_count.gte=A&vote_count.lte=B&sort_by=primary_release_date.asc&page=p`.
- Slices are found by binary splitting of [MIN_VOTE_COUNT, ∞) until each slice has ≤ 10,000 results. Discover allows 500 pages of 20, and `total_results` is capped at 20,001.
- Each slice is its own Workflow step and returns the IDs (with `vote_count`) it found. Membership is the union of the slices.
- Results can shift between pages while we page through them; that's tolerated. A falsely missing movie is refetched as "gone", found to still qualify, and updated normally.

### 5.2 Daily run

| Set | Definition | Message reason |
|---|---|---|
| new | in membership, not in D1 | `new` |
| gone | active in D1, not in membership, not pinned | `gone` |
| changed | `/movie/changes` IDs ∩ D1 (active or pinned), from `coveredSince − 1 day` (clamped to 14 days) up to today. `coveredSince` = last_success, or before the first successful run the day of the oldest `last_synced_at` (e.g. the bootstrap crawl) | `changed` |
| sweep | the oldest `last_synced_at` among active and pinned movies; limit = ceil(count/80) per day | `sweep` |
| catch-up | if `coveredSince` is more than 13 days ago (window `gap`): every movie with `last_synced_at` before the window start | `sweep` |

- **Subset runs (local):** the `limit` param (bootstrap and daily) restricts membership to the top-N by votes, fetched with one discover query sorted `vote_count.desc` (N ≤ 10k). Use the same `limit` for bootstrap and daily, or the daily run treats everything outside the subset as `new`. Scheduled (cron) runs have no limit.

- A movie is enqueued once per run, with priority gone > new > changed > sweep.
- The run waits for the queue to drain: it polls per-run counters every 5 minutes, up to 6 hours. It then records `last_success_date` and sends the Telegram summary.

### 5.3 What the consumer does with each response

| Response | Action |
|---|---|
| 200, qualifies (genres ∋ 27 or 53, not adult or video; new movies also need vote_count ≥ 5) | upsert, `state=active` |
| 200, doesn't qualify, pinned | upsert, stays active |
| 200, doesn't qualify, not pinned | `state=excluded` (soft-delete) |
| 404 | deletion flow (§ 6) |
| 429 / 5xx / timeout | retry the remaining batch with exponential backoff and jitter (30 s × 2^attempt, up to 30 min). TMDB sends no `Retry-After`. |
| 401 | fatal: alert, stop the batch, set the rest aside |

In crawl mode the consumer writes R2 only. It skips a movie whose R2 object was fetched less than 24 hours ago, so a bootstrap can be resumed safely.

### 5.4 Seed script

`scripts/seed.ts` is a Node script that uses Wrangler's `getPlatformProxy()`:

- It lists `raw/movie/*.json.gz` in R2 and runs **the same normalizer and writer** as the consumer, in batches.
- Works against local storage by default, or remote with `--remote`. Supports `--limit N` and `--ids`.
- Sets `tmdb_sync_state.seeded_at`.
- Every remote seed costs real D1 row writes. **Measured on 2026-11-11: 184 rows per movie** for the 300 most-voted movies, and **162 per movie** for the top 2,000 (324,557 rows; RUNBOOK § 3a). The most-voted movies are the most data-rich, and index entries count as writes. The long tail is lighter. About 40k movies → **about 4–7M rows**, still inside the included 50M a month.
- `--remote` is a dry run (it only counts objects) unless `--yes` is also passed.

---

## 6. Deletions and redirects (Q19, Q28)

1. A 404 → look up the stored `imdb_id` with `/find/{imdb_id}?external_source=imdb_id`, falling back to `wikidata_id`.
2. **Exactly one** surviving movie found → insert `tmdb_movie_redirects(old→new)` and enqueue the new ID. In phase 2, user rows are moved to the new ID in the same transaction, and the app redirects old URLs.
3. Otherwise → `state=deleted` (soft-delete), and the failure is listed in the Telegram summary for manual review.
4. **Purge:** rows with `state ∈ {excluded, deleted}` for more than 90 days are removed from D1 along with their R2 object. People with no remaining credits are purged too.

---

## 7. Cost guard and safety (Q29)

Cloudflare has **no hard spending cap**; budget alerts send email only, a day late ([cloudflare.md](knowledge/cloudflare.md#billing-safety)). So:

1. **Budget alerts** at $1, $5 and $10. The $10 one already exists.
2. **Circuit breaker** (`tmdb_guard_counters`, per UTC day). The counters come from real numbers: TMDB requests made, R2 puts, and summed `meta.rows_written`.

   | Metric | Daily cap (var) |
   |---|---|
   | TMDB requests | `GUARD_MAX_TMDB_REQUESTS` = 50,000 |
   | R2 writes | `GUARD_MAX_R2_WRITES` = 50,000 |
   | D1 rows written | `GUARD_MAX_D1_ROWS` = 1,000,000 |

   When a cap is hit, the guard sets `guard_tripped`, puts the remaining messages into `tmdb_parked` and acknowledges them, and sends an immediate Telegram alert (once). Everything stops until a manual resume (`mode=replay` after clearing the flag). The worst case if stuck at the caps for a month is about $2–3 of overage.
3. **Fuses:**
   - `max_concurrency: 1`, `max_retries: 5`, a dead-letter queue.
   - Workflow `limits.steps: 2000`; Worker `limits.cpu_ms` and `limits.subrequests`.
   - Queue message retention of 4 days.
4. **No public surface.** `workers_dev: false`, `preview_urls: false`, no routes, and **no `fetch` handler at all**. Runs are started by the Workflow schedule or `wrangler workflows trigger tmdb-sync '<json>'`, which accepts `--local` against `wrangler dev`. *(Superseded: the earlier plan for a `LOCAL_ADMIN`-gated admin endpoint was dropped once `--local` triggers became available.)*
5. **Kill switch** ([RUNBOOK.md](RUNBOOK.md)): `wrangler queues pause-delivery tmdb-fetch`, `wrangler queues purge tmdb-fetch`, and terminating the Workflow instance.

Phase-2 note: the public Void app needs a WAF rate-limiting rule against bot floods, which are billed per request.

---

## 8. Observability

- Workers Logs on (`observability.enabled`). Logs are structured JSON with `run_id`, `movie_id` and `reason`.
- **Telegram** (secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`):
  - Immediately: guard tripped, 401 from TMDB, run failed, dead-letter queue not empty.
  - Daily summary: enqueued per reason, fetched, changed sections, rows written, 429s, failures, parked, duration.
- Without Telegram secrets (e.g. in tests), notifications go to the console log.

---

## 9. Repo, tooling and environments (Q10, Q23, Q32)

```
/                       pnpm workspace root (Node 24, TypeScript, Wrangler)
├─ packages/tmdb/       config, TMDB client, normalizer, hashing, Drizzle schema, migrations, D1 writer
├─ workers/sync/        Wrangler Worker: Workflow, queue + DLQ consumers, guard, Telegram (own wrangler.jsonc)
├─ scripts/             seed.ts, fixtures-refresh.ts
├─ apps/web/            Void test app (§ 12): React SPA + API routes, Better Auth, TanStack Query
└─ docs/                SPEC.md, RUNBOOK.md, knowledge/
```

- **No `wrangler.jsonc` at the repo root.** Void would try to take it over ([void.md](knowledge/void.md)).
- **Tests:** Vitest 5.
  - `packages/tmdb` runs under Node. The generated SQL is executed against the real migration with Node's built-in `node:sqlite`.
  - `workers/sync` runs in workerd through `@cloudflare/vitest-plugin`, the v1 rename of `@cloudflare/vitest-pool-workers`, with real local D1 and R2. TMDB responses are faked by passing a `fetch` function into the consumer, so no MSW is needed.
- **Fixtures:** hand-made, TMDB-shaped fake data is committed. `pnpm fixtures:refresh` downloads real samples into a gitignored `fixtures/real/` for local integration tests only.
- **Environments:** local plus one production; the field tests run against production resources. Deploys are manual (`wrangler deploy`); CI comes later.
- **Secrets:** `TMDB_READ_ACCESS_TOKEN` (v4, preferred; `TMDB_TOKEN` is accepted and auto-detected as v3 or v4), `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Locally in `.dev.vars` (gitignored); in production via `wrangler secret put`.
- D1 gets a Europe location hint (`weur`) when it's created in the cloud.

### Before the first cloud field test

- [x] R2 enabled (2026-11-11)
- [x] Telegram bot created and chat ID verified (2026-11-11)
- [x] TMDB v4 token added (2026-11-11)
- [x] Workers Paid plan active (confirmed by you, 2026-11-11)
- [x] Budget alerts at $1, $5 and $10 (2026-11-11)
- [x] D1 `movies` (weur) created: `f35b7e71-fda6-4a4c-9b3a-52dc23d72ed1`, in both configs (2026-11-11)
- [ ] R2 bucket `movies-tmdb-raw`, queues `tmdb-fetch` and `tmdb-fetch-dlq`, sync Worker secrets and deploy ([RUNBOOK § 4](RUNBOOK.md#4-cloud-setup-sync-pipeline-first-field-test))

---

## 9a. Implementation status (2026-11-11)

| Area | State |
|---|---|
| `packages/tmdb`: config, client, normalizer, hashing, Drizzle schema plus migrations `0000`–`0002`, SQL builders, planning, app read queries (FTS search, popular, detail) | ✅ 45 tests (counted 2026-11-21) |
| `workers/sync`: Workflow (bootstrap, daily, replay), queue and dead-letter consumers, guard, Telegram | ✅ 13 tests (workerd) |
| `scripts/seed.ts` (local and `--remote --yes`), `scripts/fixtures-refresh.ts` | ✅ local seed verified |
| Local end-to-end against the real TMDB API | ✅ bootstrap 300 → seed (55,208 rows, 13 s) → daily (166 refetched, all unchanged, drained, last_success set, Telegram summary sent) |
| Cloud: app-only test deploy | ✅ https://movies-web.smashercosmo.workers.dev (2026-11-11). Cloud D1 holds 2,000 movies copied from local R2 (`seed --remote-db`). Verified while signed out: pages and assets load, API returns 401, cloud search works. The signed-in flow on the live site hasn't been tried yet. No sync Worker, so the data doesn't refresh. Sign-up is open to anyone. |
| Cloud: sync pipeline field test | ⏳ checklist above |
| Test app `apps/web` (§ 12) | ✅ locally: sign up, sign in, sign out, search (en/ru), 4 most popular, movie page; typecheck and production build pass. Clicked through in Chrome (DevTools MCP) on 2026-11-11: no console errors. |

### Open questions and observations

- **"Thriller" on TMDB is broad.** In the top-300 local subset, 249 movies have Thriller and only 88 have Horror. The top four are The Dark Knight, Fight Club, Pulp Fiction and Joker. If the app is meant to be horror-centric, consider a narrower rule later, e.g. Horror OR (Thriller AND NOT Action/Crime). That is a one-line change in `qualify.ts` plus the discover filter.

---

## 12. Phase 2: test app (`apps/web`, 2026-11-11)

The request: a search field centred at the top, posters of the 4 most popular movies under it, sign up, sign in, sign out, search, and a movie page. React for the UI, TanStack Query for data.

| Decision | Choice and reason |
|---|---|
| App type | A Void **SPA + API** app: React in `src/`, routes in `routes/api/`. Pages mode was dropped, because TanStack Query does the client data fetching. |
| Data layer | **TanStack Query 5** on top of Void's typed `fetch` from `void/client/react`, so route paths, params and responses are type-checked. TanStack DB was skipped: still a release candidate (1.0.0-rc) and not needed for read-only lists. |
| Routing | A roughly 40-line `history` router (`src/router.tsx`). Four screens don't justify a router dependency. |
| Auth | Void-managed Better Auth with email and password (`auth.providers: ["email"]`). Every `/api/movies/*` route calls `requireAuth`, so **the whole app is for signed-in users**. Signed-out visitors go to `/signin?next=…`, and `next` only accepts same-app paths. Sign-out clears the TanStack Query cache. |
| Search UX | Debounced 250 ms, at least 2 characters, the query mirrored in `/?q=`. Results replace the poster grid. Enter opens the first result. |
| Movie page | Poster, titles (en/ru/original), year, US certification, runtime, rating, genres, tagline, overview (Russian overview in a collapsible section), director and writers, top-15 cast, an embedded YouTube trailer (`youtube-nocookie`). |
| Images | Hotlinked from `image.tmdb.org` (never copied). The TMDB logo and the exact attribution notice are in the footer; the logo file is self-hosted at `public/tmdb-logo.svg`. |
| Database | The same D1 binding `DB` as the sync Worker (Q13). The app reads `tmdb_*` with the SQL from `@movies/tmdb`. Void owns only `user`, `session`, `account`, `verification` and `_void_migrations`. |

### Findings while building (also in [void.md](knowledge/void.md))

1. **Sharing the local D1 between `wrangler dev` and Void's Vite dev server:**
   - Both use the same persist directory: `voidPlugin({ persistTo: "../../workers/sync/.wrangler/state" })` and `wrangler dev --persist-to .wrangler/state`.
   - Both use the same local database ID. Wrangler and the `void db …` CLI key the local D1 by `preview_database_id ?? database_id`, but **the Vite dev server keys it by `database_id` only**. Now that the real cloud ID is in both configs, everything keys by it and there's no `preview_database_id`. *(Superseded: before the cloud D1 existed, both configs used a `movies-local` placeholder.)*
2. **Void won't migrate a database that already has other tables but no Void history.** It suggests `void db reset`, which would wipe the TMDB data, so don't. Two ways round it:
   - **Fresh database:** run `void db migrate` **before** the TMDB migrations.
   - **Existing database:** adopt. Apply Void's SQL once (`wrangler d1 execute … --file`), then `INSERT INTO _void_migrations (name) VALUES ('<file>.sql')` (RUNBOOK § 1a).
3. **In SPA mode, any 404 from an API route, thrown or returned, falls through to `index.html` with status 200.** So "not found" is modelled as data (`{ movie: null }`). Invalid input uses a 400 (`HTTPException`), which passes through. The typed-fetch inference also needs plain returned objects, not `c.json()` unions.
4. Void requires **Node ≥ 24.22** (or ≥ 26.12). The root `package.json` declares `devEngines.runtime` = `node ^24.22.0` with `onFail: "download"`. pnpm downloads a matching Node and uses it for every `pnpm` script and `pnpm exec` (24.22.3 on 2026-11-21), even when the system Node is older. *(Superseded: this note used to say Node was pinned in `mise.toml`; that file doesn't exist. The range was `^24.0.0` until 2026-11-21.)*

---

## 10. Changes vs PRD.md

| PRD said | Now |
|---|---|
| A separate Cron Trigger Worker starts the Workflow | Workflow `schedules` (no separate Worker) |
| The export file is the full list of what should exist; compare against it daily | Exports aren't used: they have no genres. Membership comes from `/discover` slices |
| A Durable Object token bucket shared by many consumers | One consumer (`max_concurrency: 1`) paces itself |
| Honor `Retry-After` on 429 | TMDB sends no such header, so our own exponential backoff with jitter |
| Postgres for a serious app | D1, one database shared with the Void app; Postgres through Hyperdrive stays a future option |
| Movies, people, TV; bootstrap takes days | Horror/Thriller movies (vote_count ≥ 5) and people from their credits; about 40k movies, under an hour at 20/s |
| Refresh popularity daily from the export | No popularity |
| Monitoring with Analytics Engine | Workers Logs, guard counters and Telegram |
| Consumer writes D1 directly from the first fetch | Two stages: crawl into R2, seed D1 from R2, then daily sync to both |

---

## 11. Decision log

| # | Decision |
|---|---|
| Q1 | Phase 1 is the pipeline and data model; the app comes later on Void |
| Q2 | Hobby, non-commercial; AI experiments private |
| Q3, Q15 | Movies, plus people from credits (top 15 cast + Director/Writer/Screenplay) |
| Q4, Q13 | D1 only, one shared database |
| Q5 | en and ru |
| Q6, Q12, Q24 | Horror or Thriller, not adult or video, vote_count ≥ 5 |
| Q7 | Daily batch |
| Q8, Q17 | $5 plan, local first, a few cloud field tests |
| Q9 | Everything refreshed within 90 days; purge runbook |
| Q10 | Wrangler, TypeScript |
| Q11 | Crawl into R2, seed D1 from R2, one shared normalizer |
| Q14 | Fetch wide, store narrow (fields in § 2 and § 4) |
| Q16 | No popularity |
| Q18 | One self-pacing consumer, dead-letter queue, Workflow schedules |
| Q19, Q28 | Soft-delete, purge after 90 days, remap by IMDb/Wikidata ID, redirects table |
| Q20 | Telegram alerts and daily summary |
| Q22 | Void deploys directly into our Cloudflare account |
| Q23 | pnpm workspace: packages/tmdb, workers/sync, scripts, apps/web later |
| Q25 | Daily membership from discover; changes ∩ database; sweep |
| Q26 | TMDB tables `tmdb_*` with their own migration history; app tables owned by Void |
| Q27 | Writer means Writer + Screenplay, plus Director |
| Q29 | Budget alerts, in-code circuit breaker, fuses, kill switch |
| Q30 | vote_count ≥ 5 only controls entry |
| Q31 | Pinned movies stay synced |
| Q32 | Synthetic fixtures committed; real samples gitignored |
