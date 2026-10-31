import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { GOOGLE_HOME_ADAPTER_ID } from "../../adapters/google-home";
import { errorBody } from "../../adapters/shared";
import { connectStore } from "../connect/store";
import { deviceIdFromTokenHash, must, sdkGlassesPort, supabaseLensActions } from "../glasses/sdk-glasses-port";
import { sdkGlassesStore } from "../glasses/sdk-glasses-store";
import { logBridgeCast } from "../internal-events";
import { emitActionSettled } from "../webhooks/action-events";
import { bridgeMessageText, type BridgePort } from "./handlers";

/**
 * {@link BridgePort} over the service role. 🔒 AUTH: the bearer's sha256 must be a LIVE `device_token`
 * credential whose device is live, SDK-owned and on a `local_bridge` adapter. A G2 token cannot get in
 * here, and a bridge token cannot get into the glasses routes (`sdk-glasses-port.ts` stays locked to even_g2).
 */

const db = () => supabaseAdmin();

export const bridgePort: BridgePort = {
  async deviceFromTokenHash(hash) {
    const deviceId = await deviceIdFromTokenHash(hash);
    if (!deviceId) return null;
    const row = must(
      await db()
        .from("devices")
        .select("id, project_id, env, end_user_id, last_seen")
        .eq("id", deviceId)
        .eq("adapter_id", GOOGLE_HOME_ADAPTER_ID)
        .not("project_id", "is", null)
        .is("revoked_at", null)
        .maybeSingle(),
      "device lookup"
    ) as { id: string; project_id: string; env: "test" | "live"; end_user_id: string; last_seen: string | null } | null;
    return row ? { id: row.id, projectId: row.project_id, env: row.env, endUserId: row.end_user_id, kind: "home_hub", lastSeen: row.last_seen } : null;
  },

  touch: sdkGlassesPort.touch,

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
    const moved = await supabaseLensActions.move(
      device.id,
      [row.id],
      ["queued"],
      a.ok
        ? { status: "delivered", delivered_at: a.at }
        : { status: "failed", settled_at: a.at, error: errorBody("vendor_error", `Cast failed: ${a.error ?? "unknown"}`, device.kind) }
    );
    await emitActionSettled(connectStore, moved);
    await logBridgeCast({
      device,
      ok: a.ok,
      actionId: moved[0]?.id ?? null,
      latencyMs: Date.parse(a.at) - Date.parse(row.created_at),
      body: bridgeMessageText(row),
    });
  },
};
