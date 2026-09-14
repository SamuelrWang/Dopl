"use client";

/**
 * Channels — RIGHT COLUMN: the channel's tabs. Info (`info-tab.tsx`), Threads
 * (`threads-tab.tsx`), Agents (`agents-tab.tsx`), the opt-in Knowledge
 * (`knowledge-tab.tsx`) and Settings — the pane header's evicted action cluster
 * (`channel-manage.tsx` → `settings-tab.tsx`), injected as a slot because it is
 * write-bearing and this file owns the tab row only.
 *
 * ⚠ THE FOURTH TAB WAS **LINKS** UNTIL 2026-08-19 and is retired, as Files was on
 * 2026-08-18: where a channel's files land is still an OPEN QUESTION (wiring
 * plan, Risk 10) and an empty tab answered it with "here". Nothing was rehomed.
 *
 * ⚠ THE COLUMN IS THREAD-SCOPED WHILE A THREAD IS OPEN (Samuel, 2026-08-21).
 * THREE things change and nothing else: THREADS leaves the row
 * (`channelPaneTabs`), INFO renders the THREAD's facts (`thread-info-tab.tsx`),
 * SETTINGS becomes the THREAD's (`thread-settings-tab.tsx`).
 *   ⚠ THIS FILE MAKES ONLY THE FIRST TWO. The Settings body arrives as a SLOT and
 *   the branch behind it lives at the page's mount boundary (`settings-slot.tsx`),
 *   because both manage surfaces open reads on mount and the wrong one must not
 *   mount at all.
 *
 * Local state: the active tab, and nothing else — the open thread, the open AGENT
 * and the mentions read-state are lifted to `channels-core.tsx`.
 */

import { useState, type ReactNode } from "react";
import { cn } from "@/shared/lib/utils";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { Crossfade } from "@/shared/ui/crossfade";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { InfoTab } from "./info-tab";
import { ThreadInfoTab } from "./thread-info-tab";
import { ThreadsTab } from "./threads-tab";
import { AgentsTab } from "./agents-tab";
import { ChannelKnowledgeTab } from "./knowledge-tab";
import { activeAgentCount } from "./agents-model";
import type { ChannelPeerSession } from "../hooks/use-channel-agent-sessions";
import type { AgentLaunchOutcome } from "./use-agents-panel";
import type { TemplateLaunchOverrides } from "@/features/agent-templates/lib/launch-overrides";
import type { AuthorIndex } from "./view-model";
import type {
  Channel,
  ChannelMember,
  ChannelMention,
  ChannelThread,
} from "../types";

const TABS = [
  { key: "info", label: "Info" },
  { key: "threads", label: "Threads" },
  { key: "agents", label: "Agents" },
  { key: "knowledge", label: "Knowledge" },
  { key: "settings", label: "Settings" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/**
 * THE ROW IS SHORTER IN THREAD VIEW (Samuel, 2026-08-21).
 *
 * ⚠ THREADS IS A CHANNEL-VIEW TAB: with a thread open, a list of the channel's
 * OTHER threads is the one control here that navigates away from what the reader
 * is looking at. The sidebar's tree covers thread-to-thread movement meanwhile.
 *
 * ⚠ KNOWLEDGE IS OPT-IN AND IS THE ROW'S ONLY CAPABILITY-GATED TAB (Home
 * Knowledge Panels M4) — ABSENT by default, inverting this file's usual "the
 * default is the workspace page's behaviour" rule; see
 * {@link ChannelSurfaceCapabilities.knowledge}. ⚠ THREAD VIEW KEEPS IT: a base is
 * granted onto the CHANNEL, so it is as true inside one exchange as outside it.
 */
export function channelPaneTabs(
  threadView: boolean,
  knowledge: boolean
): ReadonlyArray<(typeof TABS)[number]> {
  return TABS.filter(
    (t) =>
      (t.key !== "threads" || !threadView) && (t.key !== "knowledge" || knowledge)
  );
}

/**
 * THE TAB-ROW BADGES (2026-08-20), on `SegmentedControl`'s existing optional
 * `count`.
 *
 * ⚠ `undefined` IS THE "CANNOT SAY" ANSWER AND IT IS LOAD-BEARING: no badge is
 * drawn for it, which is what `agentSessions === null` needs — "could not ask"
 * must NOT render as a confident `0` (INVARIANTS §11, UNKNOWN is not EMPTY).
 *
 * ⚠ KNOWLEDGE GETS NO BADGE EITHER: its list is read by the TAB BODY only while
 * the tab is open, and a row count would mount that read for every viewer of every
 * channel. ⚠ INFO AND SETTINGS GET NONE: Info already carries the mentions unread
 * count INSIDE it (`info-tab.tsx`), and two numbers leave the reader guessing.
 *
 * ⚠ THREADS COUNTS THE LOADED LIST — count what is displayed and say when the
 * display clipped (`threadsTruncated`), never a wider count nothing renders.
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

export function ChannelsInfoPanel({
  channel,
  channelName,
  activityBins = [],
  activityLoading = false,
  members,
  threads,
  threadsTruncated,
  threadsLoading,
  index,
  openThread,
  onOpenThread,
  onNewThread,
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
  knowledge = false,
  fullTab,
  infoTab,
  settings,
}: {
  channel: Channel;
  channelName: string;
  /** REAL messages-per-day, mounted by the HOST (`channel-surface-data.ts`) and
   *  passed through — this column fetches nothing. ⚠ DEFAULTS TO EMPTY so a host
   *  with no workspace segment renders no strip; an empty series is NOT a run of
   *  measured zeroes. */
  activityBins?: readonly { date: string; count: number }[];
  activityLoading?: boolean;
  members: ChannelMember[];
  /** THE WHOLE bounded list, in the server's activity order — the Threads tab
   *  lists everything, unlike the sidebar's 24h window. */
  threads: ChannelThread[];
  threadsTruncated: boolean;
  threadsLoading: boolean;
  index: AuthorIndex;
  /** THE OPEN THREAD ITSELF, not its id (2026-08-21): the whole row is
   *  thread-scoped while one is open, and asking the caller for both the id and
   *  the object is how the two come to disagree. `null` is channel view. */
  openThread: ChannelThread | null;
  onOpenThread: (id: string) => void;
  /** Threads tab's "New thread" — nonces the composer's `newThreadSignal`, which
   *  since 2026-09-08 opens `new-thread-dialog.tsx › NewThreadDialog`.
   *  ⚠ Optional: a host with no composer to reach draws no button. */
  onNewThread?: () => void;
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
    // ⚠ `null` = a CHANNEL-LEVEL launch (2026-08-31) — see `agents-tab.tsx`.
    threadId: string | null,
    templateId?: string | null,
    overrides?: TemplateLaunchOverrides,
    /** ⚠ WIDENED WITH THE TAB'S OWN PROP (2026-09-08): the launch POPUP carries a
     *  pre-assigned instance id and a per-spawn runtime. A narrower type here would
     *  have COMPILED (a 3-arg function is assignable to a 5-arg signature) while
     *  silently dropping two arguments. */
    agentId?: string,
    runtime?: string
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
  /** Draw the KNOWLEDGE tab (`ChannelSurfaceCapabilities.knowledge`). Default
   *  `false` — {@link channelPaneTabs} says why this one capability defaults
   *  CLOSED. ⚠ Its reads mount with the tab, so `false` requests nothing at all. */
  knowledge?: boolean;
  /**
   * SINGLE-COLUMN MODE (Samuel, 2026-09-04 — the WEB channel page). Render ONE
   * tab's body as the main area, full width, with NO tab row: the header's
   * dropdown is the switcher (`channel-single-column.tsx`).
   *
   * ⚠ THE BODY IS THE SAME BODY — a layout answer, not a second surface. A fork
   * here is how the phone and the desktop disagree about what Info says.
   *
   * ⚠ ABSENT IS THE COLUMN — the two-pane surface every desktop mount renders.
   */
  fullTab?: TabKey;
  /**
   * REPLACES the INFO tab's body in channel view — an account-level 1:1 shows a
   * person card where a workspace channel shows `info-tab.tsx`. Absent is the
   * channels page's own body (every caller but Home). ⚠ THREAD VIEW IGNORES IT:
   * the column is already thread-scoped, so a card about the counterparty would
   * answer a question the reader did not ask.
   */
  infoTab?: ReactNode;
  /**
   * The SETTINGS tab's body — `settings-slot.tsx › ChannelsSettingsSlot`
   * (`channel-manage.tsx › ChannelsManageActions` in channel view,
   * `thread-manage.tsx › ChannelsThreadManageActions` in thread view; Samuel,
   * 2026-08-21), injected because it is write-bearing.
   * ⚠ Mounted only while the tab is open: the channel host's write hooks, its
   * `/api/channels/trust` read and its dialogs have no business being live behind
   * the Info tab (INVARIANTS §5 pins it). ⚠ THE CHANNEL-VS-THREAD CHOICE IS THE
   * SLOT'S, for the same reason — a branch inside either host runs its hooks anyway.
   */
  settings?: ReactNode;
}) {
  const [tab, setTab] = useState<TabKey>("info");
  const openThreadId = openThread?.id ?? null;
  const threadView = openThread !== null;
  const options = channelPaneTabs(threadView, knowledge);

  // ⚠ THE DEAD-SELECTION FALLBACK. Opening a thread removes the very tab that is
  // selected, and a `value` matching no option leaves `SegmentedControl` with
  // nothing lit over an empty body. INFO is where it lands.
  // ⚠ SET DURING RENDER, not in an effect: React's sanctioned
  // derive-state-from-props adjustment, the same idiom `agent-panel.tsx` uses. An
  // effect would paint the broken frame first; `activeTab` covers the restart.
  // ⚠ IT ASKS THE ROW, NOT THE CONDITIONS — re-listing which tabs can leave is how
  // the row and the fallback come to disagree about which tabs exist.
  const dead = !options.some((t) => t.key === tab);
  if (dead) setTab("info");
  const activeTab: TabKey = dead ? "info" : tab;

  // ⚠ THE BADGE RUNS ONE EXPORTED DERIVATION (`agents-model.ts ›
  // activeAgentCount`), never a sum written here — two derivations of one list is
  // F-142's defect. It counts ACTIVE agents under the shared `isAgentActive` rule,
  // so an ended agent of MINE renders as a stopped card but is not in the number.
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

  /** THE TAB BODIES — one definition, rendered by both layouts below. */
  // ⚠ `string`, not `TabKey` — `Crossfade` hands back the token ON SCREEN and
  // types it as the plain string it stores; every branch below is a comparison.
  const body = (shown: string) =>
          shown === "info" ? (
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
                activityBins={activityBins}
                activityLoading={activityLoading}
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
          ) : shown === "threads" ? (
            <ThreadsTab
              threads={threads}
              truncated={threadsTruncated}
              loading={threadsLoading}
              index={index}
              openThreadId={openThreadId}
              onOpenThread={onOpenThread}
              onNewThread={onNewThread}
            />
          ) : shown === "agents" ? (
            <AgentsTab
              sessions={agentSessions}
              channelId={channel.id}
              // The template picker's one input — off the channel this panel is
              // already rendering, so no new prop is needed for it.
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
              onNewThread={onNewThread}
            />
          ) : shown === "knowledge" ? (
            // ⚠ MOUNTED WITH THE TAB, so the lane is not read for a viewer who
            // never opens it — the Settings slot's rule (INVARIANTS §5).
            <ChannelKnowledgeTab
              channelId={channel.id}
              workspaceId={channel.workspaceId}
            />
          ) : (
            settings
          );

  /* ⚠ SINGLE COLUMN — THE WEB CHANNEL PAGE (Samuel, 2026-09-04). One face, full
     width, no tab row: the header's dropdown is the switcher, and a second one
     under it would be two controls for one choice. */
  if (fullTab) {
    return (
      <section
        aria-label="Channel info"
        className="flex min-w-0 flex-1 flex-col"
      >
        <Crossfade token={fullTab} className="flex min-h-0 flex-1 flex-col">
          {body}
        </Crossfade>
      </section>
    );
  }

  return (
    <aside
      aria-label="Channel info"
      // ⚠ `--info-w` IS THE DRAGGABLE WIDTH (2026-09-13, `use-info-resize.ts`), and the
      // 380px FALLBACK is what this class said literally until then — so the column is
      // correct before the handle has written anything, and on any host that never
      // mounts one. `shrink-0` stays: the shell animates 0 → this width and a
      // shrinkable panel would reflow its contents through every frame of the slide.
      className="flex w-[var(--info-w,380px)] shrink-0 flex-col border-l border-border-default"
    >
      {/* ⚠ A FIFTH TAB IS OVER THE ROW'S WIDTH BUDGET, AND THE BUDGET IS A
          MEASUREMENT, NOT A TASTE (Home Knowledge Panels M4): at 380px the four
          options with two badges leave roughly 55px spare and "Knowledge" wants
          ~90 (docs/DESIGN-SYSTEM.md, 2026-08-25). Two answers, neither touching the
          shared primitive — the row TIGHTENS (`gap-1`, header `px-2`) only while
          the fifth tab is present, and whatever remains SCROLLS rather than clips.
          ⚠ RULED 2026-08-27 (F-340, Samuel): the DESKTOP host stopped passing the
          capability, so /home is back to FOUR tabs; it **still engages on the GUEST
          lane**. ⚠ AND DO NOT "FIX" THE GUEST ROW BY SHORTENING THE LABEL:
          "Knowledge" is what the product calls the thing everywhere else. */}
      <div
        className={cn(
          "flex h-[56px] shrink-0 items-center",
          options.length > 4 ? "px-2" : "px-3"
        )}
      >
        <SegmentedControl
          options={options.map((t) => ({
            ...t,
            count: tabCount(t.key, threads, agentCount),
          }))}
          value={activeTab}
          onChange={setTab}
          // ⚠ THE 36px CONTROL SCALE (Samuel, 2026-08-25) — the page header's button
          // height, so a switcher does not read as a smaller class of control.
          size="lg"
          variant="underline"
          // Layout only, which is all `className` may carry here (the primitive's
          // own contract). See the width-budget note above.
          className={cn(
            "min-w-0 flex-1 overflow-x-auto",
            options.length > 4 && "gap-1"
          )}
        />
      </div>

      {/* THE TAB BODY SWAPS, THE TABS DO NOT MOVE (Samuel, 2026-08-24) — the same
          gesture as /home's record pane, so the same primitive.
          ⚠ RENDERED FROM `shown`, NOT `activeTab`: `Crossfade` hands back the tab
          still on screen for one fade, and reading `activeTab` would swap the
          content out from under it. Only a tab change is a swap. */}
      <Crossfade token={activeTab} className="flex min-h-0 flex-1 flex-col">
        {body}
      </Crossfade>
    </aside>
  );
}
