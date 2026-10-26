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
import type { ChannelThread } from "@/features/channels/types";
import { ChannelsMessagePane } from "@/features/channels/components/message-pane";
import { ChannelsInfoPanel } from "@/features/channels/components/info-panel";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { indexMembers } from "@/features/channels/components/view-model";
import {
  channelRows,
  threadRows,
} from "@/features/channels/components/view-model-rows";
import { agentKey } from "@/features/channels/components/agents-model";
import {
  AgentActivityRows,
  ownAgentsWorking,
} from "@/features/channels/components/agent-activity";
import {
  liveAgentsFromKey,
  liveAgentsKey,
  useWorkingColors,
} from "@/features/channels/lib/live-agents";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { reached } from "./demo-steps";
import {
  AGENT_IDS,
  AGENT_INDEX,
  CHANNEL_ID,
  CHANNEL_NAME,
  CURRENT_USER_ID,
  DEMO_CHANNEL,
  MEMBERS,
  MY_SESSION,
  MY_SESSIONS,
  PEER_NOTICE,
  PEER_SCOUT,
  PEER_TRIAGE,
  PEER_WAKE,
  SERVER_SESSIONS,
  WORKSPACE_ID,
} from "./demo-data";
import {
  messagesAt,
  threadsAt,
  typedMessageAt,
} from "./demo-transcript";
import { narrationAt, typedDmAt } from "./demo-narration";
import { revealBody } from "./typed-reveal";
import { ACTIVITY_BINS, mentionsAt } from "./demo-info-data";
import { HOME_ROW_ID, VIEWER, homeRowsAt } from "./demo-home-rows";
import { DemoAccountRail } from "./demo-home-chrome";
import { DemoChannelSwitcher, DemoTopBar } from "./demo-home-faces";
import { ownerPhoto } from "./demo-identities";
import { DemoAgentView } from "./demo-agent-view";
import { openTaskAt, tasksAt, tasksTabSignalAt } from "./demo-tasks";
import { useSceneTaskSlots, type SceneTasks } from "./scene-tasks";

/** The composer's writes never fire (the slot is inert), so the gate is a stub. */
const DEMO_GATE: MutationGate = { begin() {}, end() {} };

const NOOP = () => {};
const NOOP_ASYNC = () => Promise.resolve();

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
  thread = null,
  onOpenThread = NOOP,
  onExitThread = NOOP,
  typedWords,
}: {
  step: number;
  /** Bumped per loop so the info column's tab state resets on every replay. */
  run?: number;
  /** The record pane — the scripted cursor's search root (`banner-demo.tsx`). */
  paneRef?: RefObject<HTMLDivElement | null>;
  agentOpen?: boolean;
  onOpenAgent?: () => void;
  /**
   * **THE OPEN THREAD, OR `null` FOR THE CHANNEL RECORD.**
   *
   * ⚠ `null` IS THE CHANNEL VIEW and that is the product's own switch, not a demo flag
   * (`message-pane.tsx › thread`). One pane renders one or the other and never both,
   * which is why step 8 walks the cursor back out through the crumb rather than trying
   * to show a thread and the channel at once.
   */
  thread?: ChannelThread | null;
  /** The thread card's own "Open thread" button fires this. */
  onOpenThread?: () => void;
  /** The breadcrumb's channel crumb fires this — the way back out. */
  onExitThread?: () => void;
  /**
   * Words shown of the human line landing on this step (`typed-reveal.ts`);
   * absent shows it whole (tests, reduced motion).
   */
  typedWords?: number;
}) {
  const [qc] = useState(() => new QueryClient());
  // The typed line is cut in the DATA, so the real transcript renders it as is.
  const messages = useMemo(() => {
    const all = messagesAt(step);
    const typed = typedWords === undefined ? null : typedMessageAt(step);
    if (!typed) return all;
    return all.map((m) =>
      m.id === typed.id ? { ...m, body: revealBody(m.body, typedWords ?? 0) } : m
    );
  }, [step, typedWords]);
  const narration = useMemo(() => {
    const all = narrationAt(step);
    const typed = typedWords === undefined ? null : typedDmAt(step);
    if (!typed) return all;
    return all.map((e) =>
      e === typed && e.text
        ? { ...e, text: revealBody(e.text, typedWords ?? 0) }
        : e
    );
  }, [step, typedWords]);
  const index = useMemo(
    () => indexMembers(MEMBERS, CURRENT_USER_ID, AGENT_INDEX),
    []
  );
  /**
   * ⚠ **THE PANE'S ROWS ARE A DIFFERENT DERIVATION IN EACH VIEW, off ONE message array.**
   * `channelRows` collapses every thread-tagged message into one card per thread;
   * `threadRows` filters the same array back down to one thread's own transcript. Nothing
   * is authored twice, which is what keeps the card preview and the thread body identical
   * by construction.
   */
  const rows = useMemo(
    () =>
      thread
        ? threadRows(messages, thread.id, index, formatChannelTimestamp)
        : channelRows(messages, threadsAt(step), index, formatChannelTimestamp),
    [messages, index, thread, step]
  );
  /**
   * ⚠ **STEP-GATED ON EACH AGENT'S OWN LAUNCH BEAT**, so the Agents tab counts what has
   * actually been launched: the orchestrator on `launch-2`, then its three coders as
   * `thread-launch-1`…`-3` fire. The order is `MY_SESSIONS`'s own, which is launch order,
   * and the cursor depends on it (see that export).
   */
  const sessions = useMemo(() => {
    const live: typeof MY_SESSIONS = [];
    if (reached(step, "launch-2")) live.push(MY_SESSIONS[0]);
    if (reached(step, "thread-launch-1")) live.push(MY_SESSIONS[1]);
    return live;
  }, [step]);
  const peers = useMemo(() => {
    const out = [];
    if (reached(step, "launch-1")) out.push(PEER_TRIAGE);
    if (reached(step, "launch-3")) out.push(PEER_SCOUT);
    // Grace's and Anthony's coders, on the same beats the planner's launch lines name.
    if (reached(step, "thread-launch-2")) out.push(PEER_NOTICE);
    if (reached(step, "thread-launch-3")) out.push(PEER_WAKE);
    return out;
  }, [step]);
  /**
   * The server's projection at this beat, gated on the SAME launch beats as the desktop
   * feed above — the two are one event seen from two sides, so a row appearing in one and
   * not the other would be a state the product never has.
   */
  const serverSessions = useMemo(
    () =>
      SERVER_SESSIONS.filter((row) => {
        if (row.name === AGENT_IDS.triage) return reached(step, "launch-1");
        if (row.name === AGENT_IDS.planner) return reached(step, "launch-2");
        if (row.name === AGENT_IDS.scout) return reached(step, "launch-3");
        if (row.name === AGENT_IDS.teardown)
          return reached(step, "thread-launch-1");
        if (row.name === AGENT_IDS.notice) return reached(step, "thread-launch-2");
        if (row.name === AGENT_IDS.wake) return reached(step, "thread-launch-3");
        return false;
      }),
    [step]
  );
  const homeRows = useMemo(() => homeRowsAt(step), [step]);
  const agentFeeds = useMemo(() => ({ sessions, peers }), [sessions, peers]);

  /**
   * **THE COMPOSER'S LIVE SET** (Samuel, 2026-10-12: show the agents currently working
   * above the input, with the auto-tag control).
   *
   * ⚠ **BUILT THROUGH THE PRODUCT'S OWN DERIVATION, NOT HAND-ROLLED.**
   * `liveAgentsKey` → `liveAgentsFromKey` is what `channel-surface.tsx` uses, and it is
   * where the name/colour precedence rule lives (names from the desktop feed, colours
   * from the server projection only). Constructing `LiveAgentSession` rows directly here
   * would be a second answer to that question and would drift the day it changes.
   *
   * ⚠ It feeds BOTH the working strip and `ComposerRecipients` — the "→ @handle" reach
   * line, which is the auto-tag control: it predicts who an unaddressed draft would go
   * to. One set, so the strip and the line cannot disagree about who is live.
   */
  const live = useMemo(
    () => liveAgentsFromKey(liveAgentsKey(serverSessions, sessions, CHANNEL_ID)),
    [serverSessions, sessions]
  );
  /** `agentId` → a `var()` reference, resolved by the host exactly as the real one does. */
  const workingColors = useWorkingColors(live);

  const tasks = useMemo<SceneTasks>(
    () => ({
      list: tasksAt(step),
      onSetStatus: NOOP,
      onToggleSubtask: NOOP,
      onAddNote: NOOP_ASYNC,
    }),
    [step]
  );
  // The open task and the Tasks tab follow the step; the pressed controls only close their own pop-up.
  const taskSlots = useSceneTaskSlots({
    tasks,
    index,
    feeds: agentFeeds,
    openTaskId: openTaskAt(step),
    onSelectTask: NOOP,
    onOpenTask: NOOP,
    onOpenLink: NOOP,
    defaultResolvedOpen: true,
  });

  return (
    <QueryClientProvider client={qc}>
          {/* /home's frame: the panel sits flush on the rail, as `pages/home/index.tsx`'s `!ml-0`. */}
          <div className="lp-demo-home antialiased">
            <DemoAccountRail />
            <main className="page-float lp-demo-panel">
              <DemoTopBar viewer={VIEWER} />
              <div className="flex min-h-0 flex-1">
                <DemoChannelSwitcher rows={homeRows} selectedId={HOME_ROW_ID} />
                {/* The record pane: a line-bounded card, not an elevation, as on /home.
                    `data-frame-skin` applies the kit's account palette; the pane is
                    the agent view's containing block. */}
                <div className="lp-demo-record" data-frame-skin ref={paneRef}>
                  <ChannelsMessagePane
                    key={`pane-${run}`}
                    channelId={CHANNEL_ID}
                    workspaceId={WORKSPACE_ID}
                    channelName={CHANNEL_NAME}
                    thread={thread}
                    rows={rows}
                    index={index}
                    members={MEMBERS}
                    loading={false}
                    scrollTarget={null}
                    infoOpen
                    favorited
                    gate={DEMO_GATE}
                    newAgent={DEMO_LAUNCH}
                    // The composer's live set: the tint, the mention picker and the
                    // reach line ("→ @handle", the auto-tag control) all read it.
                    liveAgents={live}
                    agentFeeds={agentFeeds}
                    tasksQuickView={taskSlots.quickView}
                    // The working strip above the input, scoped to whatever the composer
                    // is pointed at — so it narrows to the thread's coders inside it.
                    agentActivity={
                      <AgentActivityRows
                        agents={ownAgentsWorking(
                          sessions,
                          CHANNEL_ID,
                          thread?.id ?? null
                        )}
                        colors={workingColors}
                      />
                    }
                    onToggleInfo={NOOP}
                    onToggleFavorite={NOOP}
                    // The breadcrumb's channel crumb: the cursor's way back out.
                    onExitThread={onExitThread}
                    onOpenThread={onOpenThread}
                    onOpenAgent={onOpenAgent}
                  />
                  <div className="channel-info-slide" data-open="true">
                    <ChannelsInfoPanel
                      key={`info-${run}`}
                      tasks={taskSlots.panel}
                      activeTaskCount={taskSlots.activeTaskCount}
                      tasksTabSignal={tasksTabSignalAt(step)}
                      channel={DEMO_CHANNEL}
                      channelName={CHANNEL_NAME}
                      members={MEMBERS}
                      threads={threadsAt(step)}
                      threadsTruncated={false}
                      threadsLoading={false}
                      index={index}
                      openThread={thread}
                      onOpenThread={onOpenThread}
                      agentSessions={sessions}
                      peerSessions={peers}
                      openAgent={agentOpen ? agentKey(MY_SESSION) : null}
                      onOpenAgent={onOpenAgent}
                      // Step-gated like every sibling feed: a mention appears with
                      // the post it cites (`demo-info-data.ts › mentionsAt`).
                      mentions={mentionsAt(step)}
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
                    ownerPhoto={ownerPhoto(MY_SESSION.agentId)}
                    entries={narration}
                    messages={messages}
                    currentUserId={CURRENT_USER_ID}
                    viewer={VIEWER}
                    // The addressee pills on a posted-to box resolve off this, exactly as
                    // `agent-panel.tsx` hands it down. Absent draws NO pills at all
                    // (`agent-stream.tsx › roster`), which is what the demo showed.
                    roster={index}
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
