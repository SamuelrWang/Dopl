"use client";

import { useCallback } from "react";
import type { ModelCatalog, ModelCatalogs } from "../lib/model-catalog";
import { descriptorFor, type RuntimeDescriptor } from "../lib/runtime-capability";
import { useLaunchSelection } from "./use-launch-selection";

/**
 * A CHANNEL'S LAUNCH RECORD, READ-ONLY — the runtime roster, the descriptor and model catalog the
 * channel's next launch would use, and the same pair for any runtime a running agent is on.
 *
 * ⚠ A SELECTOR OVER `useLaunchSelection({ kind: "channel" })`, never a second store: one bridge
 * read and one reader set per record, so a Settings write reaches the agent panel, the composer
 * and the launch refusal copy without a remount (P6-07). Every write goes through
 * `useLaunchSelection.update`.
 */
export interface ChannelLaunchPostureState {
  /** The desktop reported its runtime roster. */
  runtimeSupported: boolean;
  /** Every adapter this desktop registered, in registry order. Empty off-desktop. */
  runtimes: ReadonlyArray<RuntimeDescriptor>;
  /** The adapter a record with no pick launches on. */
  defaultRuntime: string;
  /** The channel's stored pick, `''` for the default adapter. */
  runtime: string;
  /** The descriptor the channel's next launch would use — the pick, else the default, else null. */
  descriptor: RuntimeDescriptor | null;
  /** {@link descriptor}'s model catalog. */
  catalog: ModelCatalog | null;
  /** Every runtime's catalog, keyed by runtime id. */
  catalogs: ModelCatalogs;
  /**
   * One runtime's descriptor — a running agent's `runtimeId` or a launch's per-spawn pick. `''` or
   * an unregistered id answers the default adapter (`session-engine.js` stamps that on a session
   * that named none). `null` only off-desktop.
   */
  descriptorOf: (runtimeId: string | null | undefined) => RuntimeDescriptor | null;
  /** {@link descriptorOf}'s catalog. ⚠ Never another runtime's list. */
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
