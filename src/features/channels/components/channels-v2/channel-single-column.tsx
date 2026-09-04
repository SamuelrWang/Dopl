"use client";

/**
 * THE CHANNEL ON ONE COLUMN — the **WEB** layout of the surface
 * `channel-surface.tsx` renders as two columns on the desktop (Samuel,
 * 2026-09-04).
 *
 * ⚠ THE DESKTOP APP IS THE REFERENCE AND NOTHING IN IT IS REDRAWN. Every face
 * here is the SAME component the desktop's tab column renders — `info-tab.tsx`,
 * `threads-tab.tsx`, the agent cards of `agents-tab.tsx`, the Settings slot,
 * `agent-panel.tsx` — at a different WIDTH and behind a different SWITCHER.
 * What changed is the switcher and the geometry, and only those:
 *
 *   · the slide-out column is GONE, so the chat area is the whole page;
 *   · the info TOGGLE in the header (`PanelRight`) is a DROPDOWN in the same
 *     spot, listing **Channel · Info · Threads · Agents · Settings**;
 *   · "Channel" is the transcript itself, which is the switcher's whole point:
 *     on a phone the conversation and the column cannot both be on screen, so
 *     the conversation has to be one of the choices.
 *
 * ⚠ NO KNOWLEDGE FACE, ANYWHERE ON THIS PAGE (Samuel's word, 2026-09-04). The
 * capability is not merely unpassed by the host — this layout builds its option
 * list with `knowledge` FALSE by construction, so a host that turned the
 * capability on could not put the tab back on a phone by accident.
 *
 * ⚠ THE OPEN AGENT IS A FACE OF THE SAME DROPDOWN. Tapping an agent box opens
 * that agent in the main area and the dropdown then READS ITS NAME, so the way
 * back to the conversation is the control the reader already used to get here —
 * there is no other navigation on this page to offer them.
 *
 * ⚠ IT RENDERS NOTHING OF ITS OWN. The three bodies arrive as nodes from the
 * surface that already wired them; this file owns the switcher, the header and
 * which body is on screen.
 */

import type { ReactNode } from "react";
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
  /** ⚠ THREADS LEAVES THE LIST WITH A THREAD OPEN, exactly as it leaves the
   *  desktop's tab row (`channelPaneTabs` owns that rule — one derivation). */
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
  /**
   * The transcript + composer, ASKED FOR THE DROPDOWN. A function because the
   * control belongs INSIDE that pane's own header when the channel is the face
   * on screen — the header is the pane's, and there must not be two of them.
   */
  messagePane: (viewSelect: ReactNode) => ReactNode;
  /** The Info / Threads / Agents / Settings body for `view`, full width. */
  tabBody: ReactNode;
  /** The open agent's view, full width — `surface-agent-view.tsx`. */
  agentView: ReactNode;
}) {
  const openSession =
    (openAgent && sessions?.find((s) => agentKey(s) === openAgent)) || null;
  // ⚠ THE AGENT WINS OVER `view`, and it has to: an agent can be opened from the
  // TRANSCRIPT's sender pill as well as from an agent box, so "an agent is open"
  // is the more specific answer to what is on screen.
  const face: Face = openSession ? "agent" : view;

  const options: ReadonlyArray<SelectMenuOption<Face>> = [
    { value: "channel", label: "Channel" },
    // ⚠ `false` IS THE KNOWLEDGE ARGUMENT AND IT IS LITERAL — see the header.
    ...channelPaneTabs(threadView, false).map((t) => ({
      value: t.key as Face,
      label: t.label,
    })),
    // The open agent, so the trigger can READ ITS NAME. Listing it is what makes
    // "where am I" and "where can I go" one control instead of two.
    ...(openSession
      ? [{ value: "agent" as Face, label: agentDisplayName(openSession) }]
      : []),
  ];

  const viewSelect = (
    <SelectMenu
      value={face}
      options={options}
      ariaLabel="Channel view"
      // ⚠ THE `flat` FACE, which is what this control wears everywhere else in
      // the app (`select-menu.tsx`) — the header gets no bespoke trigger.
      className="max-w-[45%]"
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
      {/* ⚠ THE SAME HEADER THE TRANSCRIPT WEARS — crumb, bookmark, dropdown —
          so switching faces moves the body and nothing else. A second header
          shape here would make the page appear to navigate. */}
      <PaneHeader
        channelName={channelName}
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
