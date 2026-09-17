"use client";

/**
 * THE HERO SCENE'S TREE — /home's frame, its rail, its header, its channel
 * column and its record pane, as a PURE FUNCTION OF THE STEP.
 *
 * ⚠ **SPLIT OUT OF `banner-demo.tsx` ON 2026-09-17 FOR TWO REASONS, AND THE
 * SECOND ONE IS THE GATE.** That file sits near the 500-line cap; more
 * importantly, Samuel asked for a check that *"collects every class name the
 * demo renders and asserts each resolves"* (`demo-class-coverage.test.tsx`) —
 * and the clock, the ResizeObserver fit, the scripted cursor and the click
 * ripple are all things a render-and-read-the-classes gate must not have to
 * start. **What is left here is exactly what paints**, so the gate mounts the
 * scene at one step and reads the DOM.
 *
 * ⚠ **NOTHING MOVED BUT THE CLOSURE.** Every rule the markup carried came with
 * it verbatim; `banner-demo.tsx` still owns the step, the box and the cursor.
 *
 * 🔒 **THE SCENE IS /home's CHANNEL RECORD AND NEVER A THREAD (Samuel,
 * 2026-09-17):** *"a majority of it is matching like the workspace pages. I want
 * it to match the home space pages."* The pane header is the channel's name, the
 * info column is **Info · Threads 0 · Agents N · Settings**, and the Info tab is
 * the account surface's own card (`demo-info-tab.tsx`). See `demo-steps.ts` for
 * the four beats that were deleted with the thread.
 */

import { useMemo, useState, type RefObject } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { AgentLaunchControls } from "@/features/channels/components/use-agents-panel";
import { ChannelsMessagePane } from "@/features/channels/components/message-pane";
import { ChannelsInfoPanel } from "@/features/channels/components/info-panel";
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
import { DemoInfoTab } from "./demo-info-tab";
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

/** ⚠ MODULE-LEVEL so the empty list is one REFERENCE, not a fresh `[]` per
 *  render — it is in a memo's dependency list. */
const NO_THREADS: never[] = [];

/**
 * THE COMPOSER'S BOT GLYPH (Samuel, 2026-09-17: the demo *"is missing the bot
 * icon"*). `composer-toolbar.tsx` draws it ONLY on `newAgent?.canLaunch` — the
 * desktop bridge op's own detection — so a scene that passed nothing was
 * correctly rendering a BROWSER's composer, which is not what /home looks like
 * on the machine Dopl runs on. ⚠ EVERY HANDLER IS INERT: the slot is decorative,
 * and both refuse rather than hang, which is the shape a caller must handle
 * anyway.
 */
const DEMO_LAUNCH: AgentLaunchControls = {
  canLaunch: true,
  launchBusy: false,
  launchError: null,
  launchAgent: () => Promise.resolve({ ok: false, reason: "demo" }),
  approveTemplate: () => Promise.resolve({ ok: false, reason: "demo" }),
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
  /** 🔒 **NO THREADS, AND THAT IS THE RULING RATHER THAN AN EMPTY FIXTURE** —
   *  the column's Threads tab reads `0`, exactly as /home does on a channel
   *  nobody has opened a thread in. */
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
                    `.bento`, the drop had nowhere to fall). `.lp-demo-record`
                    also carries `home.module.css › .frame`'s overrides, which
                    are what put the account palette on the shared surface's own
                    dividers, sender pills and composer panel. `relative` is the
                    agent view's containing block, exactly as
                    `channel-surface-standalone.tsx` states. */}
                <div className="lp-demo-record" ref={paneRef}>
                  <ChannelsMessagePane
                    key={`pane-${run}`}
                    channelId={CHANNEL_ID}
                    workspaceId={WORKSPACE_ID}
                    channelName="q4-outbound"
                    // 🔒 **ALWAYS THE CHANNEL RECORD (Samuel, 2026-09-17).** A
                    // thread here puts a BREADCRUMB in the header and a
                    // thread-scoped column beside it — the workspace shape.
                    thread={null}
                    rows={rows}
                    index={index}
                    members={MEMBERS}
                    loading={false}
                    scrollTarget={null}
                    infoOpen
                    favorited
                    gate={DEMO_GATE}
                    // ⚠ THE COMPOSER'S BOT GLYPH — see `DEMO_LAUNCH`.
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
                      // 🔒 **/home's OWN CAPABILITIES** (`relationship-record.tsx`):
                      // the Threads tab carries the Artifacts toggle here and
                      // ONLY here, and the INFO tab's body is the account
                      // surface's card rather than the channels page's.
                      artifacts
                      infoTab={
                        <DemoInfoTab
                          channelName="q4-outbound"
                          description="Q4 outbound push — enrichment, sequences, segments."
                          createdAt={SALES_CHANNEL.createdAt}
                          creator={MEMBERS[0]}
                          members={MEMBERS}
                          index={index}
                          mentions={MENTIONS}
                          activityBins={ACTIVITY_BINS}
                        />
                      }
                    />
                  </div>
                  <DemoAgentView
                    open={agentOpen}
                    agent={MY_SESSION}
                    entries={narrationAt(step)}
                    messages={messages}
                    currentUserId={CURRENT_USER_ID}
                    viewer={VIEWER}
                    // ⚠ OFF THE INDEX, exactly as the real panel resolves it —
                    // the colour is a live fact about the SESSION and is never
                    // stamped on a message row.
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
