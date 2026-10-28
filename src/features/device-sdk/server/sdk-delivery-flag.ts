import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * The per-user `sdk_delivery` flag (Plans/Dopl SDK Split §8.3), read through RPC
 * `sdk_delivery_state` (`20261122900000_device_sdk_prosumer_migration.sql`).
 *
 * `on` is true only when the flag row exists AND at least one of the user's glasses has been
 * migrated (`migrate_prosumer_device`) and is live: SDK-shaped under an internal project, live
 * device_token credential, active connection. The flag alone never turns delivery on.
 * `deviceIds` are those migrated devices (same ids as their `glasses_device_links` rows).
 *
 * Fail loud: a read error throws. The caller (the glasses seam) decides its own fallback.
 */
export interface SdkDeliveryState {
  on: boolean;
  deviceIds: string[];
}

type RpcResult = { data: unknown; error: { message: string } | null };
export type SdkDeliveryRpc = (fn: "sdk_delivery_state", args: { p_user_id: string }) => PromiseLike<RpcResult>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const defaultRpc: SdkDeliveryRpc = (fn, args) => supabaseAdmin().rpc(fn, args);

export async function sdkDeliveryFor(userId: string, rpc: SdkDeliveryRpc = defaultRpc): Promise<SdkDeliveryState> {
  // A non-uuid can own no row; skip the round trip (and Postgres's cast error).
  if (!UUID.test(userId)) return { on: false, deviceIds: [] };
  const { data, error } = await rpc("sdk_delivery_state", { p_user_id: userId });
  if (error) throw new Error(`[device-sdk] sdk_delivery_state failed: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { enabled?: unknown; device_ids?: unknown } | null | undefined;
  const deviceIds = Array.isArray(row?.device_ids) ? row.device_ids.filter((id): id is string => typeof id === "string") : [];
  return { on: row?.enabled === true && deviceIds.length > 0, deviceIds };
}
