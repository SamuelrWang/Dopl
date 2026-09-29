"use client";

/**
 * The Settings → Glasses client: every User API call the pane makes, and the wire types they
 * carry (docs/glasses-mcp.md, the User API). `apiRequest`, never `fetch`: the desktop renderer's
 * only transport is the IPC bridge behind that seam.
 */

import { apiRequest } from "@/shared/api/api-client";
import { apiResource } from "@/shared/api/query-keys";

export interface GlassesDevice {
  id: string;
  name: string;
  platform: string;
  created_at: string;
  last_seen: string | null;
  online: boolean;
  /** Wire name for "has an assistant key", kept for existing clients. */
  has_hey_even_key: boolean;
}

export interface GlassesDeviceList {
  devices?: GlassesDevice[];
}

/** Returned ONCE by a rotation; the server keeps only the hash. */
export interface AssistantKey {
  key: string;
  url: string;
}

export interface PairClaimInput {
  code: string;
  name?: string;
}

export interface DevicePatch {
  name?: string;
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

export function rotateAssistantKey(id: string) {
  return apiRequest<AssistantKey>(`${devicePath(id)}/hey-even-key`, {
    method: "POST",
  });
}

/** One definition with the server's (`core/devices/pairing-code.ts`, client-safe). */
export { PAIRING_CODE_LENGTH, pairingCodeInput } from "../core/devices/pairing-code";
