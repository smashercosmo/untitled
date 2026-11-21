import { handleFetchBatch } from "./consumer";
import { handleDeadLetters } from "./dlq";
import { DLQ_NAME, type FetchMessage } from "./messages";

export { SyncWorkflow } from "./workflow";

// No fetch handler on purpose: the Worker has no public surface (SPEC § 7). Runs are started by the
// Workflow's cron schedule or `wrangler workflows trigger tmdb-sync '<json>' [--local]`.
export default {
  async queue(batch, env) {
    if (batch.queue === DLQ_NAME) await handleDeadLetters(batch, env);
    else await handleFetchBatch(batch, env);
  },
} satisfies ExportedHandler<Env, FetchMessage>;
