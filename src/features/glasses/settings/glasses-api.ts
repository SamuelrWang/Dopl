"use client";

/**
 * The Settings → Glasses client: every User API call the pane makes, and the wire types they
 * carry (docs/glasses-mcp.md, the User API). `apiRequest`, never `fetch`: the desktop renderer's
 * only transport is the IPC bridge behind that seam.
 */

import { apiRequest } from "@/shared/api/api-client";
import { apiResource } from "@/shared/api/query-keys";

export interface GlassesLinkedChannel {
  id: string;
  name: string;
}

export interface GlassesDevice {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  linked_channel: GlassesLinkedChannel | null;
  has_hey_even_key: boolean;
}

export interface GlassesDeviceList {
  devices?: GlassesDevice[];
}

/** Returned ONCE by a rotation; the server keeps only the hash. */
export interface HeyEvenKey {
  key: string;
  url: string;
}

export interface PairClaimInput {
  code: string;
  name?: string;
  channel_id?: string;
}

/** `channel_id: null` unlinks. */
export interface DevicePatch {
  name?: string;
  channel_id?: string | null;
}

export const GLASSES_DEVICES = apiResource("/api/glasses/devices");
const PAIR_CLAIM_PATH = "/api/glasses/pair/claim";

const devicePath = (id: string) =>
  `${GLASSES_DEVICES.path}/${encodeURIComponent(id)}`;

export function claimPairing(input: PairClaimInput) {
  return apiRequest<{ device: GlassesDevice }>(PAIR_CLAIM_PATH, {
    method: "POST",
    body: input,
  });
}

export function updateDevice(id: string, patch: DevicePatch) {
  return apiRequest<unknown>(devicePath(id), { method: "PATCH", body: patch });
}

export function revokeDevice(id: string) {
  return apiRequest<unknown>(devicePath(id), { method: "DELETE" });
}

export function rotateHeyEvenKey(id: string) {
  return apiRequest<HeyEvenKey>(`${devicePath(id)}/hey-even-key`, {
    method: "POST",
  });
}

export const PAIRING_CODE_LENGTH = 6;

/** What the lens shows is upper-case A-Z2-9; a typed code may carry case, spaces or a dash. */
export function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PAIRING_CODE_LENGTH);
}
