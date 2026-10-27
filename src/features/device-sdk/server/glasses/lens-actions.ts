/**
 * Lens row → `dev_actions` (A8). An even_g2 delivery returns `result.lens_message_id`, the
 * `dev_device_messages` row it queued; the glasses' inbox and answer routes move the action through
 * that id, so `GET /v1/actions/{id}` and the `ask.*` hold (`action-service.ts › holdForAnswer`) see it:
 *   inbox hands it over   → queued → delivered
 *   wearer answers an ask → done, `{ index, label }`
 *   wearer dismisses one  → done, `{ dismissed: true, index: null, label: null }`
 * Every move is conditional on the action's current status, so a late hop never regresses a settled row.
 */
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import type { ActionStatus } from "../../types";
import type { MemoryDeliveryStore } from "../delivery-store-memory";

export interface LensActionPatch {
  status: ActionStatus;
  /** Merged over the action's stored result (absent = result unchanged). */
  result?: Record<string, unknown>;
}

/** Moves the `dev_actions` rows of this device whose `result.lens_message_id` is in `lensMessageIds`. */
export interface LensActionStore {
  move(deviceId: string, lensMessageIds: string[], from: ActionStatus[], patch: LensActionPatch): Promise<void>;
}

const OPEN: ActionStatus[] = ["queued", "delivered"];

/** What a settled lens row means for its action, or null (only asks settle an action). */
export function settlementFor(row: GlassesMessage): LensActionPatch | null {
  if (row.kind !== "ask") return null;
  if (row.status === "answered" && row.answer) {
    return { status: "done", result: { index: row.answer.index, label: row.answer.choice, answered_at: row.answer.at } };
  }
  if (row.status === "dismissed") return { status: "done", result: { dismissed: true, index: null, label: null } };
  return null;
}

/** The stored replay body with its `status` moved too (a body still being built, `{}`, is left alone). */
export function withStatus(response: Record<string, unknown>, status: ActionStatus): Record<string, unknown> {
  return "status" in response ? { ...response, status } : response;
}

export async function markDelivered(store: LensActionStore, deviceId: string, lensMessageIds: string[]): Promise<void> {
  if (lensMessageIds.length > 0) await store.move(deviceId, lensMessageIds, ["queued"], { status: "delivered" });
}

export async function settle(store: LensActionStore, deviceId: string, row: GlassesMessage): Promise<void> {
  const patch = settlementFor(row);
  if (patch) await store.move(deviceId, [row.id], OPEN, patch);
}

/** The {@link LensActionStore} over the in-memory delivery store (suites). */
export function memoryLensActions(store: MemoryDeliveryStore): LensActionStore {
  return {
    async move(deviceId, ids, from, patch) {
      for (const a of store.actions) {
        const lens = a.result?.lens_message_id;
        if (a.device_id !== deviceId || typeof lens !== "string" || !ids.includes(lens) || !from.includes(a.status)) continue;
        a.status = patch.status;
        if (patch.result) a.result = { ...(a.result ?? {}), ...patch.result };
        a.response = withStatus(a.response, patch.status);
        a.updated_at = new Date(store.now()).toISOString();
      }
    },
  };
}
