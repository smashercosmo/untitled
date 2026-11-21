# Runbook — movies TMDB sync

Commands run from the repo root unless a `cd` is shown. `W` = `pnpm --filter @movies/sync exec wrangler` (or `cd workers/sync && npx wrangler`).
Design and rationale: [SPEC.md](SPEC.md). Facts and limits: [knowledge/](knowledge/).

---

## 0. Prerequisites

- pnpm 12 (the exact version is pinned in `packageManager`; `corepack enable`).
- Node ≥ 24.22, which Void requires. You don't have to install it yourself: `devEngines.runtime` in the root `package.json` makes pnpm download a matching Node and use it for `pnpm <script>` and `pnpm exec`. Run Void through `pnpm exec void …`, not `npx void …`, which uses the system Node.
- `.dev.vars` at the repo root (gitignored, symlinked into `workers/sync/.dev.vars`):
  ```
  TMDB_READ_ACCESS_TOKEN=<v4 token, preferred>
  TMDB_TOKEN=<optional fallback: v3 key or v4 token>
  TELEGRAM_BOT_TOKEN=<from @BotFather>
  TELEGRAM_CHAT_ID=<numeric chat id, NOT a username>
  ```
  To find the numeric chat ID, send your bot any message, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `"chat":{"id":…}`.
- `pnpm install`. pnpm (11 and later) asks to approve dependency build scripts; `esbuild` and `workerd` are allowed in `pnpm-workspace.yaml`.

## 1. Local development (no cloud, no cost)

All local data lives in `workers/sync/.wrangler/state` (gitignored). The local Worker calls the **real TMDB API**, and with the Telegram secrets set it sends **real Telegram messages**.

```sh
pnpm --filter @movies/sync db:migrate:local      # create tmdb_* tables in local D1
pnpm dev                                         # wrangler dev on :8787 (keep it running)

# in another terminal (workers/sync):
npx wrangler workflows trigger tmdb-sync '{"mode":"bootstrap","limit":300,"drainIntervalSeconds":10}' --local
npx wrangler workflows instances describe tmdb-sync latest --local   # watch progress
pnpm seed                                        # (repo root) local D1 ← local R2, same normalizer
npx wrangler workflows trigger tmdb-sync '{"mode":"daily","limit":300,"drainIntervalSeconds":10}' --local
```

- `limit` keeps the local database a subset: the top-N Horror/Thriller movies by votes. Use the **same** `limit` for bootstrap and daily runs, otherwise the daily run treats every movie outside the subset as "new".
- Shortcuts: `pnpm --filter @movies/sync bootstrap:local` and `daily:local` (limit 2000).
- Inspect: press `e` in the `wrangler dev` terminal to open Local Explorer, or run
  `npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "SELECT state, COUNT(*) FROM tmdb_movies GROUP BY 1"`.
- Reset local state: stop `wrangler dev`, run `rm -rf workers/sync/.wrangler/state`, then migrate again.
- Real sample responses for debugging: `pnpm fixtures:refresh` saves to `fixtures/real/`, which is gitignored and deleted on each refresh.

## 1a. Local test app (`apps/web`)

The app shares the sync Worker's local D1 (same persist directory and local ID, SPEC § 12). Seed some movies first (§ 1).

```sh
pnpm web                                          # Vite + Void dev server on http://localhost:5173
pnpm --filter @movies/web db:status               # Void (auth) migrations
```

Open http://localhost:5173 and create an account. Everything requires sign-in.

The local database was rebuilt on 2026-11-11 when the real cloud `database_id` replaced the `movies-local` placeholder, so it has no accounts; create your own. The local D1 file is keyed by `database_id` for every tool: Wrangler, the `void db` CLI and Void's Vite dev server. Don't add a `preview_database_id`; Void's dev server would ignore it and open a different file (SPEC § 12).

**Fresh local database:** after `rm -rf workers/sync/.wrangler/state`, apply Void's migrations **before** the TMDB ones:

```sh
pnpm web                                      # start once so Void records persistTo, then stop it (Ctrl-C)
pnpm --filter @movies/web db:migrate:local    # auth tables + _void_migrations (database still empty)
pnpm --filter @movies/sync db:migrate:local   # tmdb_* tables
pnpm seed
```

**If the TMDB tables already exist,** `void db migrate` refuses (it found tables with no Void history). Do **not** run `void db reset`; it would wipe the TMDB data. Adopt instead, once:

```sh
cd workers/sync
F=../../apps/web/db/migrations/<pending>.sql
npx wrangler d1 execute DB --local --persist-to .wrangler/state --file "$F"
npx wrangler d1 execute DB --local --persist-to .wrangler/state --command "INSERT INTO _void_migrations (name) VALUES ('$(basename "$F")')"
```

After that, `void db migrate` applies later Void migrations normally.

## 2. Tests

```sh
pnpm test        # packages/tmdb (Node + node:sqlite against the real migration) and workers/sync (workerd)
pnpm typecheck
```

Workers tests override the Telegram and TMDB secrets (see `workers/sync/vitest.config.ts`), so they never call the real services.

## 3. Schema changes

1. Edit `packages/tmdb/src/schema.ts`.
2. `pnpm --filter @movies/tmdb db:generate --name <change>`. Review the SQL it generates.
3. Update `normalize.ts` / `writes.ts` and the tests, then `pnpm test`.
4. Apply locally with `pnpm --filter @movies/sync db:migrate:local`, and to the cloud with `db:migrate:remote`.
5. To backfill a new column from R2 without any TMDB calls, re-run the seed (`pnpm seed`, or `-- --remote --yes`).
6. Update `docs/SPEC.md` § 4.

## 3a. App-only test deploy (what was done on 2026-11-11)

Live at **https://movies-web.smashercosmo.workers.dev** (Worker `movies-web`). Only the app is deployed; the sync Worker isn't, so the cloud data doesn't refresh yet. Sign-up is open to anyone.

1. Created the cloud D1 `movies` with location hint `weur`: ID `f35b7e71-fda6-4a4c-9b3a-52dc23d72ed1`, now in both configs.
2. Logged in. Use the project's binaries; they aren't installed globally:
   - `pnpm --filter @movies/sync exec wrangler login`
   - `pnpm --filter @movies/web exec void cloudflare login`
3. Built the dataset locally: bootstrap `{"mode":"bootstrap","limit":2000}` → `pnpm seed` (2,000 movies, 324,557 rows written).
4. `cd apps/web && pnpm exec void deploy --platform cloudflare` built the app, saved a D1 restore point, applied the auth migration to the still-empty D1 and published.
5. `pnpm --filter @movies/sync db:migrate:remote` applied the TMDB migrations 0000–0002, including the FTS5 table and triggers.
6. `pnpm seed -- --remote-db --yes` copied the movies from **local R2** into the **cloud D1**: 324,576 rows in 101 s.

Redeploy the app after changes with `cd apps/web && pnpm exec void deploy` (the target is saved). To refresh the cloud data the same way, crawl locally, then run `pnpm seed -- --remote-db --yes` again; unchanged sections aren't rewritten.

## 4. Cloud setup (sync pipeline, first field test)

The D1 already exists and its ID is configured (§ 3a). Skip the `d1 create` line below.

1. **Plan and billing:** activate Workers Paid. Add budget alerts at $1 and $5 under *Manage Account → Billing → Billable Usage → Set Budget Alert* (a $10 one already exists). See [SPEC § 7](SPEC.md#7-cost-guard-and-safety-q29).
2. **Resources:**
   ```sh
   cd workers/sync
   npx wrangler d1 create movies --location weur          # copy database_id into wrangler.jsonc
   npx wrangler r2 bucket create movies-tmdb-raw
   npx wrangler queues create tmdb-fetch --message-retention-period-secs 345600      # 4 days
   npx wrangler queues create tmdb-fetch-dlq --message-retention-period-secs 1209600 # 14 days
   ```
   Add `"database_id": "<id>"` to the `d1_databases` entry in `wrangler.jsonc`.
3. **Schema, in this order:**
   1. Put the real `database_id` in **both** `workers/sync/wrangler.jsonc` and `apps/web/void.config.ts` (done: `f35b7e71-…`).
   2. Apply Void's migrations first, while the cloud D1 is still empty: deploy the app (`cd apps/web && pnpm exec void deploy --platform cloudflare`), which applies the auth migrations and creates `BETTER_AUTH_SECRET`.
   3. Then `pnpm db:migrate:remote` in `workers/sync`.

   If you did it the other way round, adopt as in § 1a but with `--remote`.
4. **Secrets:** `npx wrangler secret put TMDB_READ_ACCESS_TOKEN`, then the same for `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
5. **Deploy:** `npx wrangler deploy`. The Worker gets no URL (`workers_dev: false`). Confirm the output lists the cron schedule for `tmdb-sync`.
6. **Bootstrap a subset first:**
   `npx wrangler workflows trigger tmdb-sync '{"mode":"bootstrap","limit":2000}'`, then watch with `npx wrangler workflows instances describe tmdb-sync latest`.
7. **Seed the cloud D1:** `pnpm seed -- --remote` (cloud R2 → cloud D1) is a dry run that only counts; add `--yes` to write. `--remote-db --yes` takes local R2 → cloud D1 instead. Measured cost: about 160–185 D1 row writes per movie (184 for the top 300, 162 for the top 2,000; SPEC § 5.4).
8. **First daily run:** trigger `{"mode":"daily","limit":2000}`, or wait for 09:00 UTC. A scheduled run has **no limit**, so it brings in every qualifying movie (about 40k). Go full scale only on purpose.

## 5. Operations

### Check status

```sh
npx wrangler workflows instances list tmdb-sync
npx wrangler workflows instances describe tmdb-sync latest
npx wrangler d1 execute movies --remote --command "SELECT * FROM tmdb_sync_runs ORDER BY started_at DESC LIMIT 5"
npx wrangler d1 execute movies --remote --command "SELECT * FROM tmdb_guard_counters ORDER BY day DESC LIMIT 6"
npx wrangler tail movies-sync     # live logs
```

### Kill switch (stop everything now)

```sh
npx wrangler queues pause-delivery tmdb-fetch                   # consumer stops; messages are kept
npx wrangler workflows instances terminate tmdb-sync <id>       # stop a running run
npx wrangler queues purge tmdb-fetch                            # IRREVERSIBLE: drop the backlog
```

To also stop the 09:00 UTC schedule, remove `schedules` from `wrangler.jsonc` and deploy. Resume with `npx wrangler queues resume-delivery tmdb-fetch`.

### Resume after the guard tripped

The Telegram alert names the metric. Fix the cause first (bug, loop, bad token). Then:

```sh
npx wrangler workflows trigger tmdb-sync '{"mode":"replay","resetGuard":true}'
```

This clears the trip flag, re-enqueues everything in `tmdb_parked` plus unresolved `tmdb_sync_failures`, and waits for them to drain. Today's counters still apply. If a cap itself was too low, change `GUARD_MAX_*` in `wrangler.jsonc` and deploy first.

### Dead-letter queue / failures

`tmdb_sync_failures` lists each failure with a reason: `retries_exhausted`, `bad_request` or `deleted_unmatched`. To retry the retryable ones, run `{"mode":"replay"}`. `deleted_unmatched` movies (404 with no unique IMDb/Wikidata match) need a human decision. They stay soft-deleted and are purged after 90 days.

### Pin a movie (keep it synced even if it stops qualifying)

```sh
npx wrangler d1 execute movies --remote --command "INSERT INTO tmdb_pinned_movies (movie_id, reason, created_at) VALUES (123, 'manual', unixepoch()*1000)"
```

## 6. Purge all TMDB content (license termination)

TMDB terms require purging all cached content promptly.

1. Stop the pipeline: remove `schedules`, deploy, then `pause-delivery`, `purge` and `terminate` (see the kill switch above).
2. D1: `npx wrangler d1 execute movies --remote --command "<DELETE FROM each tmdb_* table>"`, or `npx wrangler d1 delete movies` if no app tables live there.
3. R2: `npx wrangler r2 bucket lifecycle add movies-tmdb-raw purge-all raw/ --expire-days 1`, wait about a day, then `npx wrangler r2 bucket delete movies-tmdb-raw`.
4. Locally: `rm -rf workers/sync/.wrangler/state fixtures/real`.
