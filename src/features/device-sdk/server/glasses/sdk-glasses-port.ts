import "server-only";
import type { SdkGlassesDevice, SdkGlassesPort } from "@/features/glasses/core/devices/sdk-device";
import { EVEN_G2_INFO } from "@/features/glasses/platforms/even-g2/info";
import { TtlCache } from "@/features/glasses/core/ttl-cache";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { ActionStatus } from "../../types";
import { ACTION_COLS } from "../delivery-store-supabase";
import { sdkDeliveryFor } from "../sdk-delivery-flag";
import { markDelivered, settle, withStatus, type LensActionStore, type MovedLensAction } from "./lens-actions";
import { sdkGlassesStore } from "./sdk-glasses-store";

/**
 * {@link SdkGlassesPort} over the service role (A8): the glasses device routes
 * (`glasses-runtime.ts › deviceHandlers`) authenticate an SDK G2 here.
 *
 * 🔒 AUTH: the bearer's sha256 must be a LIVE `device_credentials` row of kind `device_token`
 * (written by `connect/pairing-port.ts › setTokenHash` when the glasses collected it) whose device is
 * live, SDK-owned (`project_id` set) and an `even_g2`. Prosumer tokens are never in that table (A3 did
 * not backfill credentials), and the prosumer lookup runs FIRST, so this is only ever reached on a miss.
 */

const db = () => supabaseAdmin();

function must<T>(res: { data: T; error: { message: string } | null }, op: string): T {
  if (res.error) throw new Error(`[device-sdk] sdk glasses ${op} failed: ${res.error.message}`);
  return res.data;
}

/**
 * `dev_actions` rows moved by their `result.lens_message_id` (conditional on status: never regress).
 * Returns each row this call moved, as stored after the move (`ACTION_COLS`); a row another hop moved
 * first matches no update and is not returned.
 */
export const supabaseLensActions: LensActionStore = {
  async move(deviceId, ids, from, patch) {
    const rows = must(
      await db()
        .from("dev_actions")
        .select("id, status, result, response")
        .eq("device_id", deviceId)
        .in("result->>lens_message_id", ids)
        .in("status", from),
      "lens action read"
    ) as Array<{ id: string; status: ActionStatus; result: Record<string, unknown> | null; response: Record<string, unknown> }> | null;
    const moved: MovedLensAction[] = [];
    for (const r of rows ?? []) {
      const update: Record<string, unknown> = {
        status: patch.status,
        response: withStatus(r.response ?? {}, patch.status),
        updated_at: new Date().toISOString(),
      };
      if (patch.result) update.result = { ...(r.result ?? {}), ...patch.result };
      const hit = must(
        await db().from("dev_actions").update(update).eq("id", r.id).eq("device_id", deviceId).in("status", from).select(ACTION_COLS),
        "lens action update"
      ) as MovedLensAction[] | null;
      moved.push(...(hit ?? []));
    }
    return moved;
  },
};

export const sdkGlassesPort: SdkGlassesPort = {
  store: sdkGlassesStore,

  async deviceFromTokenHash(hash) {
    const cred = must(
      await db().from("device_credentials").select("device_id").eq("hash", hash).eq("kind", "device_token").is("revoked_at", null).maybeSingle(),
      "credential lookup"
    ) as { device_id: string } | null;
    if (!cred) return null;
    const device = must(
      await db()
        .from("devices")
        .select("id, project_id, env")
        .eq("id", cred.device_id)
        .eq("adapter_id", EVEN_G2_INFO.id)
        .not("project_id", "is", null)
        .is("revoked_at", null)
        .maybeSingle(),
      "device lookup"
    ) as { id: string; project_id: string; env: string } | null;
    return device ? ({ id: device.id, projectId: device.project_id, env: device.env } satisfies SdkGlassesDevice) : null;
  },

  async touch(deviceId, now) {
    must(await db().from("devices").update({ last_seen: now }).eq("id", deviceId).is("revoked_at", null), "touch");
    must(
      await db().from("device_credentials").update({ last_used_at: now }).eq("device_id", deviceId).eq("kind", "device_token").is("revoked_at", null),
      "credential touch"
    );
  },

  async revokeToken(deviceId, now) {
    must(
      await db().from("device_credentials").update({ revoked_at: now }).eq("device_id", deviceId).eq("kind", "device_token").is("revoked_at", null),
      "revoke"
    );
  },

  delivered: (deviceId, ids) => markDelivered(supabaseLensActions, deviceId, ids),
  settled: (deviceId, row) => settle(supabaseLensActions, deviceId, row),
  migratedDeviceIds: migratedDeviceIdsCached,
  isDoplAppProject: isDoplAppProjectCached,
};

/** The internal org's "Dopl App" project (W0.1 seed, runbook step 6), live env only. Cached: it never moves. */
const doplAppCache = new TtlCache<string, boolean>(5 * 60_000, 1_000);

async function isDoplAppProjectCached(projectId: string, env: string): Promise<boolean> {
  if (env !== "live") return false;
  const now = Date.now();
  const hit = doplAppCache.get(projectId, now);
  if (hit !== undefined) return hit;
  const project = must(await db().from("dev_projects").select("org_id, name").eq("id", projectId).maybeSingle(), "project lookup") as {
    org_id: string;
    name: string;
  } | null;
  let ours = false;
  if (project?.name === "Dopl App") {
    const org = must(await db().from("dev_orgs").select("internal").eq("id", project.org_id).maybeSingle(), "org lookup") as { internal: boolean } | null;
    ours = org?.internal === true;
  }
  doplAppCache.set(projectId, ours, now);
  return ours;
}

/**
 * Every inbox poll asks; the flag moves rarely. A failed lookup is not cached (it throws through).
 * A revert or flag-off keeps merging the SDK queue for up to 30s: harmless, its rows are the device's own.
 */
const MIGRATED_TTL_MS = 30_000;
const migratedCache = new TtlCache<string, string[]>(MIGRATED_TTL_MS, 10_000);

async function migratedDeviceIdsCached(userId: string): Promise<string[]> {
  const now = Date.now();
  const hit = migratedCache.get(userId, now);
  if (hit) return hit;
  const state = await sdkDeliveryFor(userId);
  const ids = state.on ? state.deviceIds : [];
  migratedCache.set(userId, ids, now);
  return ids;
}
