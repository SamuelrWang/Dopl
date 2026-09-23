"use client";

import { useCallback } from "react";
import type { ModelCatalog, ModelCatalogs } from "../lib/model-catalog";
import { descriptorFor, type RuntimeDescriptor } from "../lib/runtime-capability";
import { useLaunchSelection } from "./use-launch-selection";

/**
 * A channel's launch record, read-only: the descriptor and catalog the next launch would use, and
 * the same pair for any runtime a running agent is on.
 * ⚠ A selector over `useLaunchSelection({ kind: "channel" })`, never a second store, so a Settings
 * write reaches every surface without a remount (P6-07).
 */
export interface ChannelLaunchPostureState {
  runtimeSupported: boolean;
  /** Registry order; empty off-desktop. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  defaultRuntime: string;
  /** The channel's stored pick, `''` for the default adapter. */
  runtime: string;
  descriptor: RuntimeDescriptor | null;
  catalog: ModelCatalog | null;
  catalogs: ModelCatalogs;
  /** A running agent's or a launch's runtime; `''` or an unregistered id answers the default adapter. */
  descriptorOf: (runtimeId: string | null | undefined) => RuntimeDescriptor | null;
  /** Never another runtime's list. */
  catalogOf: (runtimeId: string | null | undefined) => ModelCatalog | null;
}

export function useChannelLaunchPosture(channelId: string): ChannelLaunchPostureState {
  const selection = useLaunchSelection({ kind: "channel", channelId });
  const { runtimes, defaultRuntime, descriptor, catalogFor } = selection;
  const descriptorOf = useCallback(
    (runtimeId: string | null | undefined) => descriptorFor(runtimes, runtimeId, defaultRuntime),
    [runtimes, defaultRuntime]
  );
  const catalogOf = (runtimeId: string | null | undefined) => {
    const id = descriptorOf(runtimeId)?.id;
    return id ? catalogFor(id) : null;
  };
  return {
    runtimeSupported: selection.runtimeSupported,
    runtimes,
    defaultRuntime,
    runtime: selection.runtime,
    descriptor,
    catalog: descriptor ? catalogFor(descriptor.id) : null,
    catalogs: selection.catalogs,
    descriptorOf,
    catalogOf,
  };
}
