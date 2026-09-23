"use client";

/**
 * The hero scene's tree — /home's frame, rail, header, channel column and record
 * pane, as a pure function of the step.
 *
 * Split from `banner-demo.tsx` so `demo-class-coverage.test.tsx` can mount the
 * scene at one step and read the DOM: the clock, the ResizeObserver fit, the
 * scripted cursor and the click ripple are all things that gate must not have to
 * start. What is left here is exactly what paints.
 *
 * (2026-09-17) The scene is /home's CHANNEL RECORD and never a thread. The pane
 * header is the channel's name, the info column is Info / Threads 0 / Agents N /
 * Settings, and the Info tab is the account surface's own mentions face.
 */

import { useMemo, useState, type RefObject } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { AgentLaunchControls } from "@/features/channels/components/use-agents-panel";
import { ChannelsMessagePane } from "@/features/channels/components/message-pane";
import { ChannelsInfoPanel } from "@/features/channels/components/info-panel";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { indexMembers } from "@/features/channels/components/view-model";
import { channelRows } from "@/features/channels/components/view-model-rows";
import { agentKey } from "@/features/channels/components/agents-model";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { reached } from "./demo-steps";
import {
  AGENT_INDEX,
  CHANNEL_ID,
  CURRENT_USER_ID,
  MEMBERS,
  MY_SESSION,
  PEER_ANALYST,
  PEER_ENRICHER,
  SALES_CHANNEL,
  WORKSPACE_ID,
  messagesAt,
  narrationAt,
} from "./demo-data";
import { ACTIVITY_BINS, MENTIONS } from "./demo-info-data";
import { HOME_ROW_ID, VIEWER, homeRowsAt } from "./demo-home-rows";
import {
  DemoAccountRail,
  DemoChannelList,
  DemoHomeHeader,
} from "./demo-home-chrome";
import { DemoAgentView } from "./demo-agent-view";

/** The composer's writes never fire (the slot is inert), so the gate is a stub. */
const DEMO_GATE: MutationGate = { begin() {}, end() {} };

const NOOP = () => {};

/** Module-level so the empty list is one REFERENCE, not a fresh `[]` per render
 *  — it is in a memo's dependency list. */
const NO_THREADS: never[] = [];

/**
 * The composer's Bot glyph. `composer-toolbar.tsx` draws it only on
 * `newAgent?.canLaunch`, so a scene that passed nothing correctly rendered a
 * BROWSER's composer, which is not what /home looks like on a machine running
 * Dopl. Every handler is inert and refuses rather than hangs.
 */
const DEMO_LAUNCH: AgentLaunchControls = {
  canLaunch: true,
  launchBusy: false,
  launchError: null,
  launchAgent: () => Promise.resolve({ ok: false, reason: "demo" }),
  approveIdentity: () => Promise.resolve({ ok: false, reason: "demo" }),
};

export function DemoScene({
  step,
  run = 0,
  paneRef,
  agentOpen = false,
  onOpenAgent = NOOP,
}: {
  step: number;
  /** Bumped per loop so the info column's own tab state starts from the
   *  product's default on every replay. */
  run?: number;
  /** The RECORD PANE — the scripted cursor's search root (`banner-demo.tsx`). */
  paneRef?: RefObject<HTMLDivElement | null>;
  agentOpen?: boolean;
  onOpenAgent?: () => void;
}) {
  const [qc] = useState(() => new QueryClient());
  const messages = useMemo(() => messagesAt(step), [step]);
  const index = useMemo(
    () => indexMembers(MEMBERS, CURRENT_USER_ID, AGENT_INDEX),
    []
  );
  /** No threads: the ruling, not an empty fixture. The column's Threads tab reads
   *  `0`, exactly as /home does on a channel with none. */
  const rows = useMemo(
    () => channelRows(messages, NO_THREADS, index, formatChannelTimestamp),
    [messages, index]
  );
  const sessions = useMemo(
    () => (reached(step, "launch-2") ? [MY_SESSION] : []),
    [step]
  );
  const peers = useMemo(() => {
    const out = [];
    if (reached(step, "launch-1")) out.push(PEER_ENRICHER);
    if (reached(step, "launch-3")) out.push(PEER_ANALYST);
    return out;
  }, [step]);
  const homeRows = useMemo(() => homeRowsAt(step), [step]);

  return (
    <QueryClientProvider client={qc}>
          {/* /home's frame: the dark slab, the rail, and ONE gray panel butting
              flush-left against the rail — `pages/home/index.tsx`'s `!ml-0`,
              here as `.lp-demo-panel`'s own zeroed left margin. */}
          <div className="lp-demo-home antialiased">
            <DemoAccountRail />
            <main className="page-float lp-demo-panel">
              <DemoHomeHeader />
              <div className="flex min-h-0 flex-1">
                <DemoChannelList rows={homeRows} selectedId={HOME_ROW_ID} />
                {/* THE RECORD PANE — a white card bounded by the account
                    palette's 2px line, NOT an elevation (`index.tsx`: no
                    `.bento`, the drop had nowhere to fall). `data-frame-skin`
                    is the account palette on the shared surface's own dividers,
                    sender pills and composer panel — the KIT's since R-38
                    (2026-09-17), where this scene used to carry a ported copy in
                    `marketing.css`. `relative` is the agent view's containing
                    block, exactly as `channel-surface-standalone.tsx` states. */}
                <div className="lp-demo-record" data-frame-skin ref={paneRef}>
                  <ChannelsMessagePane
                    key={`pane-${run}`}
                    channelId={CHANNEL_ID}
                    workspaceId={WORKSPACE_ID}
                    channelName="q4-outbound"
                    // Always the channel record: a thread here puts a breadcrumb
                    // in the header and a thread-scoped column beside it.
                    thread={null}
                    rows={rows}
                    index={index}
                    members={MEMBERS}
                    loading={false}
                    scrollTarget={null}
                    infoOpen
                    favorited
                    gate={DEMO_GATE}
                    // The composer's Bot glyph — see `DEMO_LAUNCH`.
                    newAgent={DEMO_LAUNCH}
                    onToggleInfo={NOOP}
                    onToggleFavorite={NOOP}
                    onExitThread={NOOP}
                    onOpenAgent={onOpenAgent}
                  />
                  <div className="channel-info-slide" data-open="true">
                    <ChannelsInfoPanel
                      key={`info-${run}`}
                      channel={SALES_CHANNEL}
                      channelName="q4-outbound"
                      members={MEMBERS}
                      threads={NO_THREADS}
                      threadsTruncated={false}
                      threadsLoading={false}
                      index={index}
                      openThread={null}
                      onOpenThread={NOOP}
                      agentSessions={sessions}
                      peerSessions={peers}
                      openAgent={agentOpen ? agentKey(MY_SESSION) : null}
                      onOpenAgent={onOpenAgent}
                      mentions={MENTIONS}
                      mentionsTruncated={false}
                      mentionsLoading={false}
                      onOpenMention={NOOP}
                      onMarkAllMentionsRead={NOOP}
                      // /home's own capabilities (`relationship-record.tsx`): the
                      // Threads tab carries the Artifacts toggle here and only
                      // here, and the Info tab wears the account surface's
                      // mentions face.
                      artifacts
                      mentionsLayout="category"
                      // The hero renders the product's own Info body. No
                      // `headerEdit` or `infoCardEdit` is passed, which is the
                      // display-only face a decorative pane wants.
                      activityBins={ACTIVITY_BINS}
                      activityLoading={false}
                      // (2026-08-25) Add person sits under the roster with no
                      // heading. A `<span>`, not a button: the pane is decorative
                      // and `aria-hidden`.
                      infoExtras={{
                        belowRoster: (
                          <div className="px-3.5 pt-2.5">
                            <span className={PAGE_ACTION_BTN}>Add person</span>
                          </div>
                        ),
                      }}
                    />
                  </div>
                  <DemoAgentView
                    open={agentOpen}
                    agent={MY_SESSION}
                    entries={narrationAt(step)}
                    messages={messages}
                    currentUserId={CURRENT_USER_ID}
                    viewer={VIEWER}
                    // Off the index, as the real panel resolves it: the colour is
                    // a live fact about the SESSION, never stamped on a row.
                    color={
                      index.agents.get(MY_SESSION.agentId ?? "")?.color ?? null
                    }
                    onClose={NOOP}
                  />
                </div>
              </div>
            </main>
          </div>
    </QueryClientProvider>
  );
}
