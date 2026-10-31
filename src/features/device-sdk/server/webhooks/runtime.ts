import "server-only";
import type { NextRequest } from "next/server";
import { devSdkError } from "../errors";
import { afterResponse } from "../events";
import { withDeveloperKey } from "../with-developer-key";
import { WebhookApiError, type WebhookApiDeps } from "./api";
import { runWebhookSender, type SenderReport } from "./sender";
import { supabaseWebhookStore } from "./store-supabase";
import type { Tenant } from "./store-types";
import { httpsTransport } from "./transport";

/**
 * Production wiring for the webhook sender. Two triggers, same run:
 *  - the Vercel cron (`/api/cron/device-sdk-webhooks-send`, every minute) for retries and anything
 *    a kick missed;
 *  - {@link kickWebhookSender} right after an outbox write, so a first attempt does not wait for
 *    the next cron tick.
 * The scheduler is only "who calls `runWebhookSenderNow`"; swapping it needs no sender change.
 */

/** Cron budget: under Vercel's 60s function cap, leaving room for the last batch's 15s timeout. */
export const CRON_BUDGET_MS = 40_000;
/** A kick only sends what is due now; the cron does the rest. */
const KICK_BUDGET_MS = 10_000;

export function runWebhookSenderNow(budgetMs: number): Promise<SenderReport> {
  return runWebhookSender({ store: supabaseWebhookStore, transport: httpsTransport }, { budgetMs });
}

/**
 * Schedule one short sender run after the current response. ⚠ The run can outlive the route's own
 * `maxDuration`: if the platform kills it mid-send, the claimed deliveries keep their lease, which
 * expires after `LEASE_S` and the cron sends them again (same `webhook-id`). At least once, never lost. Outside a request scope (tests,
 * scripts) it does nothing: the cron picks the event up. Never throws.
 */
export function kickWebhookSender(): void {
  afterResponse(async () => {
    try {
      await runWebhookSenderNow(KICK_BUDGET_MS);
    } catch (err) {
      console.warn("[device-sdk] webhook kick failed:", err);
    }
  });
}

/** Production deps for the endpoint API routes. */
export const webhookApiDeps: WebhookApiDeps = { store: supabaseWebhookStore };

/**
 * A `/v1` webhook route: any secret key (publishable refused, no scope), tenancy from the key, and a
 * {@link WebhookApiError} as the C10 error response.
 */
export function webhookRoute(run: (request: NextRequest, tenant: Tenant, params: Record<string, string | undefined>) => Promise<Response>) {
  return withDeveloperKey(
    async (request, { projectId, env }, { params }) => {
      try {
        return await run(request, { projectId, env }, await params);
      } catch (err) {
        if (err instanceof WebhookApiError) return devSdkError(err.code, err.message);
        throw err;
      }
    },
    { scopes: [] }
  );
}
