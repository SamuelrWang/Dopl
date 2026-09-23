"use client";

/**
 * The agent window's `+` form: the same New Agent dialog and launch act, for the active tab's
 * channel. It mounts `useLaunchControls` itself (no channels page above it, no peer poll).
 */

import { useMemo } from "react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { agentColorOrNull } from "../lib/agent-colors";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import type { AgentLaunchPanel } from "./use-agent-launch";
import { useLaunchControls } from "./use-launch-controls";

/** Empty on purpose: a foreign identity still reads "by another member" — only the name is lost. */
const NO_ROSTER: ReadonlyArray<{
  userId: string;
  displayName: string | null;
  email: string | null;
}> = [];

/** Module scope, so a `null` feed does not rebuild the taken set every render. */
const NO_SESSIONS: ReadonlyArray<DesktopSessionSummary> = [];

/** `panel` is the host's state: the `+` in the chrome and this form share whether it is open. */
export function AgentWindowLaunch({
  panel,
  workspaceId,
  currentUserId,
  channelId,
  taskId,
  sessions = NO_SESSIONS,
  agent,
}: {
  panel: AgentLaunchPanel;
  workspaceId: string;
  currentUserId: string;
  channelId: string;
  /** The active tab's thread; `""` = none first-class, so the agent starts on the room (`null`). */
  taskId: string;
  /** This machine's feed — the only colour source here, so a peer's key looks free until the
   *  server rejects it. `null` = could not ask (reads as empty). */
  sessions?: readonly DesktopSessionSummary[] | null;
  /** The active tab's row: the only source for channel name and thread title (labels only). */
  agent: DesktopSessionSummary | null;
}) {
  const launch = useLaunchControls({
    channelId,
    workspaceId,
    channelName: agent?.channelName ?? "",
    thread: () => ({ title: agent?.threadTitle ?? null, counterpartyId: null }),
  });
  // Absent, not disabled, when the bridge cannot launch (INVARIANTS §11).
  const newAgent = launch.canLaunch ? launch : undefined;

  // Narrowed by `agentColorOrNull`, not cast; ended rows stay — `agentColorsTaken` drops them.
  const liveSessions = useMemo(
    () =>
      (sessions ?? []).
        filter((s) => s.channelId === channelId).
        map((s) => ({
          state: s.state,
          color: agentColorOrNull(s.color),
          name: s.name,
          displayName: s.displayName ?? null,
        })),
    [sessions, channelId]
  );

  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={newAgent}
      liveSessions={liveSessions}
      openThreadId={taskId || null}
      channelId={channelId}
      workspaceId={workspaceId}
      currentUserId={currentUserId}
      members={NO_ROSTER}
    />
  );
}
