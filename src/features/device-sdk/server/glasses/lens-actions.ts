/**
 * Lens row → `dev_actions` (A8). An even_g2 delivery returns `result.lens_message_id`, the
 * `dev_device_messages` row it queued; the glasses' inbox and answer routes move the action through
 * that id, so `GET /v1/actions/{id}` and the `ask.*` hold (`action-service.ts › holdForAnswer`) see it:
 *   inbox hands over an ask            → queued → delivered
 *   inbox hands over a notice or screen → queued → done (nothing more can happen to it, ruled 2026-10-31)
 *   wearer answers an ask → done, `{ index, label }`
 *   wearer dismisses one  → done, `{ dismissed: true, index: null, label: null }`
 * Every move is conditional on the action's current status, so a late hop never regresses a settled row.
 */
import type { GlassesMessage } from "@/features/glasses/core/messages/types";
import type { ActionStatus } from "../../types";
import { isAsk } from "../../delivery/intents";
import type { CapabilityId } from "../../types";
import type { StoredAction } from "../delivery-store";
import type { MemoryDeliveryStore } from "../delivery-store-memory";

export interface LensActionPatch {
  status: ActionStatus;
  /** Merged over the action's stored result (absent = result unchanged). */
  result?: Record<string, unknown>;
  delivered_at?: string;
  settled_at?: string;
  /** Only rows of this class move (absent = both). */
  only?: "ask" | "not_ask";
}

/** Does this row pass {@link LensActionPatch.only}? */
export function matchesOnly(capability: string | null, only: LensActionPatch["only"]): boolean {
  if (!only) return true;
  const ask = capability !== null && isAsk(capability as CapabilityId);
  return only === "ask" ? ask : !ask;
}

/** A `dev_actions` row a move just settled, as stored AFTER the move (tenant, key, status, result). */
export type MovedLensAction = StoredAction;

/**
 * Moves the `dev_actions` rows of this device whose `result.lens_message_id` is in `lensMessageIds`,
 * and returns the rows it moved (after the move). A row whose status was not in `from` is not moved
 * and not returned, so a late hop reports nothing.
 */
export interface LensActionStore {
  move(deviceId: string, lensMessageIds: string[], from: ActionStatus[], patch: LensActionPatch): Promise<MovedLensAction[]>;
}

const OPEN: ActionStatus[] = ["queued", "delivered"];

/** What a settled lens row means for its action, or null (only asks settle an action). */
export function settlementFor(row: GlassesMessage): LensActionPatch | null {
  if (row.kind !== "ask") return null;
  if (row.status === "answered" && row.answer) {
    return { status: "done", result: { index: row.answer.index, label: row.answer.choice, answered_at: row.answer.at }, settled_at: new Date().toISOString() };
  }
  if (row.status === "dismissed") return { status: "done", result: { dismissed: true, index: null, label: null }, settled_at: new Date().toISOString() };
  return null;
}

/** The stored replay body with its `status` moved too (a body still being built, `{}`, is left alone). */
export function withStatus(response: Record<string, unknown>, status: ActionStatus): Record<string, unknown> {
  return "status" in response ? { ...response, status } : response;
}

/** The inbox handed these rows over. Returns the actions this finished (notices and screens), for their webhook. */
export async function markDelivered(store: LensActionStore, deviceId: string, lensMessageIds: string[], at: string = new Date().toISOString()): Promise<MovedLensAction[]> {
  if (lensMessageIds.length === 0) return [];
  const [, finished] = await Promise.all([
    store.move(deviceId, lensMessageIds, ["queued"], { status: "delivered", delivered_at: at, only: "ask" }),
    store.move(deviceId, lensMessageIds, ["queued"], { status: "done", delivered_at: at, settled_at: at, only: "not_ask" }),
  ]);
  return finished;
}

/** Settles the action(s) a lens row serves; returns the ones this call moved (none for a late hop). */
export async function settle(store: LensActionStore, deviceId: string, row: GlassesMessage): Promise<MovedLensAction[]> {
  const patch = settlementFor(row);
  return patch ? store.move(deviceId, [row.id], OPEN, patch) : [];
}

/** The {@link LensActionStore} over the in-memory delivery store (suites). */
export function memoryLensActions(store: MemoryDeliveryStore): LensActionStore {
  return {
    async move(deviceId, ids, from, patch) {
      const moved: MovedLensAction[] = [];
      for (const a of store.actions) {
        const lens = a.result?.lens_message_id;
        if (a.device_id !== deviceId || typeof lens !== "string" || !ids.includes(lens) || !from.includes(a.status)) continue;
        if (!matchesOnly(a.capability, patch.only)) continue;
        a.status = patch.status;
        if (patch.delivered_at) a.delivered_at = patch.delivered_at;
        if (patch.settled_at) a.settled_at = patch.settled_at;
        if (patch.result) a.result = { ...(a.result ?? {}), ...patch.result };
        a.response = withStatus(a.response, patch.status);
        a.updated_at = new Date(store.now()).toISOString();
        moved.push({ ...a });
      }
      return moved;
    },
  };
}
