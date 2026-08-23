"use client";

/**
 * Channels v2 — RIGHT COLUMN: the channel's tabs. Info (`info-tab.tsx`),
 * Threads (`threads-tab.tsx`), Agents (`agents-tab.tsx`) and Settings, which is
 * the pane header's evicted action cluster (`channel-manage.tsx` →
 * `settings-tab.tsx`, injected as a slot for the same reason the panes take
 * theirs: it is write-bearing and this file owns the tab row only).
 *
 * ⚠ THE FOURTH TAB WAS **LINKS** UNTIL 2026-08-19, and it was a deliberate empty
 * state ("No links in this channel yet.") — Files had left the row on 2026-08-18
 * because where a channel's files land is still an OPEN QUESTION (wiring plan,
 * Risk 10) and an empty tab was answering it with "here". The same argument
 * retires Links: it renders nothing and reserves the answer. **Nothing was
 * rehomed out of it** — there was nothing in it.
 *
 * ⚠ THE COLUMN IS THREAD-SCOPED WHILE A THREAD IS OPEN (Samuel, 2026-08-21).
 * THREE things change and nothing else does: THREADS leaves the row (`tabsFor` —
 * it is the one control here that navigates away from what the reader is looking
 * at), INFO renders the THREAD's facts instead of the channel's
 * (`thread-info-tab.tsx`), and SETTINGS becomes the THREAD's — mode and delete
 * (`thread-settings-tab.tsx`). Channel view is untouched, `info-tab.tsx` and
 * `settings-tab.tsx` are untouched, and Agents already narrowed itself to the open
 * thread on 2026-08-20.
 *   ⚠ THIS FILE MAKES ONLY THE FIRST TWO OF THOSE CHOICES. The Settings body
 *   arrives as a SLOT and the branch behind it lives at the page's mount boundary
 *   (`settings-slot.tsx`), because both manage surfaces open reads on mount and
 *   the wrong one must not mount at all.
 *
 * Local state: the active tab, and nothing else. The center pane's open thread,
 * the open AGENT and the mentions read-state are all lifted to
 * `channels-v2-core.tsx`, since this column SETS them and other surfaces read
 * them back.
 */

import { useState, type ReactNode } from "react";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { InfoTab } from "./info-tab";
import { ThreadInfoTab } from "./thread-info-tab";
import { ThreadsTab } from "./threads-tab";
import { AgentsTab } from "./agents-tab";
import { activeAgentCount } from "./agents-model";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";
import type { AgentLaunchOutcome } from "./use-agents-panel";
import type { TemplateLaunchOverrides } from "@/features/agent-templates/lib/launch-overrides";
import type { AuthorIndex } from "./view-model";
import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelThread,
} from "../../types";

const TABS = [
  { key: "info", label: "Info" },
  { key: "threads", label: "Threads" },
  { key: "agents", label: "Agents" },
  { key: "settings", label: "Settings" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * THE ROW IS SHORTER IN THREAD VIEW (Samuel, 2026-08-21).
 *
 * ⚠ THREADS IS A CHANNEL-VIEW TAB. With a thread open this whole column is about
 * that ONE exchange — the Info tab becomes thread-scoped and the Agents tab
 * already narrows to it — so a list of the channel's OTHER threads is the one
 * control here that navigates away from what the reader is looking at. It comes
 * back the moment the centre pane returns to the channel; the sidebar's tree
 * covers thread-to-thread movement meanwhile.
 */
function tabsFor(threadView: boolean): ReadonlyArray<(typeof TABS)[number]> {
  return threadView ? TABS.filter((t) => t.key !== "threads") : TABS;
}

/**
 * THE TAB-ROW BADGES (2026-08-20). `SegmentedControl` has carried an optional
 * `count` since the knowledge home's scope pills
 * (`knowledge-v2/home/knowledge-home.tsx` over `use-knowledge-v2-controller.ts ›
 * filterCounts`); this row simply had none. Nothing new is rendered — the same
 * primitive, the same two faces.
 *
 * ⚠ `undefined` IS THE "CANNOT SAY" ANSWER AND IT IS LOAD-BEARING.
 * `SegmentedControl` draws no badge for `undefined`, which is exactly what
 * `agentSessions === null` needs: "could not ask" (a plain browser, or a main
 * without the feed) must NOT render as a confident `0`. UNKNOWN is not EMPTY
 * (INVARIANTS §11), and a `0` on this tab is a claim about the operator's own
 * machine that the web cannot make.
 *
 * ⚠ INFO AND SETTINGS GET NO BADGE, deliberately. The Info tab already carries
 * the mentions unread count INSIDE it (`info-tab.tsx`, arithmetic over the rows
 * it displays); a second number on its tab would leave the reader guessing which
 * of the two it is.
 *
 * ⚠ THREADS COUNTS THE LOADED LIST. The read is bounded and `threadsTruncated`
 * says so in the tab body — the same rule the mentions badge follows (count what
 * is displayed, and say when the display clipped), rather than a second, wider
 * count nothing renders.
 */
function tabCount(
  key: TabKey,
  threads: readonly unknown[],
  agentCount: number | undefined
): number | undefined {
  if (key === "threads") return threads.length;
  if (key === "agents") return agentCount;
  return undefined;
}

export function ChannelsV2InfoPanel({
  channel,
  channelName,
  members,
  threads,
  threadsTruncated,
  threadsLoading,
  index,
  openThread,
  onOpenThread,
  agentSessions,
  peerSessions = [],
  canLaunchAgent = false,
  launchBusy = false,
  launchError = null,
  onLaunchAgent,
  onApproveTemplate,
  openAgent,
  onOpenAgent,
  mentions,
  mentionsTruncated,
  mentionsLoading,
  onOpenMention,
  onMarkAllMentionsRead,
  infoTab,
  settings,
}: {
  channel: Channel;
  channelName: string;
  members: ChannelMember[];
  /** THE WHOLE bounded list, in the server's activity order — the Threads tab
   *  lists everything, unlike the sidebar's 24h window. */
  threads: ChannelThread[];
  threadsTruncated: boolean;
  threadsLoading: boolean;
  index: AuthorIndex;
  /**
   * THE OPEN THREAD ITSELF, not its id (2026-08-21). The whole row is
   * thread-scoped while one is open — the Info tab renders the THREAD's facts
   * and the Threads tab leaves — so this column needs the row, and asking the
   * caller for both the id and the object is how the two come to disagree.
   * `null` is channel view.
   */
  openThread: ChannelThread | null;
  onOpenThread: (id: string) => void;
  /** THIS MACHINE'S live session feed, or `null` for "could not ask" (a plain
   *  browser, or a main without it). ⚠ Passed through, never collapsed to `[]`:
   *  the Agents tab words the two cases differently. */
  agentSessions: readonly DesktopSessionSummary[] | null;
  /** EVERY member's session STATE (server projection) — the peer cards. */
  peerSessions?: readonly ChannelPeerSession[];
  canLaunchAgent?: boolean;
  launchBusy?: boolean;
  /** The last launch refusal's copy, or null. Passed through — the tab owns
   *  where it sits. */
  launchError?: string | null;
  /** ⚠ WIDENED FOR THE TEMPLATE PICKER (2026-08-22), and the one-argument call
   *  is still what the New Agent button makes. Passed straight through — this
   *  panel decides nothing about launches. */
  onLaunchAgent?: (
    threadId: string,
    templateId?: string | null,
    overrides?: TemplateLaunchOverrides
  ) => Promise<AgentLaunchOutcome> | void;
  /** Machine-local first-use approval for a foreign template. Passed through. */
  onApproveTemplate?: (templateId: string) => Promise<{ ok: boolean; reason?: string }>;
  /** `agentsModel › agentKey` of the agent whose view is open — read only to
   *  mark its card "Viewing". The panel itself renders at page level, over this
   *  column. */
  openAgent: string | null;
  onOpenAgent: (key: string) => void;
  /** MY mentions in this channel — the Tags inbox's rows, each carrying its own
   *  `read` flag. ⚠ The unread BADGE is arithmetic over this list inside
   *  `InfoTab`, never a second count from anywhere. */
  mentions: ChannelMention[];
  mentionsTruncated: boolean;
  mentionsLoading: boolean;
  onOpenMention: (mention: ChannelMention) => void;
  onMarkAllMentionsRead: () => void;
  /**
   * REPLACES the INFO tab's body in channel view — an account-level 1:1 shows a
   * person card where a workspace channel shows `info-tab.tsx`. Absent is the
   * channels page's own body, which is every caller but Home.
   * ⚠ THREAD VIEW IGNORES IT. The column is already thread-scoped while a thread
   * is open (the ruling above), so Info renders the THREAD's facts and a card
   * about the counterparty would answer a question the reader did not ask.
   */
  infoTab?: ReactNode;
  /**
   * The SETTINGS tab's body — `settings-slot.tsx › ChannelsV2SettingsSlot`, which
   * is `channel-manage.tsx › ChannelsV2ManageActions` in channel view and
   * `thread-manage.tsx › ChannelsV2ThreadManageActions` in thread view (Samuel,
   * 2026-08-21). Injected rather than imported because it is write-bearing and
   * this file owns the tab row.
   * ⚠ Mounted only while the tab is open, which is deliberate: the channel host's
   * three write hooks, its `/api/channels/trust` read and its four dialogs have no
   * business being live behind the Info tab (INVARIANTS §5 pins it).
   * ⚠ THE CHANNEL-VS-THREAD CHOICE IS THE SLOT'S, NOT THIS FILE'S, and for the
   * same reason: whichever host is wrong for the current scope must not mount, and
   * a branch inside either one would run its hooks regardless.
   */
  settings?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("info");
  const openThreadId = openThread?.id ?? null;
  const threadView = openThread !== null;
  const options = tabsFor(threadView);

  // ⚠ THE DEAD-SELECTION FALLBACK. Opening a thread while the Threads tab is
  // showing removes the very tab that is selected, and a `value` matching no
  // option leaves `SegmentedControl` with nothing lit over an empty body. INFO
  // is where it lands — the tab that just became thread-scoped, so the reader's
  // click is answered with the thread they opened rather than with blankness.
  //
  // ⚠ SET DURING RENDER, not in an effect: this is React's sanctioned
  // derive-state-from-props adjustment (the render restarts before committing),
  // and the same idiom `agent-panel.tsx` uses for its exit frame. An effect would
  // paint the broken frame first. `activeTab` covers that restart so the body and
  // the row can never disagree even for one pass.
  if (threadView && tab === "threads") setTab("info");
  const activeTab: TabKey = threadView && tab === "threads" ? "info" : tab;

  // ⚠ THE BADGE RUNS ONE EXPORTED DERIVATION (`agents-model.ts ›
  // activeAgentCount`), never a sum written here: two derivations of one list is
  // F-142's defect, and here it would show as a number that disagrees with the
  // rows under it. It counts ACTIVE agents under the shared `isAgentActive`
  // rule — an ended agent of MINE still renders as a stopped card in the list,
  // and is deliberately not in this number.
  // ⚠ `null` sessions => `undefined`, never `0` — see `tabCount`.
  const agentCount =
    agentSessions === null
      ? undefined
      : activeAgentCount(
          agentSessions,
          peerSessions,
          channel.id,
          index.currentUserId,
          openThreadId
        );

  return (
    <aside
      aria-label="Channel info"
      className="flex w-[340px] shrink-0 flex-col border-l border-border-default"
    >
      <div className="flex h-[56px] shrink-0 items-center border-b border-border-default px-3">
        <SegmentedControl
          options={options.map((t) => ({
            ...t,
            count: tabCount(t.key, threads, agentCount),
          }))}
          value={activeTab}
          onChange={setTab}
        />
      </div>

      {activeTab === "info" ? (
        openThread ? (
          <ThreadInfoTab
            thread={openThread}
            members={members}
            currentUserId={index.currentUserId}
            agentSessions={agentSessions}
            peerSessions={peerSessions}
          />
        ) : infoTab !== undefined ? (
          infoTab
        ) : (
          <InfoTab
            channel={channel}
            channelName={channelName}
            members={members}
            threadCount={threads.length}
            mentions={mentions}
            mentionsTruncated={mentionsTruncated}
            mentionsLoading={mentionsLoading}
            index={index}
            onOpenMention={onOpenMention}
            onMarkAllMentionsRead={onMarkAllMentionsRead}
          />
        )
      ) : activeTab === "threads" ? (
        <ThreadsTab
          threads={threads}
          truncated={threadsTruncated}
          loading={threadsLoading}
          index={index}
          openThreadId={openThreadId}
          onOpenThread={onOpenThread}
        />
      ) : activeTab === "agents" ? (
        <AgentsTab
          sessions={agentSessions}
          channelId={channel.id}
          // The template picker's one input — off the channel this panel is
          // already rendering, so no new prop reaches this component for it.
          workspaceId={channel.workspaceId}
          openThreadId={openThreadId}
          members={members}
          currentUserId={index.currentUserId}
          peers={peerSessions}
          canLaunch={canLaunchAgent}
          launchBusy={launchBusy}
          launchError={launchError}
          onLaunchAgent={onLaunchAgent}
          onApproveTemplate={onApproveTemplate}
          openAgent={openAgent}
          onOpenAgent={onOpenAgent}
        />
      ) : (
        settings
      )}
    </aside>
  );
}
