import "server-only";
import { after } from "next/server";
import { runWebhookSender, type SenderReport } from "./sender";
import { supabaseWebhookStore } from "./store-supabase";
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
export const KICK_BUDGET_MS = 10_000;

export function runWebhookSenderNow(budgetMs: number): Promise<SenderReport> {
  return runWebhookSender({ store: supabaseWebhookStore, transport: httpsTransport }, { budgetMs });
}

/**
 * Schedule one short sender run after the current response. Outside a request scope (tests,
 * scripts) it does nothing: the cron picks the event up. Never throws.
 */
export function kickWebhookSender(): void {
  try {
    after(async () => {
      try {
        await runWebhookSenderNow(KICK_BUDGET_MS);
      } catch (err) {
        console.warn("[device-sdk] webhook kick failed:", err);
      }
    });
  } catch {
    // No request scope.
  }
}
