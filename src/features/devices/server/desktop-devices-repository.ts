import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEVICE_CLIENT_ID } from "@/shared/auth/mcp-credential";
import { CONTAINER_CLIENT_NAME } from "@/shared/auth/mcp-container-token";
import type {
  DesktopDeviceRow,
  DesktopDeviceStore,
  DeviceTokenRow,
  HeartbeatInput,
} from "./desktop-devices-types";

/**
 * Service-role access to `desktop_devices` and the device-client rows of `mcp_tokens`
 * (`20261105120000_desktop_devices.sql`). ⚠ Bypasses RLS, so every statement is filtered on
 * `user_id` here.
 */

const DEVICES = "desktop_devices";
const TOKENS = "mcp_tokens";
const DEVICE_COLS =
  "id, user_id, install_id, name, platform, os_version, app_version, arch, status, created_at, last_seen, revoked_at, auth_session_id";
const UNIQUE_VIOLATION = "23505";

/** The columns a beat writes. */
function beatColumns(input: HeartbeatInput, sessionId: string | null, now: string) {
  return {
    name: input.name,
    platform: input.platform,
    os_version: input.osVersion ?? null,
    app_version: input.appVersion ?? null,
    arch: input.arch ?? null,
    status: input.status,
    last_seen: now,
    // Only a known session overwrites: a beat that could not read one keeps the last.
    ...(sessionId ? { auth_session_id: sessionId } : {}),
  };
}

function fail(op: string, error: { message: string }): never {
  throw new Error(`devices ${op} failed: ${error.message}`);
}

const db = () => supabaseAdmin();

export const desktopDeviceRepository: DesktopDeviceStore = {
  async findByInstall(userId, installId) {
    const { data, error } = await db()
      .from(DEVICES)
      .select(DEVICE_COLS)
      .eq("user_id", userId)
      .eq("install_id", installId)
      .maybeSingle();
    if (error) fail("findByInstall", error);
    return (data as DesktopDeviceRow | null) ?? null;
  },

  async touch(userId, input, sessionId, now) {
    const { data, error } = await db()
      .from(DEVICES)
      .update(beatColumns(input, sessionId, now))
      .eq("user_id", userId)
      .eq("install_id", input.installId)
      .is("revoked_at", null)
      .select(DEVICE_COLS)
      .maybeSingle();
    if (error) fail("touch", error);
    return (data as DesktopDeviceRow | null) ?? null;
  },

  async insert(userId, input, sessionId, now) {
    const { data, error } = await db()
      .from(DEVICES)
      .insert({ user_id: userId, install_id: input.installId, ...beatColumns(input, sessionId, now) })
      .select(DEVICE_COLS)
      .single();
    if (error?.code === UNIQUE_VIOLATION) return null;
    if (error) fail("insert", error);
    return data as DesktopDeviceRow;
  },

  async listActive(userId) {
    const { data, error } = await db()
      .from(DEVICES)
      .select(DEVICE_COLS)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: true });
    if (error) fail("listActive", error);
    return (data ?? []) as DesktopDeviceRow[];
  },

  // Container sessions are the desktop's own plumbing: never listed, revoked with their computer.
  async listDeviceTokens(userId, now) {
    const { data, error } = await db()
      .from(TOKENS)
      .select("id, client_name, device_id, last_used_at, created_at")
      .eq("user_id", userId)
      .eq("client_id", DEVICE_CLIENT_ID)
      // `neq` alone drops NULL names (NULL <> x is not true).
      .or(`client_name.is.null,client_name.neq.${JSON.stringify(CONTAINER_CLIENT_NAME)}`)
      .is("revoked_at", null)
      .gt("access_expires_at", now);
    if (error) fail("listDeviceTokens", error);
    return (data ?? []) as DeviceTokenRow[];
  },

  async linkTokenById(userId, deviceId, tokenId) {
    const { error } = await db()
      .from(TOKENS)
      .update({ device_id: deviceId })
      .eq("user_id", userId)
      .eq("client_id", DEVICE_CLIENT_ID)
      .eq("id", tokenId)
      .is("device_id", null)
      .is("revoked_at", null);
    if (error) fail("linkTokenById", error);
  },

  async linkTokensByLabel(userId, deviceId, label) {
    const { error } = await db()
      .from(TOKENS)
      .update({ device_id: deviceId })
      .eq("user_id", userId)
      .eq("client_id", DEVICE_CLIENT_ID)
      .eq("client_name", label)
      .is("device_id", null)
      .is("revoked_at", null);
    if (error) fail("linkTokensByLabel", error);
  },

  async revoke(userId, deviceId, now) {
    const { data, error } = await db()
      .from(DEVICES)
      .update({ revoked_at: now, status: "offline" })
      .eq("user_id", userId)
      .eq("id", deviceId)
      .is("revoked_at", null)
      .select(DEVICE_COLS)
      .maybeSingle();
    if (error) fail("revoke", error);
    return (data as DesktopDeviceRow | null) ?? null;
  },

  async revokeLinkedTokens(userId, deviceId, now) {
    const { data, error } = await db()
      .from(TOKENS)
      .update({ revoked_at: now })
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .is("revoked_at", null)
      .select("id");
    if (error) fail("revokeLinkedTokens", error);
    return (data ?? []).length;
  },

  async revokeLegacyToken(userId, tokenId, now) {
    const { data, error } = await db()
      .from(TOKENS)
      .update({ revoked_at: now })
      .eq("user_id", userId)
      .eq("client_id", DEVICE_CLIENT_ID)
      .eq("id", tokenId)
      .is("device_id", null)
      .is("revoked_at", null)
      .select("id");
    if (error) fail("revokeLegacyToken", error);
    return (data ?? []).length;
  },

  async endAuthSession(userId, sessionId) {
    const { data, error } = await db().rpc("end_auth_session", {
      p_user_id: userId,
      p_session_id: sessionId,
    });
    if (error) fail("endAuthSession", error);
    return data === true;
  },
};
