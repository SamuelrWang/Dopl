"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { SelectMenuOption } from "@/shared/ui/select-menu";
import { useChannels } from "@/features/channels/hooks/use-channels";
import {
  GLASSES_DEVICES,
  type GlassesDevice,
  type GlassesDeviceList,
  type GlassesLinkedChannel,
} from "./glasses-api";

const EMPTY_DEVICES: readonly GlassesDevice[] = [];

// ⚠ `?? EMPTY_DEVICES`, not `?? []`: a `select` literal mints a new identity every render, and a
// persisted cache entry written before a field existed must still read (INVARIANTS §8).
const selectDevices = (body: GlassesDeviceList): readonly GlassesDevice[] =>
  body.devices ?? EMPTY_DEVICES;

/** The caller's active devices. A failed read degrades to none: the pane still offers pairing. */
export function useGlassesDevices({
  refetchInterval,
}: { refetchInterval?: number } = {}): readonly GlassesDevice[] {
  const query = useApiQuery(GLASSES_DEVICES.path, { select: selectDevices, refetchInterval });
  return query.isError ? EMPTY_DEVICES : (query.data ?? EMPTY_DEVICES);
}

export function useInvalidateGlassesDevices() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: GLASSES_DEVICES.all });
}

/** The "no channel" choice; `SelectMenu` values are strings. */
export const NO_CHANNEL = "";

/**
 * Channels a device may post into: the caller's own memberships across every container
 * (the account-scope list /home reads), direct messages excluded. `current` keeps a linked
 * channel on the menu even when the list has not loaded it.
 */
export function useGlassesChannelOptions(
  current: GlassesLinkedChannel | null = null
): ReadonlyArray<SelectMenuOption<string>> {
  const { channels } = useChannels({ scope: "account" });
  return useMemo(() => {
    const options: SelectMenuOption<string>[] = [
      { value: NO_CHANNEL, label: "No channel" },
    ];
    for (const c of channels) {
      if (c.isMember && !c.isDirect) options.push({ value: c.id, label: c.name });
    }
    if (current && !options.some((o) => o.value === current.id)) {
      // The server sends "" for a channel it can no longer name.
      options.push({ value: current.id, label: current.name || "Unknown channel" });
    }
    return options;
  }, [channels, current]);
}
