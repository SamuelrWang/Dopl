import { nextAttemptAt } from "./retry";
import { signWebhook, webhookMessageId } from "./signing";
import type { AttemptOutcome, ClaimedDelivery, WebhookStore } from "./store-types";
import { isSuccess, stripNul, type Transport } from "./transport";

/**
 * ONE sender run (the cron route and the post-enqueue `after()` kick both call this):
 *
 *   prune expired rotation secrets → fan out pending outbox events → claim due deliveries (leased,
 *   one claim token per row) → per delivery: sign with the endpoint's live secrets → POST → record
 *   the attempt under that claim token (atomic: attempt row + next state).
 *
 * Loops claim batches until nothing is due or the time budget runs out. Sends within a batch run
 * concurrently and are ISOLATED: one delivery that throws (a poison response, a DB error) is logged
 * and skipped; every other delivery of the batch is still recorded. A skipped delivery keeps its
 * lease and is retried after it expires (`LEASE_S`). A delivery whose endpoint was disabled after
 * fan-out is dead-lettered without a request.
 *
 * At-least-once: a run killed after the POST but before the record (function timeout, crash) leaves
 * the lease to expire and the delivery is sent again with the same `webhook-id`. Receivers dedupe on it.
 */

const SENDER_BATCH = 25;
const FAN_OUT_BATCH = 200;
/** Lease per claimed delivery; > transport timeout (15s) with margin. */
export const LEASE_S = 60;

interface SenderDeps {
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
  /** Deliveries whose send or record threw this run (logged; retried after the lease). */
  errored: number;
}

export async function runWebhookSender(deps: SenderDeps, opts: { budgetMs: number; maxBatches?: number }): Promise<SenderReport> {
  const now = deps.now ?? (() => new Date());
  const started = Date.now();
  const report: SenderReport = { fannedOut: 0, attempted: 0, delivered: 0, retrying: 0, deadLettered: 0, errored: 0 };

  await deps.store.pruneExpiredSecrets();

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
      if (r !== "errored" && r !== "stale") report.attempted++;
      if (r === "stale") continue;
      report[r]++;
    }
    if (batch.length < SENDER_BATCH) break;
  }
  return report;
}

type Result = "delivered" | "retrying" | "deadLettered" | "errored" | "stale";

/** Never let a NUL (Postgres text) or an oversized string reach the record RPC. */
function clean(o: AttemptOutcome): AttemptOutcome {
  return {
    ...o,
    error: o.error === null ? null : stripNul(o.error).slice(0, 500),
    responseBody: o.responseBody === null ? null : stripNul(o.responseBody).slice(0, 1024),
  };
}

async function sendBatch(deps: SenderDeps, batch: ClaimedDelivery[], now: () => Date): Promise<Result[]> {
  const endpointIds = [...new Set(batch.map((d) => d.endpoint_id))];
  const [payloads, endpoints, secrets] = await Promise.all([
    deps.store.payloads([...new Set(batch.map((d) => d.outbox_id))]),
    deps.store.endpointsById(endpointIds),
    deps.store.secretsFor(endpointIds),
  ]);

  const one = async (d: ClaimedDelivery): Promise<Result> => {
    const endpoint = endpoints.get(d.endpoint_id);
    const payload = payloads.get(d.outbox_id);
    const secret = secrets.get(d.endpoint_id);
    const record = async (o: AttemptOutcome, result: Result): Promise<Result> =>
      (await deps.store.recordAttempt(d.id, d.claim_token, clean(o))) ? result : "stale";

    if (!endpoint || endpoint.disabled_at || !payload || !secret) {
      const why = !endpoint ? "endpoint_deleted" : endpoint.disabled_at ? "endpoint_disabled" : !payload ? "event_missing" : "secret_missing";
      return record(
        { statusCode: null, error: `not_sent: ${why}`, durationMs: 0, responseBody: null, success: false, nextAttemptAt: null },
        "deadLettered"
      );
    }

    const body = JSON.stringify(payload);
    const live = [secret.secret, ...(secret.previous_secret ? [secret.previous_secret] : [])];
    const headers = signWebhook({ id: webhookMessageId(d.id), timestamp: Math.floor(now().getTime() / 1000), body, secrets: live });
    const res = await deps.transport({ url: endpoint.url, headers, body });
    const success = isSuccess(res.statusCode);
    const next = success ? null : nextAttemptAt(d.attempts + 1, now(), deps.random);
    return record(
      {
        statusCode: res.statusCode,
        error: success ? null : (res.error ?? `http_${res.statusCode}`),
        durationMs: res.durationMs,
        responseBody: res.responseBody,
        success,
        nextAttemptAt: next,
      },
      success ? "delivered" : next ? "retrying" : "deadLettered"
    );
  };

  const settled = await Promise.allSettled(batch.map(one));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    console.warn(`[device-sdk] webhook delivery ${batch[i].id} failed this run (retried after its lease):`, s.reason);
    return "errored";
  });
}
