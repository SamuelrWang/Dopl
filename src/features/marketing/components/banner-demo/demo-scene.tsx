"use client";

/**
 * The hero scene as a pure function of the step: /home's frame, rail, header, channel
 * column and record pane. Split from `banner-demo.tsx` so `demo-class-coverage.test.tsx`
 * can mount one step without starting the clock, resize fit or scripted cursor.
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

/** One reference, not a fresh `[]` per render: it is a memo dependency. */
const NO_THREADS: never[] = [];

/** `canLaunch` draws the composer's Bot glyph, as desktop /home does; every handler refuses. */
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
  /** Bumped per loop so the info column's tab state resets on every replay. */
  run?: number;
  /** The record pane — the scripted cursor's search root (`banner-demo.tsx`). */
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
  /** No threads by design: the Threads tab reads `0`, as on a /home channel with none. */
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
          {/* /home's frame: the panel sits flush on the rail, as `pages/home/index.tsx`'s `!ml-0`. */}
          <div className="lp-demo-home antialiased">
            <DemoAccountRail />
            <main className="page-float lp-demo-panel">
              <DemoHomeHeader />
              <div className="flex min-h-0 flex-1">
                <DemoChannelList rows={homeRows} selectedId={HOME_ROW_ID} />
                {/* The record pane: a line-bounded card, not an elevation, as on /home.
                    `data-frame-skin` applies the kit's account palette; the pane is
                    the agent view's containing block. */}
                <div className="lp-demo-record" data-frame-skin ref={paneRef}>
                  <ChannelsMessagePane
                    key={`pane-${run}`}
                    channelId={CHANNEL_ID}
                    workspaceId={WORKSPACE_ID}
                    channelName="q4-outbound"
                    // Always the channel record, never a thread (no breadcrumb or thread column).
                    thread={null}
                    rows={rows}
                    index={index}
                    members={MEMBERS}
                    loading={false}
                    scrollTarget={null}
                    infoOpen
                    favorited
                    gate={DEMO_GATE}
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
                      // /home's own capabilities (`relationship-record.tsx`).
                      artifacts
                      mentionsLayout="category"
                      // No `headerEdit`/`infoCardEdit`: the display-only face.
                      activityBins={ACTIVITY_BINS}
                      activityLoading={false}
                      // A `<span>`, not a button: the pane is decorative and `aria-hidden`.
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
                    // From the index, as the real panel resolves it: colour belongs to the session.
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
