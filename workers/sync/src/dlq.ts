/** Dead-letter consumer: messages that exhausted max_retries end up in tmdb_sync_failures (+ Telegram alert). */
import { insertMany } from "@movies/tmdb";
import type { FetchMessage } from "./messages";
import { addRunCountersStmts, runStatements } from "./store";
import { notify } from "./telegram";

export async function handleDeadLetters(batch: MessageBatch<FetchMessage>, env: Env, now = Date.now()): Promise<void> {
  const msgs = batch.messages;
  const perRun = new Map<string, number>();
  for (const m of msgs) perRun.set(m.body.runId, (perRun.get(m.body.runId) ?? 0) + 1);
  await runStatements(env.DB, [
    ...insertMany(
      "tmdb_sync_failures",
      ["movie_id", "run_id", "reason", "error", "attempts", "created_at"],
      msgs.map((m) => [m.body.id, m.body.runId, "retries_exhausted", `reason=${m.body.reason} mode=${m.body.mode}`, m.attempts, now]),
    ),
    ...[...perRun].flatMap(([runId, n]) => addRunCountersStmts(runId, { dead: n })),
  ]);
  const ids = msgs.slice(0, 20).map((m) => m.body.id).join(", ");
  await notify(
    env,
    `⚠️ movies-sync: ${msgs.length} movie(s) exhausted their retries (ids: ${ids}${msgs.length > 20 ? ", …" : ""}).\n` +
      'They are in tmdb_sync_failures; replay with mode "replay" (docs/RUNBOOK.md).',
  );
  batch.ackAll();
}
