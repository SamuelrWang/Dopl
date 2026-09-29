"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import {
  GLASSES_DEVICES,
  type GlassesDevice,
  type GlassesDeviceList,
} from "./glasses-api";

const EMPTY_DEVICES: readonly GlassesDevice[] = [];

// ⚠ `?? EMPTY_DEVICES`, not `?? []`: a `select` literal mints a new identity every render, and a
// persisted cache entry written before a field existed must still read (INVARIANTS §8).
const selectDevices = (body: GlassesDeviceList): readonly GlassesDevice[] =>
  body.devices ?? EMPTY_DEVICES;

/** The caller's active devices. A failed read degrades to none: the pane still offers pairing. */
export function useGlassesDevices({
  refetchInterval,
  enabled = true,
}: { refetchInterval?: number; enabled?: boolean } = {}): readonly GlassesDevice[] {
  const query = useApiQuery(enabled ? GLASSES_DEVICES.path : null, {
    select: selectDevices,
    refetchInterval,
  });
  return query.isError ? EMPTY_DEVICES : (query.data ?? EMPTY_DEVICES);
}

export function useInvalidateGlassesDevices() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: GLASSES_DEVICES.all });
}
