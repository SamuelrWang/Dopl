"use client";

/**
 * STAGING COPY of `marketing/components/banner-demo/demo-scene.tsx › DemoScene`, the RECORD
 * PANE half only (the rail, top bar and column are `ui-staging/staging-frame.tsx`'s). Same
 * product mounts in the same order with the same props: `ChannelsMessagePane`, the
 * `.channel-info-slide` holding `ChannelsInfoPanel`, then the remaining face swaps (agent
 * state rows, agent view faces, agent cards, stream boxes) and the agent view.
 *
 * What differs (all marked STAGING):
 *  - it renders ONE CHANNEL FIXTURE (`../data/*`) instead of the demo's step-gated script, so
 *    there is no timeline, no typing and no auto-play;
 *  - every handler the demo stubs is wired to the page's in-memory store (info toggle,
 *    favourite, thread open/exit, agent open/close, mentions, citations, launch);
 *  - the composer's send and the New thread dialog's Create are caught in the CAPTURE phase
 *    and turned into in-memory writes, because the product hands both to `useThreadWrites`
 *    (a network mutation). Nothing here fetches.
 *  - (2026-10-26, channel tasks, round 2: both at once) the info column is
 *    `./tasks-info-panel.tsx › StagingInfoPanel` (the product panel + a Tasks tab, the full
 *    view), and the pane's `agentActivity` is `./tasks-popover.tsx › StagingTasksBar` (the
 *    product's working pills + a tasks pill and quick view). A quick-view row opens the Info
 *    column on Tasks, on that task's detail (round 4). With `tasks` absent, both are the product's.
 */

import { useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { AgentLaunchControls } from "@/features/channels/components/use-agents-panel";
import type { ChannelMention, ChannelThread } from "@/features/channels/types";
import {
  ChannelsMessagePane,
  type ScrollTarget,
} from "@/features/channels/components/message-pane";
import { indexMembers } from "@/features/channels/components/view-model";
import { channelRows, threadRows } from "@/features/channels/components/view-model-rows";
import { agentKey } from "@/features/channels/components/agents-model";
import {
  AgentActivityRows,
  ownAgentsWorking,
} from "@/features/channels/components/agent-activity";
import { agentColorVar } from "@/features/channels/lib/agent-colors";
import { liveAgentsFromKey, liveAgentsKey } from "@/features/channels/lib/live-agents";
import { agentNameHandle } from "@/features/channels/lib/agent-mentions";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import {
  DemoStreamBoxes,
  type StreamFace,
} from "@/features/marketing/components/banner-demo/demo-stream-boxes";
import { CURRENT_USER_ID, VIEWER } from "../data/demo-imports";
import { stagingAgentIndex, stagingIdentityFace } from "../data/staging-agents";
import type { ChannelFixture } from "../data/staging-fixture-types";
import { StagingAgentCards, StagingAgentStateRows } from "./agent-card";
import { StagingAgentViewFaces } from "./agent-view-faces";
import { StagingAgentView } from "./agent-view";
import { StagingSettingsTab } from "./settings-tab";
import { AddPersonDialog } from "@/features/popups-staging/pages/home/add-person-dialog";
import { StagingInfoPanel } from "./tasks-info-panel";
import { StagingTasksBar } from "./tasks-popover";
import { TaskPanel } from "./task-panel";
import { isActive, type StagingTask, type TaskLink } from "../data/staging-tasks";

/** STAGING (2026-10-26): the channel's tasks (the Tasks tab and the composer quick view). */
export type SceneTasks = {
  list: readonly StagingTask[];
  onResolve: (taskId: string) => void;
  onReopen: (taskId: string) => void;
  /** Round 4: the task detail's subtask checks and notes. */
  onToggleSubtask: (taskId: string, subtaskId: string) => void;
  onAddNote: (taskId: string, text: string) => void;
};

/** The composer's writes are intercepted before they reach the gate, so it is a stub. */
const STAGING_GATE: MutationGate = { begin() {}, end() {} };

/** A decision answered here lands as the product's in-flight press; nothing is written. */
const ANSWER_IN_MEMORY = async () => true;

const CHANNEL_COMPOSER = 'textarea[aria-label="Message"]';
const AGENT_VIEW = 'aside[aria-label="Agent view"]';

export type SceneActions = {
  toggleInfo: () => void;
  toggleFavorite: () => void;
  openThread: (id: string) => void;
  exitThread: () => void;
  /** `agentKey` of a session, or `null` to close the agent view. */
  openAgent: (key: string | null) => void;
  openMention: (mention: ChannelMention) => void;
  markMentionsRead: () => void;
  jumpToSeq: (seq: number) => void;
  sendMessage: (body: string) => void;
  createThread: (title: string, body: string) => void;
  sendDm: (agentId: string, text: string) => void;
  launch: AgentLaunchControls;
};

export function StagingChannelScene({
  fixture,
  thread,
  openAgentKey,
  infoOpen,
  scrollTarget,
  actions,
  agentsVersion,
  tasks,
}: {
  /** STAGING (2026-10-26): absent draws no tasks UI (the /popups windows pass none). */
  tasks?: SceneTasks;
  fixture: ChannelFixture;
  thread: ChannelThread | null;
  openAgentKey: string | null;
  infoOpen: boolean;
  scrollTarget: ScrollTarget | null;
  actions: SceneActions;
  /** Bumped when a staging launch registers a new agent, so the index re-reads. */
  agentsVersion: number;
}) {
  const pane = useRef<HTMLDivElement>(null);
  const { channel, members, messages, threads, sessions, peers, serverSessions } = fixture;

  const index = useMemo(
    () => indexMembers(members, CURRENT_USER_ID, stagingAgentIndex()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agentsVersion re-reads the registry
    [members, agentsVersion]
  );
  const rows = useMemo(
    () =>
      thread
        ? threadRows(messages, thread.id, index, formatChannelTimestamp)
        : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, threads, index, thread]
  );
  const live = useMemo(
    () => liveAgentsFromKey(liveAgentsKey(serverSessions, sessions, channel.id)),
    [serverSessions, sessions, channel.id]
  );
  const workingColors = useMemo(() => {
    const out = new Map<string, string>();
    for (const agent of live) if (agent.color) out.set(agent.name, agentColorVar(agent.color));
    return out;
  }, [live]);
  const streamFaces = useMemo(() => {
    const out = new Map<string, StreamFace>();
    out.set("you", { photo: VIEWER.avatarUrl ?? null, color: null });
    for (const [agentId, entry] of index.agents) {
      const handle = agentNameHandle(entry.displayName);
      if (handle) out.set(handle, stagingIdentityFace(agentId));
    }
    return out;
  }, [index]);

  const openSession = sessions.find((s) => agentKey(s) === openAgentKey) ?? null;
  const viewAgent = openSession ?? sessions[0] ?? null;

  const agentFeeds = useMemo(() => ({ sessions, peers }), [sessions, peers]);

  /** A pill names an agent id and a thread card's row an `agentKey`; open it if it is one of ours. */
  const openAgentById = (agentId: string) => {
    const own = sessions.find((s) => s.agentId === agentId || agentKey(s) === agentId);
    if (own) actions.openAgent(agentKey(own));
  };

  /** STAGING (2026-10-26): a task's thread opens it; its message is jumped to in channel view. */
  const openTaskLink = (link: TaskLink) => {
    if (link.kind === "thread") {
      actions.openThread(link.threadId);
      return;
    }
    actions.exitThread();
    actions.jumpToSeq(link.seq);
  };
  const taskList = tasks && {
    tasks: tasks.list,
    members,
    onResolve: tasks.onResolve,
    onReopen: tasks.onReopen,
    onOpenLink: openTaskLink,
  };
  // STAGING (round 2 + 4): the quick view's row / "See all" → the Info column on Tasks, on that
  // task's detail (`openTaskId`, like the open thread) or on the list. The nonce switches tabs.
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [tasksSignal, setTasksSignal] = useState(0);
  const openTasksTab = (taskId: string | null) => {
    if (!infoOpen) actions.toggleInfo();
    setOpenTaskId(taskId);
    setTasksSignal((n) => n + 1);
  };
  const working = (
    <AgentActivityRows
      agents={ownAgentsWorking(sessions, channel.id, thread?.id ?? null)}
      colors={workingColors}
    />
  );

  /** STAGING: the composer's send, done in memory. Clears via the toolbar's own Discard. */
  const sendFrom = (root: HTMLElement) => {
    const box = root.querySelector<HTMLTextAreaElement>(CHANNEL_COMPOSER);
    const body = box?.value.trim() ?? "";
    if (!body) return;
    actions.sendMessage(body);
    const discard = [...root.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Discard" && !b.closest(AGENT_VIEW)
    );
    discard?.click();
  };

  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.matches?.(CHANNEL_COMPOSER)) return;
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    // The @-picker owns Enter while it is open (`use-composer-mentions.ts`).
    if (document.querySelector('[aria-label="Mention a member"]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (pane.current) sendFrom(pane.current);
  };

  const onClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    const button = (e.target as HTMLElement).closest?.("button");
    if (!button || !pane.current) return;
    if (button.getAttribute("aria-label") === "Send" && !button.closest(AGENT_VIEW)) {
      e.preventDefault();
      e.stopPropagation();
      sendFrom(pane.current);
      return;
    }
    // The New thread dialog is portalled, but its events still bubble through this tree.
    const dialog = button.closest('[role="dialog"]');
    const title = dialog?.querySelector<HTMLInputElement>("#new-thread-title");
    if (title && button.textContent?.trim() === "Create") {
      e.preventDefault();
      e.stopPropagation();
      const body =
        dialog?.querySelector<HTMLTextAreaElement>("#new-thread-description")?.value ?? "";
      actions.createThread(title.value.trim(), body.trim());
      dialog?.querySelector<HTMLButtonElement>('[aria-label="Close new thread form"]')?.click();
    }
  };

  return (
    // `display: contents`: the product mounts stay direct flex items of `.lp-demo-record`;
    // this element is only the face swaps' search root and the capture boundary.
    <div
      ref={pane}
      className="contents"
      onKeyDownCapture={onKeyDownCapture}
      onClickCapture={onClickCapture}
    >
      <ChannelsMessagePane
        key={`pane-${channel.id}`}
        channelId={channel.id}
        workspaceId={channel.workspaceId}
        channelName={channel.name}
        thread={thread}
        rows={rows}
        index={index}
        members={members}
        loading={false}
        scrollTarget={scrollTarget}
        infoOpen={infoOpen}
        favorited={fixture.favorited}
        gate={STAGING_GATE}
        newAgent={actions.launch}
        liveAgents={live}
        agentFeeds={agentFeeds}
        agentActivity={
          taskList ? (
            <StagingTasksBar
              key={`tasks-${channel.id}`}
              paneRef={pane}
              working={working}
              tasks={taskList.tasks}
              members={members}
              onOpenTask={openTasksTab}
            />
          ) : (
            working
          )
        }
        onToggleInfo={actions.toggleInfo}
        onToggleFavorite={actions.toggleFavorite}
        onExitThread={actions.exitThread}
        onOpenThread={actions.openThread}
        onOpenAgent={openAgentById}
        onAnswerDisplay={ANSWER_IN_MEMORY}
        onJumpToSeq={actions.jumpToSeq}
      />
      <div className="channel-info-slide" data-open={infoOpen ? "true" : "false"}>
        {/* STAGING (2026-10-26): the product panel + a Tasks tab; without `tasks`, the product's. */}
        <StagingInfoPanel
          tasks={
            taskList && tasks ? (
              <TaskPanel
                {...taskList}
                openId={openTaskId}
                onOpenChange={setOpenTaskId}
                onToggleSubtask={tasks.onToggleSubtask}
                onAddNote={tasks.onAddNote}
              />
            ) : undefined
          }
          taskCount={tasks?.list.filter(isActive).length}
          tasksSignal={tasksSignal}
          key={`info-${channel.id}`}
          channel={channel}
          channelName={channel.name}
          members={members}
          threads={threads}
          threadsTruncated={false}
          threadsLoading={false}
          index={index}
          openThread={thread}
          onOpenThread={actions.openThread}
          agentSessions={sessions}
          peerSessions={peers}
          openAgent={openSession ? agentKey(openSession) : null}
          onOpenAgent={(key) => actions.openAgent(key)}
          mentions={fixture.mentions}
          mentionsTruncated={false}
          mentionsLoading={false}
          onOpenMention={actions.openMention}
          onMarkAllMentionsRead={actions.markMentionsRead}
          artifacts
          mentionsLayout="category"
          activityBins={fixture.activity}
          activityLoading={false}
          // STAGING: the product's `settings-slot.tsx` is wired to live writes; this is its face
          // over local state (`./settings-tab.tsx`). Without it the tab body was blank.
          settings={
            <StagingSettingsTab
              channel={channel}
              members={members}
              thread={thread}
              currentUserId={CURRENT_USER_ID}
            />
          }
          // STAGING: the demo's decorative `<span>` is the desktop's real dialog here.
          infoExtras={{
            belowRoster: (
              <div className="px-3.5 pt-2.5">
                <AddPersonDialog workspaceId={channel.workspaceId} />
              </div>
            ),
          }}
        />
      </div>
      <StagingAgentStateRows paneRef={pane} sessions={sessions} peers={peers} />
      {viewAgent && (
        <StagingAgentViewFaces
          paneRef={pane}
          agent={viewAgent}
          onClose={() => actions.openAgent(null)}
        />
      )}
      <StagingAgentCards
        paneRef={pane}
        sessions={sessions}
        peers={peers}
        index={index}
        openAgent={openSession ? agentKey(openSession) : null}
        onOpenAgent={(key) => actions.openAgent(key)}
      />
      <DemoStreamBoxes
        paneRef={pane}
        faces={streamFaces}
        self={stagingIdentityFace(viewAgent?.agentId)}
      />
      {viewAgent && (
        <StagingAgentView
          key={agentKey(viewAgent)}
          open={openSession !== null}
          agent={viewAgent}
          entries={fixture.narration[viewAgent.agentId ?? ""] ?? []}
          messages={messages}
          currentUserId={CURRENT_USER_ID}
          viewer={VIEWER}
          roster={index}
          color={index.agents.get(viewAgent.agentId ?? "")?.color ?? null}
          onClose={() => actions.openAgent(null)}
          onSend={(text) => actions.sendDm(viewAgent.agentId ?? "", text)}
        />
      )}
    </div>
  );
}
