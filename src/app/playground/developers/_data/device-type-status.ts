/**
 * The PROJECT's status per device type: is Acme Assistant (the agent product) compatible with it?
 * Not an end user's device. Pure, so `device-type-status.test.ts` pins every transition.
 *
 *   not_connected ── add ──▶ added ── every capability test passed ──▶ connected ── go live ──▶ live
 *        ▲                     ▲                                          │
 *        └────── remove ───────┴──────────── a test fails ◀───────────────┘
 */
import type { CapabilityId } from "@dopl/device-contracts";

export type TypeStatus = "not_connected" | "added" | "connected";

export interface CapabilityTest {
  capability: CapabilityId;
  passed: boolean;
  latency_ms: number;
  request: unknown;
  response: unknown;
}

/** "Test on my own device": a demo Connect link, then paired. */
export type OwnDevice = "none" | "link" | "paired";

export interface TypeState {
  status: TypeStatus;
  tests: Partial<Record<CapabilityId, CapabilityTest>>;
  /** Shipped to live users; only ever true while `connected`. */
  live: boolean;
  ownDevice: OwnDevice;
}

export const NOT_CONNECTED: TypeState = { status: "not_connected", tests: {}, live: false, ownDevice: "none" };

export function addType(s: TypeState): TypeState {
  return s.status === "not_connected" ? { ...NOT_CONNECTED, status: "added" } : s;
}

export function removeType(): TypeState {
  return NOT_CONNECTED;
}

export function allPassed(s: TypeState, capabilities: readonly CapabilityId[]): boolean {
  return capabilities.length > 0 && capabilities.every((c) => s.tests[c]?.passed === true);
}

/** Records results; the type is connected exactly while every one of its capabilities has passed. */
export function recordTests(s: TypeState, results: readonly CapabilityTest[], capabilities: readonly CapabilityId[]): TypeState {
  if (s.status === "not_connected") return s;
  const tests = { ...s.tests };
  for (const r of results) tests[r.capability] = r;
  const next: TypeState = { ...s, tests };
  const ok = allPassed(next, capabilities);
  return { ...next, status: ok ? "connected" : "added", live: ok && s.live };
}

export function goLive(s: TypeState): TypeState {
  return s.status === "connected" ? { ...s, live: true } : s;
}

export function stepOwnDevice(s: TypeState): TypeState {
  if (s.status === "not_connected") return s;
  return { ...s, ownDevice: s.ownDevice === "none" ? "link" : "paired" };
}

export function passedCount(s: TypeState, capabilities: readonly CapabilityId[]): number {
  return capabilities.filter((c) => s.tests[c]?.passed).length;
}
