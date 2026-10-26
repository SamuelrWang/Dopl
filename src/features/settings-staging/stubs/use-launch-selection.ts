"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- stubs keep the real signatures they stand in for */

import { useMemo, useState } from "react";
import type {
  LaunchSelectionPatch,
  LaunchSelectionState,
} from "@/features/channels/hooks/use-launch-selection";
import type { PermissionLevel } from "@/features/channels/lib/launch-selection";
import { NO_CATALOGS } from "@/features/channels/lib/model-catalog";
import { STAGING_LEVEL_SETTINGS, STAGING_RUNTIMES } from "../settings-mock-data";

/**
 * STUB of `@/features/channels/hooks/use-launch-selection › useLaunchSelection` — the default agent
 * settings record, in memory instead of main's electron-store. `bridge` is a non-null fake so the
 * Configuration pane draws its rows.
 */
const FAKE_BRIDGE = {
  read: async () => null,
  write: async () => ({ ok: true }),
};

export function useLaunchSelection(_scope: { kind: "defaults" } | { kind: "channel"; channelId: string }): LaunchSelectionState {
  const [record, setRecord] = useState({
    runtime: "",
    level: "auto" as PermissionLevel,
    messages: "auto_inbound",
    agentChain: false,
  });
  const [busy, setBusy] = useState(false);

  return useMemo<LaunchSelectionState>(
    () => ({
      bridge: FAKE_BRIDGE,
      runtimeSupported: true,
      runtimes: STAGING_RUNTIMES,
      connected: ["claude", "codex"],
      connectedKnown: true,
      defaultRuntime: "claude",
      runtime: record.runtime,
      descriptor: STAGING_RUNTIMES.find((d) => d.id === (record.runtime || "claude")) ?? null,
      messages: record.messages,
      level: record.level,
      levelFor: () => record.level,
      settingFor: (runtimeId) => STAGING_LEVEL_SETTINGS[runtimeId]?.[record.level] ?? null,
      catalogFor: () => null,
      catalogs: NO_CATALOGS,
      review: [],
      rejected: [],
      agentChain: record.agentChain,
      busy,
      async update(patch: LaunchSelectionPatch) {
        setBusy(true);
        await new Promise((resolve) => setTimeout(resolve, 150));
        setRecord((prev) => ({
          runtime: patch.runtime ?? prev.runtime,
          level: patch.level ?? prev.level,
          messages: patch.messages ?? prev.messages,
          agentChain: patch.agentChain ?? prev.agentChain,
        }));
        setBusy(false);
      },
    }),
    [record, busy]
  );
}
