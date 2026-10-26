"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- stubs keep the real signatures they stand in for */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MessageSquareOff } from "lucide-react";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AgentWindowTab } from "@/shared/lib/spa-bridge-window";
import { toast } from "@/shared/ui/toast";
import { EmptyState } from "@/shared/ui/empty-state";
import { indexMembers } from "@/features/channels/components/view-model";
import { LaunchAgentDialog } from "@/features/channels/components/launch-agent-dialog";
import type { AgentLaunchPanel } from "@/features/channels/components/use-agent-launch";
import { agentColorOrNull } from "@/shared/lib/agent-colors";
import { StagingChannelScene } from "@/features/channels-staging/home/channel-scene";
import { DemoAgentView } from "@/features/marketing/components/banner-demo/demo-agent-view";
import { useStagingChannels } from "@/features/channels-staging/store/use-staging-channels";
import { initialRows } from "@/features/channels-staging/data/staging-rows";
import { seedChannel, stagingQueryClient } from "@/features/channels-staging/data/staging-query-seed";
import {
  stagingAgentIndex,
  stagingOwnerPhoto,
} from "@/features/channels-staging/data/staging-agents";
import { CURRENT_USER_ID, VIEWER } from "@/features/channels-staging/data/demo-imports";

/**
 * STUBS of what the thread-window and agent-window pages import from the channels feature and the
 * window bridge. The window CHROME (shell, tabs, rail) is real. The BODIES are the /channels
 * staging face, IMPORTED (not copied) from `src/features/channels-staging/`: its in-memory store
 * (`useStagingChannels`), its record pane (`StagingChannelScene`, here forced into one thread) and
 * its agent view (the landing demo's `DemoAgentView`, `layout="fill"`). The agent window's "+" draws the product's
 * `LaunchAgentDialog` on that store's launch controls, the same pair /channels' composer uses.
 *
 * One store per open window (`StagingChannelWindowsProvider`, mounted by
 * `staging-popups.tsx › StagingWindow`), on the demo channel the window route names
 * (`desktop-shell.tsx › STAGING_WINDOW_ROUTE`). Closing the window resets it.
 */

type WindowStore = ReturnType<typeof useStagingChannels>;
const WindowStoreContext = createContext<WindowStore | null>(null);

function useWindowStore(): WindowStore {
  const store = useContext(WindowStoreContext);
  if (!store) throw new Error("popups-staging: a channel window body rendered outside StagingChannelWindowsProvider");
  return store;
}

/** STAGING ONLY — the channels store + seeded QueryClient a staged window body reads. */
export function StagingChannelWindowsProvider({ children }: { children: ReactNode }) {
  const [qc] = useState(() => stagingQueryClient(initialRows()));
  const store = useStagingChannels((id) => seedChannel(qc, id));
  return (
    <QueryClientProvider client={qc}>
      <WindowStoreContext.Provider value={store}>{children}</WindowStoreContext.Provider>
    </QueryClientProvider>
  );
}

/** `@/features/channels/components/use-desktop-sessions › useDesktopSessions` — this machine's own
 *  agents across every staged channel (the launch dialog's new agents land here too). */
export function useDesktopSessions() {
  const store = useWindowStore();
  const sessions = useMemo(
    () => store.rows.flatMap((r) => (r.kind === "channel" ? r.sessions : [])),
    [store.rows]
  );
  return { sessions, refresh: () => {} };
}

/** `@/features/channels/components/agents-controls › canLaunchAgents / openAgentWindow`. */
export function canLaunchAgents(): boolean {
  return true;
}
export async function openAgentWindow(
  route: { channelId: string; threadId: string; agentId?: string },
  _segment: string
) {
  toast({ title: `Staging: would open the agent in ${route.channelId}` });
}

/** `@/shared/lib/spa-bridge-window › canHostAgentTabs / closeOwnTab / onAgentWindowTabs`. */
export function canHostAgentTabs(): boolean {
  return true;
}
export async function closeOwnTab(_key: string): Promise<void> {
  toast({ title: "Staging: would close this tab" });
}
export function onAgentWindowTabs(
  _listener: (payload: { tabs: readonly AgentWindowTab[]; focusKey?: string }) => void
): () => void {
  return () => {};
}
export type { AgentWindowTab };

/**
 * `@/features/channels/components/thread-window › ChannelsThreadWindow` — the /channels staging
 * record pane, held on one thread (`?thread=`), Info closed. Posting, the agent view and the
 * thread's cards all work as on /channels. The crumb's "back to channel" is a no-op here: a
 * pop-out IS one exchange.
 */
export function ChannelsThreadWindow({
  threadId,
}: {
  workspaceId: string;
  channelId: string;
  threadId: string | null;
  currentUserId: string;
}) {
  const store = useWindowStore();
  const fixture = store.fixture;
  const thread = fixture?.threads.find((t) => t.id === threadId) ?? null;
  if (!fixture || !thread) {
    return (
      <div className="page-float flex flex-col antialiased">
        <EmptyState
          icon={MessageSquareOff}
          title="That thread isn't here"
          description="It may have been deleted, or it is older than this channel's loaded history. Open the channel in the main window to find it."
        />
      </div>
    );
  }
  return (
    // `.lp-demo-record` is the scene's record-pane box (`marketing.css`); the window drops its
    // card chrome.
    <div className="lp-demo-record antialiased" style={WINDOW_RECORD} data-frame-skin>
      <StagingChannelScene
        fixture={fixture}
        thread={thread}
        openAgentKey={store.openAgentKey}
        infoOpen={false}
        scrollTarget={store.scrollTarget}
        actions={{ ...store.actions, exitThread: () => {}, openThread: () => {} }}
        agentsVersion={store.agentsVersion}
      />
    </div>
  );
}

const WINDOW_RECORD = { margin: 0, border: 0, borderRadius: 0 } as const;

/**
 * `@/features/channels/components/agent-window › ChannelsAgentWindow` — /channels staging's agent
 * view for the active tab's session, filling the window (no slide, no header: the window's chrome
 * names the agent). Its 1:1 composer sends in memory with the canned reply.
 */
export function ChannelsAgentWindow({
  channelId,
  threadId,
  agentId,
}: {
  workspaceId: string;
  channelId: string;
  threadId: string;
  agentId: string | null;
  currentUserId: string;
}) {
  const store = useWindowStore();
  const fixture = store.rows.find(
    (r) => r.kind === "channel" && r.channel.id === channelId
  );
  const channel = fixture?.kind === "channel" ? fixture : null;
  const agent =
    channel?.sessions.find(
      (s) => s.threadId === threadId && (!agentId || s.agentId === agentId)
    ) ?? null;
  const roster = useMemo(
    () => (channel ? indexMembers(channel.members, CURRENT_USER_ID, stagingAgentIndex()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- agentsVersion re-reads the registry
    [channel?.members, store.agentsVersion]
  );
  if (!channel || !agent || !roster) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-caption text-text-muted">That agent isn&apos;t running here.</p>
      </div>
    );
  }
  return (
    <DemoAgentView
      layout="fill"
      open
      agent={agent}
      ownerPhoto={stagingOwnerPhoto(agent.agentId)}
      entries={channel.narration[agent.agentId ?? ""] ?? []}
      messages={channel.messages}
      currentUserId={CURRENT_USER_ID}
      viewer={VIEWER}
      roster={roster}
      color={roster.agents.get(agent.agentId ?? "")?.color ?? null}
      onClose={() => {}}
      onSend={(text) => store.actions.sendDm(agent.agentId ?? "", text)}
    />
  );
}

/** Empty on purpose, as in `agent-window-launch.tsx › NO_ROSTER`. */
const NO_ROSTER: ReadonlyArray<{ userId: string; displayName: string | null; email: string | null }> = [];

/**
 * `@/features/channels/components/agent-window-launch › AgentWindowLaunch` — the "+"'s New agent
 * form: the product's `LaunchAgentDialog` on the /channels staging store's launch controls
 * (`useStagingChannels › launch`, which /channels' composer hands the same dialog). Launch adds
 * the agent to the window's channel, so the rail lists it.
 */
export function AgentWindowLaunch({
  panel,
  threadId,
  sessions,
}: {
  panel: AgentLaunchPanel;
  workspaceId: string;
  currentUserId: string;
  channelId: string;
  threadId: string;
  sessions?: readonly DesktopSessionSummary[] | null;
  agent: DesktopSessionSummary | null;
}) {
  const store = useWindowStore();
  const fixture = store.fixture;
  const channelId = fixture?.channel.id ?? "";
  const liveSessions = useMemo(
    () =>
      (sessions ?? [])
        .filter((s) => s.channelId === channelId)
        .map((s) => ({
          state: s.state,
          color: agentColorOrNull(s.color),
          name: s.name,
          displayName: s.displayName ?? null,
        })),
    [sessions, channelId]
  );
  if (!fixture) return null;
  return (
    <LaunchAgentDialog
      panel={panel}
      newAgent={store.actions.launch}
      liveSessions={liveSessions}
      openThreadId={threadId || null}
      channelId={channelId}
      workspaceId={fixture.channel.workspaceId}
      currentUserId={CURRENT_USER_ID}
      members={NO_ROSTER}
    />
  );
}
