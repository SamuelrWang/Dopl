import "server-only";
import type { ConnectPairingPort } from "@/features/glasses/core/devices/pairing";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * `ConnectPairingPort` over the service role: a G2 pairing claimed through a Connect session sets
 * `glasses_pairings.sdk_device_id` (never `device_id`, the prosumer owner), and the token the glasses
 * collect lands HASHED in `device_credentials` as the device's live `device_token`.
 *
 * ⚠ This module is the ONLY reader of `sdk_device_id`: the prosumer repository
 * (`glasses/core/devices/repository.ts`) does not select it, so prosumer pairing reads the same
 * columns it always did.
 */
const db = () => supabaseAdmin();

export const connectPairingPort: ConnectPairingPort = {
  async claimPairing(pairingId, sdkDeviceId, now) {
    const { data, error } = await db()
      .from("glasses_pairings")
      .update({ status: "claimed", sdk_device_id: sdkDeviceId, claimed_at: now })
      .eq("id", pairingId)
      .eq("status", "pending")
      .is("device_id", null)
      .gt("expires_at", now)
      .select("id");
    if (error) throw new Error(`connect claimPairing failed: ${error.message}`);
    return Array.isArray(data) && data.length === 1;
  },

  async sdkDeviceFor(pairingId) {
    const { data, error } = await db().from("glasses_pairings").select("sdk_device_id").eq("id", pairingId).maybeSingle();
    if (error) throw new Error(`connect sdkDeviceFor failed: ${error.message}`);
    return (data as { sdk_device_id: string | null } | null)?.sdk_device_id ?? null;
  },

  async setTokenHash(sdkDeviceId, hash, now) {
    // One live credential per (device, kind): retire any earlier token first.
    const retire = await db()
      .from("device_credentials")
      .update({ revoked_at: now })
      .eq("device_id", sdkDeviceId)
      .eq("kind", "device_token")
      .is("revoked_at", null);
    if (retire.error) throw new Error(`connect setTokenHash failed: ${retire.error.message}`);
    const { error } = await db()
      .from("device_credentials")
      .insert({ device_id: sdkDeviceId, kind: "device_token", hash, created_at: now });
    if (error) throw new Error(`connect setTokenHash failed: ${error.message}`);
  },
};
