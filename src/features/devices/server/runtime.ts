import "server-only";
import type { NextRequest } from "next/server";
import { DEVICE_HEADER } from "../types";
import { desktopDeviceRepository } from "./desktop-devices-repository";
import { resolveRequestDevice, type DevicesDeps } from "./devices-service";

export const devicesDeps: DevicesDeps = { store: desktopDeviceRepository };

/** The desktop's per-install id off the request, or null (a browser, an older desktop). */
export function requestInstallId(request: NextRequest): string | null {
  return request.headers.get(DEVICE_HEADER)?.trim() || null;
}

/**
 * The registered computer a credential mint is coming from. Never fails the mint: a database
 * without `desktop_devices`, or a caller with no header, mints an unlinked credential as before.
 */
export async function mintingDeviceId(request: NextRequest, userId: string): Promise<string | null> {
  try {
    return await resolveRequestDevice(devicesDeps, userId, requestInstallId(request));
  } catch {
    return null;
  }
}
