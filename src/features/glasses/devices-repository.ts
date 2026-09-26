import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { DeviceStore, GlassesDevice, GlassesPairing } from "./devices-types";

/**
 * Service-role access to `glasses_device_links` and `glasses_pairings`
 * (`20261028120000_glasses_device_links_pairings.sql`). ⚠ Bypasses RLS, so
 * every user-facing read is filtered on `user_id` here. Credential columns are
 * never selected back out: a device row leaves this module with a boolean
 * `has_hey_even_key` in place of the hash.
 */

const DEVICES = "glasses_device_links";
const PAIRINGS = "glasses_pairings";
const DEVICE_COLS =
  "id, user_id, name, platform, linked_channel_id, linked_container_id, reply_cursor_seq, created_at, last_seen, revoked_at, hey_even_key_hash";
const PAIRING_COLS = "id, code, poll_secret_hash, status, device_id, token_issued_at, expires_at";
const UNIQUE_VIOLATION = "23505";

type DeviceRow = Omit<GlassesDevice, "has_hey_even_key"> & { hey_even_key_hash: string | null };

function toDevice(row: DeviceRow): GlassesDevice {
  const { hey_even_key_hash, ...rest } = row;
  return {
    ...rest,
    reply_cursor_seq: rest.reply_cursor_seq === null ? null : Number(rest.reply_cursor_seq),
    has_hey_even_key: hey_even_key_hash !== null,
  };
}

function fail(op: string, error: { message: string }): never {
  throw new Error(`glasses ${op} failed: ${error.message}`);
}

const db = () => supabaseAdmin();

export const deviceRepository: DeviceStore = {
  async insertPairing({ code, pollSecretHash, expiresAt, now }) {
    const { data, error } = await db()
      .from(PAIRINGS)
      .insert({ code, poll_secret_hash: pollSecretHash, expires_at: expiresAt, created_at: now })
      .select(PAIRING_COLS)
      .single();
    if (error?.code === UNIQUE_VIOLATION) return false;
    if (error) fail("insertPairing", error);
    return data as GlassesPairing;
  },

  async getPairing(id) {
    const { data, error } = await db().from(PAIRINGS).select(PAIRING_COLS).eq("id", id).maybeSingle();
    if (error) fail("getPairing", error);
    return (data as GlassesPairing | null) ?? null;
  },

  async findPendingPairingByCode(code, now) {
    const { data, error } = await db()
      .from(PAIRINGS)
      .select(PAIRING_COLS)
      .eq("code", code)
      .eq("status", "pending")
      .gt("expires_at", now)
      .maybeSingle();
    if (error) fail("findPendingPairingByCode", error);
    return (data as GlassesPairing | null) ?? null;
  },

  async claimPairing(id, deviceId, now) {
    const { data, error } = await db()
      .from(PAIRINGS)
      .update({ status: "claimed", device_id: deviceId, claimed_at: now })
      .eq("id", id)
      .eq("status", "pending")
      .gt("expires_at", now)
      .select("id");
    if (error) fail("claimPairing", error);
    return (data ?? []).length === 1;
  },

  async markTokenIssued(id, now) {
    const { data, error } = await db()
      .from(PAIRINGS)
      .update({ token_issued_at: now })
      .eq("id", id)
      .eq("status", "claimed")
      .is("token_issued_at", null)
      .select("id");
    if (error) fail("markTokenIssued", error);
    return (data ?? []).length === 1;
  },

  async expirePairingCode(code, now) {
    const { error } = await db()
      .from(PAIRINGS)
      .update({ status: "expired" })
      .eq("code", code)
      .eq("status", "pending")
      .lte("expires_at", now);
    if (error) fail("expirePairingCode", error);
  },

  async deleteStalePairings(cutoff) {
    const { error } = await db().from(PAIRINGS).delete().lt("expires_at", cutoff);
    if (error) fail("deleteStalePairings", error);
  },

  async insertDevice({ userId, name, platform, linkedChannelId, linkedContainerId, now }) {
    const { data, error } = await db()
      .from(DEVICES)
      .insert({
        user_id: userId,
        name,
        platform,
        linked_channel_id: linkedChannelId,
        linked_container_id: linkedContainerId,
        created_at: now,
      })
      .select(DEVICE_COLS)
      .single();
    if (error) fail("insertDevice", error);
    return toDevice(data as DeviceRow);
  },

  async listDevices(userId) {
    const { data, error } = await db()
      .from(DEVICES)
      .select(DEVICE_COLS)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .not("token_hash", "is", null)
      .order("created_at", { ascending: true });
    if (error) fail("listDevices", error);
    return ((data ?? []) as DeviceRow[]).map(toDevice);
  },

  async findDeviceByTokenHash(hash) {
    return findActiveBy("token_hash", hash);
  },

  async findDeviceByHeyEvenKeyHash(hash) {
    return findActiveBy("hey_even_key_hash", hash);
  },

  async setTokenHash(deviceId, hash) {
    const { error } = await db().from(DEVICES).update({ token_hash: hash }).eq("id", deviceId).is("revoked_at", null);
    if (error) fail("setTokenHash", error);
  },

  async setHeyEvenKeyHash(userId, deviceId, hash) {
    const { data, error } = await db()
      .from(DEVICES)
      .update({ hey_even_key_hash: hash })
      .eq("user_id", userId)
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select("id");
    if (error) fail("setHeyEvenKeyHash", error);
    return (data ?? []).length === 1;
  },

  async updateDevice(userId, id, patch) {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.linkedChannelId !== undefined) {
      update.linked_channel_id = patch.linkedChannelId;
      update.linked_container_id = patch.linkedContainerId ?? null;
      // A new channel restarts the reply mirror at that channel's head.
      update.reply_cursor_seq = null;
    }
    const { data, error } = await db()
      .from(DEVICES)
      .update(update)
      .eq("user_id", userId)
      .eq("id", id)
      .is("revoked_at", null)
      .select(DEVICE_COLS)
      .maybeSingle();
    if (error) fail("updateDevice", error);
    return data ? toDevice(data as DeviceRow) : null;
  },

  async revokeDevice(userId, id, now) {
    // Credentials are cleared with the stamp: a revoked row can never authenticate again.
    const { data, error } = await db()
      .from(DEVICES)
      .update({ revoked_at: now, token_hash: null, hey_even_key_hash: null })
      .eq("user_id", userId)
      .eq("id", id)
      .is("revoked_at", null)
      .select("id");
    if (error) fail("revokeDevice", error);
    return (data ?? []).length === 1;
  },

  async touchDevice(deviceId, now) {
    const { error } = await db().from(DEVICES).update({ last_seen: now }).eq("id", deviceId);
    if (error) fail("touchDevice", error);
  },

  async setReplyCursor(deviceId, seq) {
    const { error } = await db().from(DEVICES).update({ reply_cursor_seq: seq }).eq("id", deviceId);
    if (error) fail("setReplyCursor", error);
  },

  async countActiveDevices(userId) {
    const { count, error } = await db()
      .from(DEVICES)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("revoked_at", null)
      .not("token_hash", "is", null);
    if (error) fail("countActiveDevices", error);
    return count ?? 0;
  },
};

async function findActiveBy(column: "token_hash" | "hey_even_key_hash", hash: string) {
  const { data, error } = await db()
    .from(DEVICES)
    .select(DEVICE_COLS)
    .eq(column, hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) fail(`findDeviceBy ${column}`, error);
  return data ? toDevice(data as DeviceRow) : null;
}
