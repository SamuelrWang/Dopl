import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { DEVICE_CLIENT_ID } from "@/shared/auth/mcp-credential";
import { CONTAINER_CLIENT_NAME } from "@/shared/auth/mcp-container-token";
import type {
  DesktopDeviceRow,
  DesktopDeviceStore,
  DeviceTokenRow,
} from "./desktop-devices-types";

/**
 * Service-role access to `desktop_devices` and the device-client rows of `mcp_tokens`
 * (`20261105120000_desktop_devices.sql`). ⚠ Bypasses RLS, so every statement is filtered on
 * `user_id` here.
 */

const DEVICES = "desktop_devices";
const TOKENS = "mcp_tokens";
const DEVICE_COLS =
  "id, user_id, install_id, name, platform, os_version, app_version, arch, status, created_at, last_seen, revoked_at";

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

  async upsert(userId, input, now) {
    const { data, error } = await db()
      .from(DEVICES)
      .upsert(
        {
          user_id: userId,
          install_id: input.installId,
          name: input.name,
          platform: input.platform,
          os_version: input.osVersion ?? null,
          app_version: input.appVersion ?? null,
          arch: input.arch ?? null,
          status: input.status,
          last_seen: now,
        },
        { onConflict: "user_id,install_id" }
      )
      .select(DEVICE_COLS)
      .single();
    if (error) fail("upsert", error);
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
      .neq("client_name", CONTAINER_CLIENT_NAME)
      .is("revoked_at", null)
      .gt("access_expires_at", now);
    if (error) fail("listDeviceTokens", error);
    return (data ?? []) as DeviceTokenRow[];
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
      .select("id");
    if (error) fail("revoke", error);
    return (data ?? []).length === 1;
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
    const { data: row, error: readError } = await db()
      .from(TOKENS)
      .select("client_name")
      .eq("user_id", userId)
      .eq("client_id", DEVICE_CLIENT_ID)
      .eq("id", tokenId)
      .is("device_id", null)
      .is("revoked_at", null)
      .maybeSingle();
    if (readError) fail("revokeLegacyToken", readError);
    const label = (row as { client_name: string | null } | null)?.client_name;
    if (label === undefined) return 0;
    let query = db()
      .from(TOKENS)
      .update({ revoked_at: now })
      .eq("user_id", userId)
      .eq("client_id", DEVICE_CLIENT_ID)
      .is("device_id", null)
      .is("revoked_at", null);
    query = label === null ? query.eq("id", tokenId) : query.eq("client_name", label);
    const { data, error } = await query.select("id");
    if (error) fail("revokeLegacyToken", error);
    return (data ?? []).length;
  },
};
