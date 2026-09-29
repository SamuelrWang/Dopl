import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { UNIQUE_VIOLATION, dbFail as fail } from "../db";
import type { DeviceChannelActivity, DeviceStore, GlassesDevice, GlassesPairing } from "./types";

/**
 * Service-role access to `glasses_device_links`, `glasses_pairings` and
 * `glasses_device_channel_activity` (the reply mirror's per-channel state).
 * ⚠ Bypasses RLS, so every user-facing read is filtered on `user_id` here.
 * Credential columns are never selected back out: a device row leaves this
 * module with a boolean `has_assistant_key` in place of the hash.
 */

const DEVICES = "glasses_device_links";
const PAIRINGS = "glasses_pairings";
const ACTIVITY = "glasses_device_channel_activity";
const DEVICE_COLS =
  "id, user_id, name, platform, current_target_channel_id, current_target_agent, created_at, last_seen, revoked_at, hey_even_key_hash";
/** The assistant key's column keeps its first platform's name (Even G2's Hey Even). */
const ASSISTANT_KEY_COL = "hey_even_key_hash";
const PAIRING_COLS = "id, code, poll_secret_hash, status, device_id, token_issued_at, expires_at";

type DeviceRow = Omit<GlassesDevice, "has_assistant_key"> & { [ASSISTANT_KEY_COL]: string | null };

function toDevice(row: DeviceRow): GlassesDevice {
  const { [ASSISTANT_KEY_COL]: assistantKeyHash, ...rest } = row;
  return { ...rest, has_assistant_key: assistantKeyHash !== null };
}

const db = () => supabaseAdmin();
/** Safety ceiling on one device's mirror-state rows (one per channel it ever targeted or posted to). */
const ACTIVITY_ROW_LIMIT = 500;

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

  async insertDevice({ userId, name, platform, now }) {
    const { data, error } = await db()
      .from(DEVICES)
      .insert({ user_id: userId, name, platform, created_at: now })
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

  async findDeviceByAssistantKeyHash(hash) {
    return findActiveBy(ASSISTANT_KEY_COL, hash);
  },

  async setTokenHash(deviceId, hash) {
    const { error } = await db().from(DEVICES).update({ token_hash: hash }).eq("id", deviceId).is("revoked_at", null);
    if (error) fail("setTokenHash", error);
  },

  async setAssistantKeyHash(userId, deviceId, hash) {
    const { data, error } = await db()
      .from(DEVICES)
      .update({ [ASSISTANT_KEY_COL]: hash })
      .eq("user_id", userId)
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select("id");
    if (error) fail("setAssistantKeyHash", error);
    return (data ?? []).length === 1;
  },

  async updateDevice(userId, id, patch) {
    const update: Record<string, unknown> = {};
    if (patch.name !== undefined) update.name = patch.name;
    // An empty patch reads the row back unchanged (PostgREST refuses an empty update).
    const { data, error } = Object.keys(update).length
      ? await db().from(DEVICES).update(update).eq("user_id", userId).eq("id", id).is("revoked_at", null).select(DEVICE_COLS).maybeSingle()
      : await db().from(DEVICES).select(DEVICE_COLS).eq("user_id", userId).eq("id", id).is("revoked_at", null).maybeSingle();
    if (error) fail("updateDevice", error);
    return data ? toDevice(data as DeviceRow) : null;
  },

  async revokeDevice(userId, id, now) {
    // Credentials are cleared with the stamp: a revoked row can never authenticate again.
    const { data, error } = await db()
      .from(DEVICES)
      .update({ revoked_at: now, token_hash: null, [ASSISTANT_KEY_COL]: null })
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

  async listChannelActivity(deviceId) {
    const { data, error } = await db()
      .from(ACTIVITY)
      .select("channel_id, last_posted_at, reply_cursor_seq, cursor_at")
      .eq("device_id", deviceId)
      .limit(ACTIVITY_ROW_LIMIT);
    if (error) fail("listChannelActivity", error);
    return ((data ?? []) as DeviceChannelActivity[]).map((r) => ({ ...r, reply_cursor_seq: Number(r.reply_cursor_seq) }));
  },

  async recordChannelPost(deviceId, channelId, now, cursor) {
    const { error } = cursor
      ? await db()
          .from(ACTIVITY)
          .upsert(
            { device_id: deviceId, channel_id: channelId, last_posted_at: now, reply_cursor_seq: cursor.seq, cursor_at: cursor.at },
            { onConflict: "device_id,channel_id" },
          )
      : await db().from(ACTIVITY).update({ last_posted_at: now }).eq("device_id", deviceId).eq("channel_id", channelId);
    if (error) fail("recordChannelPost", error);
  },

  async setChannelCursors(deviceId, cursors) {
    if (cursors.length === 0) return;
    // Only the cursor columns are sent, so an existing row keeps its `last_posted_at`.
    const { error } = await db()
      .from(ACTIVITY)
      .upsert(
        cursors.map((c) => ({ device_id: deviceId, channel_id: c.channelId, reply_cursor_seq: c.seq, cursor_at: c.at })),
        { onConflict: "device_id,channel_id" },
      );
    if (error) fail("setChannelCursors", error);
  },

  async setCurrentTarget(deviceId, channelId, agentId, now) {
    const { error } = await db()
      .from(DEVICES)
      .update({ current_target_channel_id: channelId, current_target_agent: agentId, current_target_at: now })
      .eq("id", deviceId)
      .is("revoked_at", null);
    if (error) fail("setCurrentTarget", error);
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

async function findActiveBy(column: "token_hash" | typeof ASSISTANT_KEY_COL, hash: string) {
  const { data, error } = await db()
    .from(DEVICES)
    .select(DEVICE_COLS)
    .eq(column, hash)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) fail(`findDeviceBy ${column}`, error);
  return data ? toDevice(data as DeviceRow) : null;
}
