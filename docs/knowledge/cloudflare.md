# Cloudflare — verified limits and pricing (as of 2026-11-11)

Taken from developers.cloudflare.com via the Cloudflare docs MCP. These numbers change often; check the docs before relying on any of them.

## Workers (Paid)

- Memory: 128 MB per isolate.
- CPU: 30 s by default, configurable up to 5 min with `limits.cpu_ms`.
- Outbound requests: 10,000 per invocation by default, configurable up to 10M with `limits.subrequests`. The Free plan allows only 50.
- **At most 6 simultaneous outgoing connections per invocation.** This caps how parallel TMDB fetches can be.
- `limits` can also be set lower, as a safety fuse.

## Workflows

- Steps per instance: 10,000 by default, configurable up to 25,000 with `limits.steps`. `step.sleep` doesn't count.
- Persisted state: up to 1 GB per instance (Paid). Each non-stream `step.do` return value is limited in size, so keep return values small.
- `schedules: ["cron"]` on the Workflow binding creates instances automatically (since 2026-06-02). The event carries `event.schedule.cron` and `scheduledTime`. Scheduled instances get one hour per firing without using a concurrency slot.
- A per-Workflow concurrency limit is available (`concurrency.limit`, 2026-11-10, Wrangler ≥ 4.127).
- Concurrency: 50,000 instances per account; creation rate 100/s per Workflow.
- Retries: up to 10,000 per step. Instance state is kept 7 days by default (Paid).
- Pricing (Paid): 500k steps a month included, then $0.80 per 100k.

## Queues

- Message size 128 KB.
- `sendBatch`: up to 100 messages or 256 KB per call.
- Consumer batches: up to 100 messages; batch wait up to 60 s.
- Per-queue throughput: 5,000 messages/s. Concurrent consumer invocations: up to 250.
- Consumer wall time: 15 min. Consumer CPU: configurable up to 5 min.
- `delaySeconds`: up to 24 h. Message retention: up to 14 days. Backlog: up to 25 GB per queue.
- `max_concurrency` caps the number of concurrent consumer invocations. **The sync uses 1, which makes the consumer itself the global rate limiter.**
- Without a `dead_letter_queue`, messages that exhaust their retries are deleted.
- Kill switch: `wrangler queues pause-delivery <q>` / `resume-delivery <q>`; `wrangler queues purge <q>` is irreversible.
- Pricing: $0.40 per million operations beyond the included amount. Each message costs about 3 operations (write, read, delete).

## D1

- **10 GB per database, and that can't be raised.** The Paid plan includes 100,000 databases.
- Single-threaded: one query at a time per database (backed by a Durable Object).
- Bound parameters: 100 per query. Statements: 100 KB each. Rows: 2 MB each.
- **Query results are limited to 50 MB** (enforced since 2026-11-04).
- 1,000 queries per Worker invocation on Paid. A `db.batch()` counts as one.
- 6 simultaneous connections per invocation; 30 s maximum query duration.
- **Pricing (Paid):**
  - Rows written: 50M a month included, then $1 per million. **Each index on a written column adds one more written row.**
  - Rows read: 25B a month included.
  - Storage: 5 GB included, then $0.75 per GB-month.
- Dashboard and Wrangler queries are billed too, and so are imports.
- Each statement's result `meta` includes `rows_read` and `rows_written`. The spending guard sums `rows_written`.
- Read-only queries are retried automatically (up to 2 times). Writes are not.

### D1 features used by the app

- **FTS5** virtual tables and triggers work in local D1 (workerd) **and in cloud D1**: `wrangler d1 migrations apply --remote` applied `0001_movie_search` on 2026-11-11, and `MATCH` queries return results. Wrangler's migration splitter handles `CREATE TRIGGER … BEGIN … END;` bodies.
- The D1 REST query endpoint (`POST /accounts/{id}/d1/database/{db}/query`) rejects `indexed` as a column alias (`INDEXED` is an SQLite keyword).
- **pnpm 11 and later** (re-verified on 12.11.2, 2026-11-21) forward the `--` in `pnpm <script> -- --flag` to the script, and Node's `util.parseArgs` then treats every flag as a positional. Our scripts drop a leading `--`.
- **Unverified:** whether `wrangler d1 export` handles databases containing FTS5 virtual tables. Check before relying on exports as backups; Time Travel restores are unaffected.

## R2

- Bucket listing works on this account (R2 enabled 2026-11-11; no buckets yet).
- Pricing (from memory, unverified):
  - Class A operations (writes): $4.50 per million, about 1M a month free.
  - Class B operations (reads): $0.36 per million, about 10M a month free.
  - Storage: $0.015 per GB-month, about 10 GB free.

## Durable Objects (not used, for reference)

- SQLite storage: 10 GB per object; unlimited per account on Paid.
- About 1,000 requests/s per object (soft limit).

## Hyperdrive and Postgres (a future option)

- Hyperdrive supports Postgres 9–18 and MySQL 5.7–8. About 100 origin connections per configuration on Paid.
- PlanetScale Postgres and MySQL databases can be created from Cloudflare and billed on the Cloudflare invoice (since 2026-06-18).

## Billing safety

- **There is no hard spending cap on a Workers Paid account.**
- Budget alerts (`billing_budget_alert` policies) send email only. They're evaluated once a day, so they fire the day after the threshold is crossed. They count only usage charges, not the plan fee.
- This account already has an auto-created $10 budget alert.
- The only product with blocking spend limits is AI Gateway.
- So the sync has its own in-code circuit breaker (SPEC § Cost guard).

## Tooling facts (Wrangler 4.160, verified 2026-11-11)

- **Automatic provisioning:** if a D1, R2, KV or Queue binding has no ID, `wrangler dev` creates a local resource, and `wrangler deploy` creates the cloud resource and writes the ID back. It **can't set the D1 location hint**, so `movies` is created by hand with `--location weur`.
- **Workflows locally:** every `wrangler workflows …` command accepts `--local` (with `--port`) and targets a running `wrangler dev`. Syntax: `wrangler workflows trigger <name> '<json params>' --local`. Local Explorer: press `e` in `wrangler dev`, or open `/cdn-cgi/local/explorer`.
- **`getPlatformProxy()`:**
  - Gives a Node script the configured bindings, local or `remote: true`.
  - `wrangler dev --persist-to X` stores data under `X/v3`, so pass `persist: { path: "X/v3" }`.
  - It ignores Workflows (and warns about them).
  - Running it while `wrangler dev` is up worked fine (shared SQLite state).
- **Test integration:** `@cloudflare/vitest-pool-workers` was renamed `@cloudflare/vitest-plugin` (v1, 2026-08-19).
  - Config: `cloudflareTest({ wrangler: { configPath }, miniflare: { bindings } })` from `@cloudflare/vitest-plugin`, plus `readD1Migrations`.
  - In tests: `applyD1Migrations` from `cloudflare:test`, `env` from `cloudflare:workers`.
  - The old `fetchMock` is gone; Cloudflare suggests `@msw/cloudflare`. We inject `fetch` instead.
  - It loads `.dev.vars`, so tests must override any real secrets in `miniflare.bindings`.
  - Supports Vitest ^4.1 and ^5.
- **pnpm 11 and later** (the repo uses 12.11.2) block dependency build scripts until allowed. `allowBuilds: { esbuild: true, workerd: true }` goes in `pnpm-workspace.yaml`.
- **Observability:** `observability.enabled` turns on logs only. Traces need `observability.traces.enabled`. From 2026-12-01, stored traces count toward Observability usage, so the sync samples 5%.

## Account state (2026-11-11)

- Account ID `fd8abb954e953f9750396aff6de9a4bc`.
- Existing Workers: authentication-service, cloudflare-test, forget-me-notes, photo-service.
- Existing D1: `photo-service`. No Queues, no Hyperdrive, no R2 buckets.
