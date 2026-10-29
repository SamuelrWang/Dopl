import { nextAttemptAt } from "./retry";
import { signWebhook, webhookMessageId } from "./signing";
import type { DeliveryRow, WebhookStore } from "./store-types";
import { isSuccess, type Transport } from "./transport";

/**
 * ONE sender run (the cron route and the post-enqueue `after()` kick both call this):
 *
 *   fan out pending outbox events → claim due deliveries (leased) → per delivery: sign with the
 *   endpoint's live secrets → POST → record the attempt (atomic: attempt row + next state).
 *
 * Loops claim batches until nothing is due or the time budget runs out. Sends within a batch run
 * concurrently (bounded by the batch size). A delivery whose endpoint was disabled after fan-out is
 * dead-lettered without a request. The lease (`LEASE_S`) outlives one send's timeout, so a crashed
 * run's deliveries come back on their own.
 */

export const SENDER_BATCH = 25;
export const FAN_OUT_BATCH = 200;
/** Lease per claimed delivery; > transport timeout (15s) with margin. */
export const LEASE_S = 60;

export interface SenderDeps {
  store: WebhookStore;
  transport: Transport;
  now?: () => Date;
  random?: () => number;
}

export interface SenderReport {
  fannedOut: number;
  attempted: number;
  delivered: number;
  retrying: number;
  deadLettered: number;
}

export async function runWebhookSender(deps: SenderDeps, opts: { budgetMs: number; maxBatches?: number }): Promise<SenderReport> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const report: SenderReport = { fannedOut: 0, attempted: 0, delivered: 0, retrying: 0, deadLettered: 0 };

  // Fan out everything pending (cheap, SQL only), bounded.
  for (let i = 0; i < 10; i++) {
    const n = await deps.store.fanOut(FAN_OUT_BATCH);
    report.fannedOut += n;
    if (n < FAN_OUT_BATCH) break;
  }

  const maxBatches = opts.maxBatches ?? 1000;
  for (let b = 0; b < maxBatches && Date.now() - started < opts.budgetMs; b++) {
    const batch = await deps.store.claim(SENDER_BATCH, LEASE_S);
    if (batch.length === 0) break;
    const results = await sendBatch(deps, batch, now);
    for (const r of results) {
      report.attempted++;
      report[r]++;
    }
    if (batch.length < SENDER_BATCH) break;
  }
  return report;
}

type Result = "delivered" | "retrying" | "deadLettered";

async function sendBatch(deps: SenderDeps, batch: DeliveryRow[], now: () => Date): Promise<Result[]> {
  const endpointIds = [...new Set(batch.map((d) => d.endpoint_id))];
  const [payloads, endpoints, secrets] = await Promise.all([
    deps.store.payloads([...new Set(batch.map((d) => d.outbox_id))]),
    deps.store.endpointsById(endpointIds),
    deps.store.secretsFor(endpointIds),
  ]);

  return Promise.all(
    batch.map(async (d): Promise<Result> => {
      const endpoint = endpoints.get(d.endpoint_id);
      const payload = payloads.get(d.outbox_id);
      const secret = secrets.get(d.endpoint_id);
      const attemptsDone = d.attempts + 1;

      if (!endpoint || endpoint.disabled_at || !payload || !secret) {
        const why = !endpoint ? "endpoint deleted" : endpoint.disabled_at ? "endpoint disabled" : !payload ? "event missing" : "secret missing";
        await deps.store.recordAttempt(d.id, {
          statusCode: null,
          error: `not sent: ${why}`,
          durationMs: 0,
          responseBody: null,
          success: false,
          nextAttemptAt: null,
        });
        return "deadLettered";
      }

      const body = JSON.stringify(payload);
      const live = [secret.secret, ...(secret.previous_secret ? [secret.previous_secret] : [])];
      const headers = signWebhook({
        id: webhookMessageId(d.id),
        timestamp: Math.floor(now().getTime() / 1000),
        body,
        secrets: live,
      });
      const res = await deps.transport({ url: endpoint.url, headers, body });
      const success = isSuccess(res.statusCode);
      const next = success ? null : nextAttemptAt(attemptsDone, now(), deps.random);
      await deps.store.recordAttempt(d.id, {
        statusCode: res.statusCode,
        error: success ? null : (res.error ?? `HTTP ${res.statusCode}`),
        durationMs: res.durationMs,
        responseBody: res.responseBody,
        success,
        nextAttemptAt: next,
      });
      return success ? "delivered" : next ? "retrying" : "deadLettered";
    })
  );
}
