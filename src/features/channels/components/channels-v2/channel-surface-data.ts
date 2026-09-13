"use client";

/**
 * ONE CHANNEL'S LIVE STATE — every read the per-channel surface renders, the ONE
 * refetch coordinator those reads and its writes register through, and the pure
 * derivations over them.
 *
 * ⚠ IT OWNS `useChannelsV2Live` SO THAT A MOUNT CANNOT FORGET IT. INVARIANTS §7:
 * a live surface that skips the refetch coordinator fails with NO ERROR SHAPE —
 * the transcript simply stops updating — and that has already shipped once
 * (`agent-window.tsx`, 2026-08-20). Both hosts take THIS hook and therefore one
 * coordinator each: `channels-v2-core.tsx` folds its channel-LIST invalidation in
 * through `onDoorbell` (the list is the TREE's read), `channel-surface-
 * standalone.tsx` folds in nothing.
 *
 * ⚠ THE HOOK ORDER IS LOAD-BEARING (lifted verbatim out of `channels-v2-core.tsx`,
 * 2026-08-23): `useAgentsPanel` must precede the live wiring that names its
 * `refetch`, and both write hooks must follow the `gate` they settle into.
 *
 * ⚠ IT TAKES A `channel` THAT MAY BE `null`, because the workspace page mounts it
 * above its own channel branch: the first-run explainer renders with no channel
 * open, and the coordinator has to stay registered through it or the tree stops
 * hearing the doorbell. (The Inbox takeover was the other such state and is
 * deleted — 2026-08-25, Samuel; INVARIANTS §6.)
 */

import { CONSENT_INBOX_POLL_MS } from "../../constants";
import { useCallback, useMemo } from "react";
import { liveAgentsFromKey, liveAgentsKey } from "../../lib/live-agents";
import { useChannelMessages } from "../../hooks/use-channel-messages";
import { useChannelMembers } from "../../hooks/use-channel-members";
import { useChannelThreads } from "../../hooks/use-channel-threads";
import { useChannelMentions } from "../../hooks/use-channel-mentions";
import { useMentionWrites } from "../../hooks/use-mention-writes";
import { useEscalationWrites } from "../../hooks/use-escalation-writes";
import { useChannelPreferenceWrites } from "../../hooks/use-channel-preference-writes";
import { useConsentInbox } from "../../hooks/use-consent-inbox";
import { useChannelsV2Live } from "./live";
import { useDesktopSessions } from "./use-desktop-sessions";
import { useAgentsPanel } from "./use-agents-panel";
import { useChannelsV2Derivations } from "./derivations";
import { escalationOf, viewerPerson } from "./view-model";
import { newClientMsgId } from "../../lib/optimistic-cache";
import { useInlineConsent } from "./use-inline-consent";
// ⚠ **THE ONE CROSS-FEATURE READ ON THIS SURFACE, AND IT IS MOUNTED HERE ON
// PURPOSE (F-316, 2026-09-05).** §7's rule is that the HOST fetches and the panes
// render, so the series is read here and travels down as the STRUCTURAL
// `ActivityBin[]` — which keeps §9 intact: `thread-activity.tsx` still imports
// nothing from `features/workspaces`. The alternative was a channels-side copy of
// this fetcher, i.e. the second client the route already warns about.
import { useOverviewSeries } from "@/features/workspaces/hooks/use-overview-series";
import type { ActivityBin } from "./thread-activity";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { LiveAgentSession } from "../../lib/draft-recipients";
import type { ChannelsV2Derivations } from "./derivations";
import type { ChannelSurfaceCapabilities } from "./channel-surface";
import type {
  Channel,
  ChannelConsentRequest,
  ChannelMember,
  ChannelMention,
  ChannelMessage,
  ChannelThread,
} from "../../types";

export interface ChannelSurfaceData extends ChannelsV2Derivations {
  messages: ChannelMessage[];
  messagesLoading: boolean;
  /**
   * THE RENDERED TRANSCRIPT IS STILL THE PREVIOUS CHANNEL'S — `use-channel-messages.ts ›
   * stale`. ⚠ EXPOSED FOR THE SCROLLER'S RULE 1 (2026-09-08) and read by nothing else:
   * `keepPreviousData` leaves `isPending` false, so `messagesLoading` cannot see this window.
   */
  messagesStale: boolean;
  /** More transcript history exists to fetch — `use-channel-messages.ts`. */
  hasOlderMessages: boolean;
  /** A `before` page is in flight. */
  loadingOlderMessages: boolean;
  /** Ask for the page immediately older than the loaded window. */
  loadOlderMessages: () => void;
  /**
   * DROP one thread's rows from the scroll-back window — the half of the thread
   * DELETE's optimistic patch that lives outside the query cache
   * (`lib/message-window.ts › dropThreadFromWindow`). The host calls it on the
   * delete's own exit callback; nothing else may.
   */
  dropThreadFromHistory: (threadId: string) => void;
  members: ChannelMember[];
  refetchMembers: () => void;
  threads: ChannelThread[];
  threadsTruncated: boolean;
  threadsLoading: boolean;
  mentions: ChannelMention[];
  mentionsTruncated: boolean;
  mentionsLoading: boolean;
  /** The viewer's pending OUTBOUND reviews, workspace-wide — see the note at the
   *  read below for why the scope is not the channel's. */
  requests: ChannelConsentRequest[];
  /** THIS MACHINE's live agents, or `null` for "could not ask". */
  agentSessions: DesktopSessionSummary[] | null;
  refreshAgents: () => void;
  agentsPanel: ReturnType<typeof useAgentsPanel>;
  /**
   * **EVERY AGENT THIS SURFACE CAN @-ADDRESS** — the peer projection UNION this
   * machine's own feed (`lib/live-agents.ts › liveAgentsKey`, which carries the
   * whole argument). ⚠ **DERIVED HERE RATHER THAN AT THE COMPOSER**: the @-picker,
   * the recipient line and the tint must be told the same set, and a second merge
   * beside them is how one of the three comes to answer differently.
   */
  liveAgents: readonly LiveAgentSession[];
  /** THE surface's refetch coordinator — every write on it settles into this. */
  gate: MutationGate;
  markRead: ReturnType<typeof useMentionWrites>["markRead"];
  favorite: ReturnType<typeof useChannelPreferenceWrites>["favorite"];
  consent: ReturnType<typeof useChannelPreferenceWrites>["consent"];
  outboundByThread: ReturnType<typeof useInlineConsent>["outboundByThread"];
  decideOutbound: (id: string, decision: "allow" | "deny") => void;
  consentBusy: boolean;
  /**
   * ANSWER AN ESCALATION CARD — the SIXTH write family on this surface (Samuel,
   * 2026-08-31), on the same `gate` as the other five.
   *
   * ⚠ IT IS AN ORDINARY POST: a question asked in a shared room gets a public
   * answer, so it goes to the same messages route and reaches the asking agent the
   * way every other human message does. The client never names an agent — the
   * server derives which one to wake off the escalation's own stamp.
   */
  answerEscalation: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy: boolean;
  /**
   * THE INFO TAB'S ACTIVITY STRIP — real messages-per-day for THIS channel
   * (F-316 closed, 2026-09-05). Empty until the host supplies a workspace segment,
   * and the strip renders NOTHING for it rather than 31 measured-looking zeroes.
   */
  activityBins: ActivityBin[];
  activityLoading: boolean;
}

export function useChannelSurfaceData({
  workspaceId,
  workspaceSlug,
  channel,
  currentUserId,
  openThreadId,
  capabilities,
  onDoorbell,
}: {
  workspaceId: string;
  /**
   * `{slug}-{publicId}` — the SEGMENT the `[workspaceSlug]` routes address by.
   * ⚠ OPTIONAL, so every existing caller compiles and the surfaces with no segment
   * (the pop-out, the tests) simply do not ask for a series.
   */
  workspaceSlug?: string;
  /** `null` while the host is showing something other than a channel. */
  channel: Channel | null;
  currentUserId: string;
  /** The thread the host asked for; resolved against this channel's list. */
  openThreadId: string | null;
  /**
   * ⚠ THE SAME OBJECT THE SURFACE RENDERS FROM, BECAUSE A CAPABILITY THAT HIDES A
   * CONTROL BUT STILL FETCHES ITS DATA IS HALF A CAPABILITY (2026-08-26). One
   * `capabilities` decides both; see the consent read below for the forcing case.
   */
  capabilities?: ChannelSurfaceCapabilities;
  /**
   * A host read this hook does not own, invalidated on the SAME doorbell.
   * ⚠ The workspace page's channel LIST is the only caller: a second
   * `useRefetchGate` beside this one would be a second coordinator on one
   * surface, which is what INVARIANTS §7/§8 forbid.
   */
  onDoorbell?: () => void;
}): ChannelSurfaceData {
  const {
    messages,
    // THE ARTIFACT ENVELOPE, TOTAL over `messages` and travelling with it or not
    // at all (`lib/message-window.ts › mergeEntries`) — one value, produced here.
    entries: messageEntries,
    loading: messagesLoading,
    stale: messagesStale,
    refetch: refetchMessages,
    hasOlder: hasOlderMessages,
    loadingOlder: loadingOlderMessages,
    loadOlder: loadOlderMessages,
    dropThread: dropThreadFromHistory,
  } = useChannelMessages(channel?.id ?? null, workspaceId);
  const { members, refetch: refetchMembers } = useChannelMembers(
    channel?.id ?? null,
    workspaceId
  );
  const {
    threads,
    truncated: threadsTruncated,
    loading: threadsLoading,
    refetch: refetchThreads,
  } = useChannelThreads(channel?.id ?? null, workspaceId);
  // THE TAGS INBOX — my mentions in this channel, each row carrying my own
  // read-state. ⚠ The unread BADGE is arithmetic over these rows inside
  // `InfoTab`; nothing derives it a second time.
  const {
    mentions,
    truncated: mentionsTruncated,
    loading: mentionsLoading,
    refetch: refetchMentions,
  } = useChannelMentions(channel?.id ?? null, workspaceId);
  // ⚠ Poll BACKSTOP for a downed socket only; pauses while the tab is hidden.
  // ⚠ WORKSPACE-WIDE ON PURPOSE: the Inbox badge counts every pending draft and the
  // same rows place the thread view's send box — one read, two consumers, and a
  // channel-scoped copy would make the badge lie.
  // ⚠ `outbound`, NOT `requests` (Samuel, 2026-08-22 — the inbound consent
  // retirement): no surface here can act on an INBOUND row any more.
  //
  // 🔒 NOT MOUNTED AT ALL WHEN `selfManagement: false` (2026-08-26). That flag means
  // THIS VIEWER runs no agent here (`channel-surface.tsx ›
  // ChannelSurfaceCapabilities`), so an OUTBOUND read can only answer `[]`. On the
  // guest web lane it was a **403 every CONSENT_INBOX_POLL_MS, forever**, plus a
  // subscription that delivers a guest nothing — §7's "a subscription that looks
  // like coverage". `null` disables query AND subscription in one place
  // (`use-consent-inbox.ts`).
  const { outbound: requests } = useConsentInbox(
    (capabilities?.selfManagement ?? true) ? workspaceId : null,
    undefined,
    CONSENT_INBOX_POLL_MS
  );
  // MY OWN AGENTS — the ONE read here that is not a server projection: this
  // machine's live session state over the Electron bridge (`agents-model.ts`),
  // workspace-wide, sliced per consumer. `null` means "could not ask" (plain
  // browser, or an older main) and is carried as null all the way to the tab,
  // which words the two absences differently.
  // ⚠ `refresh` is the REFUSAL path only (`agents-model.ts › DesktopSessionsFeed`)
  // — main answering `{ok:false}` is the one fact no push announces. Not a poll.
  const { sessions: agentSessions, refresh: refreshAgents } =
    useDesktopSessions();

  // The Agents tab's peer projection + launch action — `use-agents-panel.ts`.
  // ⚠ DECLARED ABOVE THE LIVE WIRING because `refetchAll` names its `refetch`.
  const agentsPanel = useAgentsPanel({
    channel,
    workspaceId,
    currentUserId,
    threads,
    refreshDesktopSessions: refreshAgents,
  });

  // Realtime → coalesced refetch, deferred while a local write is in flight; the
  // wiring is `live.ts` and what stays here is WHAT a doorbell invalidates.
  // ⚠ `gate` is handed to every writer on this surface, and `live.ts` hands the SAME
  // coordinator to the subscriptions — one coordinator, both ends (INVARIANTS §7/§8).
  const { gate } = useChannelsV2Live({
    workspaceId,
    refetchAll: () => {
      // ⚠ INVALIDATE THE PREFIX, don't refetch ONE observer: `query.refetch()`
      // revalidates only the mounted key-variant, leaving `include=archived` stale
      // behind a doorbell that fired for it. The list belongs to the TREE, so its
      // invalidation arrives as the host's `onDoorbell`.
      onDoorbell?.();
      void refetchMessages();
      void refetchMembers();
      void refetchThreads();
      // A new message can BE a new mention, and the doorbell that rings for it
      // is `channel_messages` — `channel_mention_reads` is deliberately not in
      // the publication (INVARIANTS §7; migration `20260818140000` states why),
      // so this refetch is the whole delivery path for a mention arriving.
      void refetchMentions();
      // PEER AGENT CARDS (2026-08-20). `channel_sessions` is UNPUBLISHED and stays
      // that way (INVARIANTS §7): its row is rewritten on every projection move, so
      // publishing it would buy WAL decode plus a per-subscriber RLS evaluation on
      // each, for every member. A peer agent that does anything visible POSTS, so
      // the cards ride the `channel_messages` doorbell already paid for and the 30s
      // poll drops back to an idle backstop.
      void agentsPanel.refetch();
    },
    refetchMembers: () => void refetchMembers(),
  });
  // ⚠ THE SAME gate the reads register — the mark-read write holds the realtime
  // doorbell open for its own life, or a coalesced refetch mid-flight reverts
  // the optimistic `read` flag under the click that set it.
  const { markRead } = useMentionWrites({ workspaceId, gate });
  // THE FAVOURITE TOGGLE (Samuel, 2026-08-19) — a FIFTH write family, same gate,
  // on the existing per-member preference route (`PATCH /members`, `favorite`).
  // `consent` decides the OUTBOUND send box and the Inbox's rows — same mutation,
  // same gate. ⚠ Its INBOUND callers are gone (Samuel, 2026-08-22).
  const { favorite, consent } = useChannelPreferenceWrites({ workspaceId, gate });
  // THE ESCALATION ANSWER (Samuel, 2026-08-31) — the SIXTH family, same gate.
  //
  // ⚠ THE AUTHOR DISPLAY FOR THE PENDING ROW IS RESOLVED OFF THE TRANSCRIPT the
  // viewer is already reading (`view-model.ts › viewerPerson`) rather than off the
  // roster: no new read, and `null` is "cannot say" — a viewer who has never posted
  // here gets a pending row with no name, which the reconcile fills in.
  const viewer = viewerPerson(messages, currentUserId);
  const escalationWrites = useEscalationWrites({
    workspaceId,
    currentUserId,
    currentUserName: viewer?.displayName ?? null,
    currentUserAvatarUrl: viewer?.avatarUrl ?? null,
    gate,
  });

  const derivations = useChannelsV2Derivations({
    members,
    currentUserId,
    messages,
    // ⚠ **THE WIRE THAT MAKES THE ARTIFACT CARD VISIBLE** (A4, 2026-09-06). `null`
    // on every channel with nothing folded — the envelope is ADDITIVE and
    // `messages` stays authoritative beside it.
    entries: messageEntries,
    threads,
    openThreadId,
    // ⚠ THE SAME FEED THE AGENTS TAB READS — no new read, no second poll. It carries what each
    // agent is CALLED, which is what lets the transcript render the CURRENT name (2026-08-27).
    agentSessions,
    // ⚠ AND THE PEER PROJECTION THE SAME TAB ALREADY POLLS (2026-08-31, Samuel's ruling) — no
    // new read here either. It carries the OTHER members' agent names
    // (`channel_sessions.display_name`), so their "Bug Reviewer" renders on their posts too.
    peerSessions: agentsPanel.peerSessions,
  });

  /**
   * ANSWER ONE ESCALATION — bound here so the option LABEL is resolved in ONE
   * place.
   *
   * ⚠ THE BODY IS THE OPTION'S OWN LABEL, so the transcript reads as a sentence
   * rather than an index. Both surfaces that can answer (the transcript, the agent
   * pane) call THIS — a second resolution is how the two post different words for
   * one press.
   *
   * ⚠ IT IS A NO-OP FOR A MESSAGE THAT IS NOT AN ANSWERABLE ESCALATION — a belt;
   * the server's own 404 is the fence.
   */
  const channelId = channel?.id ?? null;
  const answerEscalation = useCallback(
    (escalationMessageId: string, optionIndex: number) => {
      const target = messages.find((m) => m.id === escalationMessageId);
      const label = target
        ? escalationOf(target)?.options[optionIndex]?.label
        : undefined;
      if (!label || !channelId) return;
      escalationWrites.answer.mutate({
        channelId,
        escalationMessageId,
        optionIndex,
        optionLabel: label,
        clientMsgId: newClientMsgId(),
      });
    },
    [messages, escalationWrites.answer, channelId]
  );

  // ⚠ THE ACTIVITY SERIES (F-316, closed 2026-09-05). It was a fixture for a COST
  // reason — 31 counted bins per channel selection — and Samuel's 2026-09-05 ruling
  // accepts that price because the query cache carries it: `useApiQuery` keys on the
  // PATH, so one series per channel is fetched once and re-selection is a cache hit.
  // ⚠ ENABLED ONLY WITH BOTH COORDINATES: no segment (the pop-out, a test) or no
  // open channel means no read, rather than a workspace-wide series rendered under
  // one channel's heading.
  const activity = useOverviewSeries({
    workspaceSegment: workspaceSlug ?? "",
    metric: "messages",
    channelId: channel?.id ?? null,
    enabled: Boolean(workspaceSlug) && channel !== null,
  });
  // ⚠ STRUCTURAL, NOT `OverviewSeriesPoint`: the workspaces type is assignable to
  // `ActivityBin`, so the channels tree never learns the other feature's shape.
  const activityBins: ActivityBin[] = activity.days;
  const activityLoading = activity.loading;

  // The thread view's outbound send box — `use-inline-consent.ts`.
  const { outboundByThread, decideOutbound, consentBusy } = useInlineConsent({
    messages,
    requests,
    consent,
  });

  /**
   * **THE ONE ADDRESSABLE-AGENT SET, AND THE 30-SECOND WAIT IT ENDS** (2026-09-13,
   * Samuel: *"when I launch an agent … it doesn't immediately pop up. I have to wait
   * a minute"*).
   *
   * ⚠ **THE PICKER USED TO READ `agentsPanel.peerSessions` ALONE, WHICH IS A POLL.**
   * `channel_sessions` is unpublished (INVARIANTS §7) so that read ticks every
   * `PEER_SESSIONS_POLL_MS` (30 s); a just-launched agent is spawn-idle (§5) so it
   * rings no message doorbell; and `use-agents-panel.ts › launchAgent`'s own
   * `void refetch()` runs BEFORE main's HTTP push has landed the row, which re-reads
   * the old set and restarts that interval. The agent was therefore un-taggable for
   * one full poll period by construction — while `useDesktopSessions` had it within
   * 200 ms (`main/session-summary.js › PUSH_COALESCE_MS`).
   *
   * ⚠ **TWO MEMOS OVER A CONTENT KEY, not one over the arrays** — the own feed is
   * paced by telemetry (a new array ~5×/s while an agent works), and this value
   * feeds three derivations that must not re-run at that rate. Same round trip, same
   * reason, as `derivations.ts › agentKey`.
   */
  const liveAgentsContentKey = useMemo(
    () => liveAgentsKey(agentsPanel.peerSessions, agentSessions, channel?.id ?? ""),
    [agentsPanel.peerSessions, agentSessions, channel?.id]
  );
  const liveAgents = useMemo(
    () => liveAgentsFromKey(liveAgentsContentKey),
    [liveAgentsContentKey]
  );

  return {
    ...derivations,
    messages,
    messagesLoading,
    messagesStale,
    hasOlderMessages,
    loadingOlderMessages,
    loadOlderMessages,
    dropThreadFromHistory,
    members,
    refetchMembers: () => void refetchMembers(),
    threads,
    threadsTruncated,
    threadsLoading,
    mentions,
    mentionsTruncated,
    mentionsLoading,
    activityBins,
    activityLoading,
    requests,
    agentSessions,
    refreshAgents,
    agentsPanel,
    liveAgents,
    gate,
    markRead,
    favorite,
    consent,
    outboundByThread,
    decideOutbound,
    consentBusy,
    answerEscalation,
    answerBusy: escalationWrites.pending,
  };
}
