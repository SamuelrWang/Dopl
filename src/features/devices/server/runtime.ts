import "server-only";
import type { NextRequest } from "next/server";
import { DEVICE_HEADER } from "../types";
import { desktopDeviceRepository } from "./desktop-devices-repository";
import { createServerClient } from "@supabase/ssr";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { resolveRequestDevice, type DevicesDeps, type RequestDevice } from "./devices-service";

export const devicesDeps: DevicesDeps = { store: desktopDeviceRepository };

/** The desktop's per-install id off the request, or null (a browser, an older desktop). */
export function requestInstallId(request: NextRequest): string | null {
  return request.headers.get(DEVICE_HEADER)?.trim() || null;
}

/**
 * The registered computer a credential mint is coming from: `{ deviceId }` links the new row,
 * `{ removed: true }` refuses the mint (a removed computer mints nothing), `null` mints unlinked.
 * A lookup failure (a database without `desktop_devices`) mints unlinked as before.
 */
export async function mintingDevice(request: NextRequest, userId: string): Promise<RequestDevice> {
  try {
    return await resolveRequestDevice(devicesDeps, userId, requestInstallId(request));
  } catch {
    return null;
  }
}

/** The 403 a removed computer's mint answers. */
export const deviceRemovedError = () =>
  new HttpError(403, "DEVICE_REMOVED", "This computer was removed from your account. Sign in again.");

/**
 * The Supabase `session_id` of the sign-in behind this request (the route's wrapper has already
 * verified the credential). Bearer JWT payload first, else the cookie session's claims. Null when
 * unreadable or when it names another user.
 */
export async function requestSessionId(request: NextRequest, userId: string): Promise<string | null> {
  const claims = bearerClaims(request) ?? (await cookieClaims(request));
  if (!claims || claims.sub !== userId) return null;
  return typeof claims.session_id === "string" && isUuid(claims.session_id) ? claims.session_id : null;
}

type Claims = { sub?: unknown; session_id?: unknown };

function bearerClaims(request: NextRequest): Claims | null {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const payload = token?.split(".")[1];
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
  } catch {
    return null;
  }
}

async function cookieClaims(request: NextRequest): Promise<Claims | null> {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => request.cookies.getAll(), setAll() {} } }
    );
    const { data } = await supabase.auth.getClaims();
    return (data?.claims as Claims | undefined) ?? null;
  } catch {
    return null;
  }
}
