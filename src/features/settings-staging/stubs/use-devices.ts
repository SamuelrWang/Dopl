"use client";

import { mergeDevices } from "@/features/devices/merge";
import type { AgentApp, ConnectedDevice } from "@/features/devices/types";
import { STAGING_AGENT_APPS, STAGING_COMPUTERS, STAGING_GLASSES } from "../settings-mock-data";

/**
 * STUB of `@/features/devices/components/use-devices` (+ `glasses/settings/use-glasses`'s
 * invalidator). Fixed lists through the real `mergeDevices`; invalidation is a no-op.
 */
const DEVICES = mergeDevices(STAGING_COMPUTERS, STAGING_GLASSES);

export function useConnectedDevices(): { devices: ConnectedDevice[] | null; failed: boolean } {
  return { devices: DEVICES, failed: false };
}

export function useAgentApps(): { apps: readonly AgentApp[] | null; failed: boolean } {
  return { apps: STAGING_AGENT_APPS, failed: false };
}

const noop = async () => undefined;
export const useInvalidateComputers = () => noop;
export const useInvalidateAgentApps = () => noop;
export const useInvalidateGlassesDevices = () => noop;
