import type { StoredAction } from "../delivery-store";
import { toAction } from "../action-service";
import type { ConnectStore } from "../connect/store-types";
import { enqueueWebhookEvent } from "../connect/webhooks";

/**
 * `action.completed` / `action.failed` for actions that just SETTLED (ruled 2026-10-28: emit at the
 * platform settle, `glasses/lens-actions.ts › settle`, reusing the frozen names; an ask answer or
 * dismiss = `done` = `action.completed`). `data` = the public `Action` object. Rows still in flight
 * (`queued` / `delivered`) emit nothing. A failed enqueue is logged, never thrown: the device's
 * answer must not fail because the outbox write did.
 */
export async function emitActionSettled(
  store: Pick<ConnectStore, "insertOutbox">,
  rows: readonly StoredAction[],
  now: Date = new Date()
): Promise<number> {
  let n = 0;
  for (const row of rows) {
    const type = row.status === "done" ? "action.completed" : row.status === "failed" ? "action.failed" : null;
    if (!type) continue;
    try {
      await enqueueWebhookEvent(
        store,
        { projectId: row.project_id, env: row.env },
        type,
        toAction(row) as unknown as Record<string, unknown>,
        now
      );
      n++;
    } catch (err) {
      console.warn(`[device-sdk] ${type} webhook enqueue failed for action ${row.id}:`, err);
    }
  }
  return n;
}
