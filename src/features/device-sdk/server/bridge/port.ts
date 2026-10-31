import "server-only";
import { after } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { GOOGLE_HOME_ADAPTER_ID } from "../../adapters/google-home";
import { errorBody } from "../../adapters/shared";
import { actionTimeColumns } from "../column-compat";
import { connectStore } from "../connect/store";
import { ACTION_COLS } from "../delivery-store-supabase";
import type { StoredAction } from "../delivery-store";
import { flushDevEvents, logDevEvent } from "../events";
import { sdkGlassesStore } from "../glasses/sdk-glasses-store";
import { withStatus } from "../glasses/lens-actions";
import { messageTextForRow } from "../internal-events";
import { emitActionSettled } from "../webhooks/action-events";
import type { BridgePort } from "./handlers";

/**
 * {@link BridgePort} over the service role. 🔒 AUTH: the bearer's sha256 must be a LIVE `device_token`
 * credential whose device is live, SDK-owned and on a `local_bridge` adapter. A G2 token cannot get in
 * here, and a bridge token cannot get into the glasses routes (`sdk-glasses-port.ts` stays locked to even_g2).
 */

const db = () => supabaseAdmin();

function must<T>(res: { data: T; error: { message: string } | null }, op: string): T {
  if (res.error) throw new Error(`[device-bridge] ${op} failed: ${res.error.message}`);
  return res.data;
}

async function actionFor(deviceId: string, messageId: string): Promise<StoredAction | null> {
  const rows = must(
    await db().from("dev_actions").select(ACTION_COLS).eq("device_id", deviceId).eq("result->>lens_message_id", messageId).eq("status", "queued").limit(1),
    "action read"
  ) as unknown as StoredAction[] | null;
  return rows?.[0] ?? null;
}

async function moveAction(action: StoredAction, patch: Record<string, unknown>, status: "delivered" | "failed"): Promise<StoredAction | null> {
  const update = { ...patch, status, response: withStatus(action.response ?? {}, status), updated_at: new Date().toISOString() };
  const write = (row: Record<string, unknown>) => db().from("dev_actions").update(row).eq("id", action.id).eq("status", "queued").select(ACTION_COLS);
  let res = await write(actionTimeColumns.shape(update));
  if (res.error && actionTimeColumns.isMissing(res.error)) res = await write(actionTimeColumns.fallback(update));
  const rows = must(res, "action update") as unknown as StoredAction[] | null;
  return rows?.[0] ?? null;
}

export const bridgePort: BridgePort = {
  async deviceFromTokenHash(hash) {
    const cred = must(
      await db().from("device_credentials").select("device_id").eq("hash", hash).eq("kind", "device_token").is("revoked_at", null).maybeSingle(),
      "credential lookup"
    ) as { device_id: string } | null;
    if (!cred) return null;
    const row = must(
      await db()
        .from("devices")
        .select("id, project_id, env, end_user_id, last_seen")
        .eq("id", cred.device_id)
        .eq("adapter_id", GOOGLE_HOME_ADAPTER_ID)
        .not("project_id", "is", null)
        .is("revoked_at", null)
        .maybeSingle(),
      "device lookup"
    ) as { id: string; project_id: string; env: "test" | "live"; end_user_id: string; last_seen: string | null } | null;
    return row ? { id: row.id, projectId: row.project_id, env: row.env, endUserId: row.end_user_id, kind: "home_hub", lastSeen: row.last_seen } : null;
  },

  async touch(deviceId, now) {
    must(await db().from("devices").update({ last_seen: now }).eq("id", deviceId).is("revoked_at", null), "touch");
    must(await db().from("device_credentials").update({ last_used_at: now }).eq("device_id", deviceId).eq("kind", "device_token").is("revoked_at", null), "credential touch");
  },

  async rename(deviceId, a) {
    const patch = { ...(a.name ? { display_name: a.name } : {}), ...(a.model ? { model: a.model } : {}) };
    must(await db().from("devices").update(patch).eq("id", deviceId).is("revoked_at", null), "rename");
  },

  async pending(deviceId, now) {
    const rows = await sdkGlassesStore.listInbox(deviceId, now, null);
    return rows.filter((r) => r.status === "pending");
  },

  take: (deviceId, id, now) => sdkGlassesStore.transition(deviceId, id, ["pending"], "delivered", now),

  async settle(device, row, a) {
    const action = await actionFor(device.id, row.id);
    const code = a.ok ? null : "vendor_error";
    const moved = !action
      ? null
      : a.ok
        ? await moveAction(action, { delivered_at: a.at }, "delivered")
        : await moveAction(action, { settled_at: a.at, error: errorBody("vendor_error", `Cast failed: ${a.error ?? "unknown"}`, device.kind) }, "failed");
    if (moved?.status === "failed") await emitActionSettled(connectStore, [moved]);

    const project = must(await db().from("dev_projects").select("org_id").eq("id", device.projectId).maybeSingle(), "project read") as { org_id: string } | null;
    const user = must(await db().from("dev_end_users").select("external_user_id").eq("id", device.endUserId).maybeSingle(), "end user read") as { external_user_id: string } | null;
    if (!project) return;
    logDevEvent({
      org_id: project.org_id,
      project_id: device.projectId,
      env: device.env,
      outcome: a.ok ? "ok" : "error",
      error_code: code,
      external_user_id: user?.external_user_id ?? null,
      device_id: device.id,
      device_kind: device.kind,
      capability: "present.speak",
      action_id: action?.id ?? null,
      operation: "bridge.cast",
      route: "/api/device-bridge/ack",
      http_method: "POST",
      http_status: 200,
      latency_ms: { device_delivery: Math.max(0, Date.parse(a.at) - Date.parse(row.created_at)) },
      message_text: "body" in row.payload ? messageTextForRow(row.payload.body) : null,
    });
    after(() => flushDevEvents());
  },
};
