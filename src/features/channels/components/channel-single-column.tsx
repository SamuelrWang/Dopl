"use client";

/**
 * The web's one-column layout of `channel-surface.tsx`: the desktop's tab faces, full width, behind a header
 * dropdown (Channel · Info · Threads · Agents · Settings, plus the open agent). It renders no body of its own.
 */

import type { ReactNode } from "react";
// Cross-feature import by recorded exception (INVARIANTS §1, F-275).
import { IDENTITY_NAME_TEXT } from "@/features/agent-identities/components/identity-section";
import { cn } from "@/shared/lib/utils";
import { SelectMenu, type SelectMenuOption } from "@/shared/ui/select-menu";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { PaneHeader } from "./message-pane-header";
import { channelPaneTabs } from "./info-panel";
import { agentDisplayName, agentKey } from "./agents-model";
import type { ChannelWebViewKey } from "./use-channel-web-view";

/** The dropdown's own value space: the five faces plus the open agent. */
type Face = ChannelWebViewKey | "agent";

export function ChannelSingleColumn({
  channelName,
  threadTitle,
  threadView,
  favorited,
  onToggleFavorite,
  onExitThread,
  view,
  onSelectView,
  openAgent,
  sessions,
  onCloseAgent,
  messagePane,
  tabBody,
  agentView,
}: {
  channelName: string;
  /** The open thread's title, or `null` in channel view — the crumb's second half. */
  threadTitle: string | null;
  /** Threads leaves the list with a thread open (`channelPaneTabs` owns that rule). */
  threadView: boolean;
  favorited: boolean;
  onToggleFavorite: () => void;
  onExitThread: () => void;
  view: ChannelWebViewKey;
  onSelectView: (next: ChannelWebViewKey) => void;
  /** `agents-model.ts › agentKey` of the open agent, or `null`. */
  openAgent: string | null;
  /** This machine's session feed — read ONLY to name the open agent. */
  sessions: readonly DesktopSessionSummary[] | null;
  onCloseAgent: () => void;
  /** Transcript + composer, given the dropdown to place in its own header — one header, not two. */
  messagePane: (viewSelect: ReactNode) => ReactNode;
  /** The Info / Threads / Agents / Settings body for `view`, full width. */
  tabBody: ReactNode;
  /** The open agent's view, full width — `surface-agent-view.tsx`. */
  agentView: ReactNode;
}) {
  const openSession =
    (openAgent && sessions?.find((s) => agentKey(s) === openAgent)) || null;
  // The open agent wins over `view`: it can also be opened from a transcript sender pill.
  const face: Face = openSession ? "agent" : view;

  const options: ReadonlyArray<SelectMenuOption<Face>> = [
    { value: "channel", label: "Channel" },
    ...channelPaneTabs(threadView).map((t) => ({
      value: t.key as Face,
      label: t.label,
    })),
    // Listed so the trigger reads the open agent's name.
    ...(openSession
      ? [{ value: "agent" as Face, label: agentDisplayName(openSession) }]
      : []),
  ];

  const viewSelect = (
    <SelectMenu
      value={face}
      options={options}
      ariaLabel="Channel view"
      // The channel name's `IDENTITY_NAME_TEXT` by import, never re-typed (docs/DESIGN-SYSTEM.md);
      // a caller `className` outranks `select-menu.tsx › TRIGGER_FACE.flat`'s type in `cn`.
      className={cn("max-w-[45%]", IDENTITY_NAME_TEXT)}
      onChange={(next) => {
        // Picking the agent you are already looking at is not a navigation.
        if (next === "agent") return;
        if (openAgent) onCloseAgent();
        onSelectView(next);
      }}
    />
  );

  if (face === "channel") return <>{messagePane(viewSelect)}</>;

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      {/* The transcript's own header, so switching faces moves only the body. */}
      <PaneHeader
        channelName={channelName}
        // The info face names the channel itself.
        hideChannelCrumb={view === "info"}
        threadTitle={threadTitle}
        favorited={favorited}
        chrome="page"
        viewSelect={viewSelect}
        onToggleFavorite={onToggleFavorite}
        onExitThread={onExitThread}
      />
      {face === "agent" ? agentView : tabBody}
    </section>
  );
}
