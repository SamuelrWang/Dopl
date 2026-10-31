import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { errorBody } from "../adapters/shared";
import { isAsk } from "../delivery/intents";
import type { CapabilityId, DeviceKind } from "../types";
import { connectStore } from "./connect/store";
import { supabaseLensActions } from "./glasses/sdk-glasses-port";
import type { LensActionPatch } from "./glasses/lens-actions";
import { emitActionSettled } from "./webhooks/action-events";

/**
 * Finishes actions stuck at `queued`. Three ways to get there: the queued message lapsed before any device took
 * it; the device took it but the move failed after the take; or a pickup raced the sender's status write (F-784).
 * The longest a message can wait is `SDK_ASK_TTL_S`, ten minutes, so anything older cannot move by itself.
 */
export const STUCK_AFTER_MS = 15 * 60 * 1000;
const BATCH = 100;

/** What a stuck action becomes, by its queued message's status. Null message = it was never queued. Pure. */
export function stuckPatch(a: { capability: string | null; lensStatus: string | null; kind: DeviceKind; at: string }): LensActionPatch {
  if (a.lensStatus && a.lensStatus !== "pending" && a.lensStatus !== "expired") {
    const ask = a.capability !== null && isAsk(a.capability as CapabilityId);
    return ask ? { status: "delivered", delivered_at: a.at } : { status: "done", delivered_at: a.at, settled_at: a.at };
  }
  return { status: "failed", settled_at: a.at, error: errorBody("device_offline", "No device picked this up before it expired.", a.kind) };
}

export async function sweepStuckActions(now: Date = new Date()): Promise<number> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("dev_actions")
    .select("id, device_id, capability, result, devices!inner(kind)")
    .eq("status", "queued")
    .lt("created_at", new Date(now.getTime() - STUCK_AFTER_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) throw new Error(`sweepStuckActions failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Array<{ id: string; device_id: string; capability: string | null; result: { lens_message_id?: string } | null; devices: { kind: DeviceKind } }>;
  if (rows.length === 0) return 0;
  const lensIds = rows.map((r) => r.result?.lens_message_id).filter((v): v is string => typeof v === "string");
  const lens = await db.from("dev_device_messages").select("id, status").in("id", lensIds);
  if (lens.error) throw new Error(`sweepStuckActions failed: ${lens.error.message}`);
  const statusOf = new Map(((lens.data ?? []) as Array<{ id: string; status: string }>).map((m) => [m.id, m.status]));
  const at = now.toISOString();
  let moved = 0;
  for (const row of rows) {
    const lensId = row.result?.lens_message_id;
    const patch = stuckPatch({ capability: row.capability, lensStatus: lensId ? (statusOf.get(lensId) ?? null) : null, kind: row.devices.kind, at });
    if (lensId) {
      const done = await supabaseLensActions.move(row.device_id, [lensId], ["queued"], patch);
      await emitActionSettled(connectStore, done);
      moved += done.length;
    } else {
      const res = await db.from("dev_actions").update({ status: patch.status, settled_at: at, error: patch.error, updated_at: at }).eq("id", row.id).eq("status", "queued");
      if (res.error) throw new Error(`sweepStuckActions failed: ${res.error.message}`);
      moved += 1;
    }
  }
  return moved;
}
