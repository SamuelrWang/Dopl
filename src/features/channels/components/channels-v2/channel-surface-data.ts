"use client";

/**
 * ONE CHANNEL'S LIVE STATE — every read the per-channel surface renders, the ONE
 * refetch coordinator those reads and its writes register through, and the pure
 * derivations over them.
 *
 * ⚠ IT OWNS `useChannelsV2Live` SO THAT A MOUNT CANNOT FORGET IT. INVARIANTS §7:
 * a live surface that skips the refetch coordinator fails with NO ERROR SHAPE —
 * the transcript simply stops updating — and that has already shipped once
 * (`agent-window.tsx`, 2026-08-20). Both hosts of the surface take THIS hook and
 * therefore take exactly one coordinator each: `channels-v2-core.tsx`, which
 * folds its channel-LIST invalidation in through `onDoorbell` because the list is
 * the TREE's read and not the surface's, and `channel-surface-standalone.tsx`,
 * which has no tree beside it and folds in nothing.
 *
 * ⚠ EVERYTHING BELOW IS LIFTED VERBATIM out of `channels-v2-core.tsx`
 * (2026-08-23) — the hook ORDER, the arguments and every ⚠ note are that file's.
 * The order is load-bearing: `useAgentsPanel` must precede the live wiring that
 * names its `refetch`, and both write hooks must follow the `gate` they settle
 * into.
 *
 * ⚠ IT TAKES A `channel` THAT MAY BE `null`, because the workspace page mounts it
 * above its own channel branch: the first-run explainer renders with no channel
 * open, and the coordinator has to stay registered through it or the tree stops
 * hearing the doorbell. (The Inbox takeover was the other such state and is
 * deleted — 2026-08-25, Samuel; INVARIANTS §6.)
 */

import { CONSENT_INBOX_POLL_MS } from "../../constants";
import { useCallback } from "react";
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
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
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
   * ⚠ IT IS AN ORDINARY POST. An escalation is a question about shared work
   * asked in a shared room, so its answer is public: it goes to the same
   * messages route, appears in the transcript, and reaches the asking agent the
   * way every other human message does. The client never names an agent — the
   * server derives which one to wake off the escalation's own stamp.
   */
  answerEscalation: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy: boolean;
}

export function useChannelSurfaceData({
  workspaceId,
  channel,
  currentUserId,
  openThreadId,
  capabilities,
  onDoorbell,
}: {
  workspaceId: string;
  /** `null` while the host is showing something other than a channel. */
  channel: Channel | null;
  currentUserId: string;
  /** The thread the host asked for; resolved against this channel's list. */
  openThreadId: string | null;
  /**
   * ⚠ THE SAME OBJECT THE SURFACE RENDERS FROM, BECAUSE A CAPABILITY THAT HIDES
   * A CONTROL BUT STILL FETCHES ITS DATA IS HALF A CAPABILITY (2026-08-26). The
   * host passes ONE `capabilities` and it now decides both what renders and what
   * is READ; see the consent read below for the case that forced it.
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
    loading: messagesLoading,
    refetch: refetchMessages,
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
  // ⚠ WORKSPACE-WIDE ON PURPOSE: the Inbox badge counts every pending draft, and
  // the same rows place the thread view's send box. One read, two consumers — a
  // channel-scoped copy would make the badge lie.
  // ⚠ `outbound`, NOT `requests` (Samuel, 2026-08-22 — the inbound consent
  // retirement). No surface in this tree can act on an INBOUND row any more, and
  // a badge is a claim that something is actionable.
  //
  // 🔒 NOT MOUNTED AT ALL WHEN `selfManagement: false` (2026-08-26). That flag
  // means THIS VIEWER runs no agent here (`channel-surface.tsx ›
  // ChannelSurfaceCapabilities`), and an OUTBOUND consent row is a draft the
  // viewer's OWN agent wrote and is waiting on them to release — so the read can
  // only ever answer `[]`. On the guest web lane it was worse than useless: the
  // route is at the `viewer` floor, so this was a **403 every
  // CONSENT_INBOX_POLL_MS, forever**, plus a `channel_consent_requests`
  // subscription that (correctly) delivers a guest nothing — §7's "a
  // subscription that looks like coverage". Passing `null` disables the query
  // AND the subscription in one place (`use-consent-inbox.ts`).
  const { outbound: requests } = useConsentInbox(
    (capabilities?.selfManagement ?? true) ? workspaceId : null,
    undefined,
    CONSENT_INBOX_POLL_MS
  );
  // MY OWN AGENTS — the ONE read here that is not a server projection. It is this
  // machine's live session state over the Electron bridge (`agents-model.ts`), so
  // it is workspace-wide by nature and each consumer slices it; `null` means
  // "could not ask" (plain browser, or an older main) and is deliberately carried
  // as null all the way to the tab, which words the two absences differently.
  // ⚠ `refresh` is the REFUSAL path only (`agents-model.ts ›
  // DesktopSessionsFeed`) — main answering `{ok:false}` is the one fact no
  // push announces. Not a poll.
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

  // Realtime → coalesced refetch, deferred while a local write is in flight. The whole
  // wiring is `live.ts`, split out at the Phase 10 cap; what stays here is WHAT a doorbell
  // invalidates, which is the surface's own business.
  // ⚠ `gate` is handed to every writer on this surface, and `live.ts` hands the SAME
  // coordinator to the subscriptions — one coordinator, both ends (INVARIANTS §7/§8).
  const { gate } = useChannelsV2Live({
    workspaceId,
    refetchAll: () => {
      // ⚠ INVALIDATE THE PREFIX, don't refetch ONE observer. `query.refetch()`
      // revalidates only the mounted key-variant, so any other variant of the
      // channels list (`include=archived` is the one that exists) stays stale
      // behind a doorbell that fired for it. That list belongs to the TREE, so
      // its invalidation arrives here as the host's `onDoorbell` — see the prop.
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
      // each of those, for every member — the cost that §7's first bullet refuses.
      // A peer agent that does anything visible POSTS, and that `channel_messages`
      // doorbell is already paid for. So the cards ride it, and the 30s poll drops
      // back to being the idle backstop it should always have been.
      void agentsPanel.refetch();
    },
    refetchMembers: () => void refetchMembers(),
  });
  // ⚠ THE SAME gate the reads register — the mark-read write holds the realtime
  // doorbell open for its own life, or a coalesced refetch mid-flight reverts
  // the optimistic `read` flag under the click that set it.
  const { markRead } = useMentionWrites({ workspaceId, gate });
  // THE FAVOURITE TOGGLE (Samuel, 2026-08-19) — a FIFTH write family on this
  // surface, on the same gate as the other four, and the existing per-member
  // preference route rather than a new one (`PATCH /members`, `favorite`).
  // `consent` decides the OUTBOUND send box and the Inbox's rows — same
  // mutation, same gate. ⚠ Its INBOUND callers are gone (Samuel, 2026-08-22).
  const { favorite, consent } = useChannelPreferenceWrites({ workspaceId, gate });
  // THE ESCALATION ANSWER (Samuel, 2026-08-31) — the SIXTH family, same gate.
  //
  // ⚠ THE AUTHOR DISPLAY FOR THE PENDING ROW IS RESOLVED OFF THE TRANSCRIPT the
  // viewer is already reading (`view-model.ts › viewerPerson`) rather than off
  // the roster: it is the source `agent-panel.tsx` already uses, it costs no new
  // read, and `null` is "cannot say" — a viewer who has never posted here gets a
  // pending row with no name, which the reconcile fills in a moment later.
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
    threads,
    openThreadId,
    // ⚠ THE SAME FEED THE AGENTS TAB READS — no new read, no second poll. It carries what each
    // agent is CALLED, which is what lets the transcript render the CURRENT name (2026-08-27).
    agentSessions,
  });

  /**
   * ANSWER ONE ESCALATION — bound here so the option LABEL is resolved in ONE
   * place.
   *
   * ⚠ THE BODY IS THE OPTION'S OWN LABEL, read off the escalation being
   * answered, so the transcript reads as a sentence rather than as an index
   * nobody can interpret. Both surfaces that can answer — the channel transcript
   * and the agent pane — call THIS, because a second resolution is how the two
   * come to post different words for one press.
   *
   * ⚠ IT IS A NO-OP FOR A MESSAGE THAT IS NOT AN ANSWERABLE ESCALATION. The
   * button would not have rendered, so this is a belt; the server's own 404 is
   * the fence.
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

  // The thread view's outbound send box — `use-inline-consent.ts`.
  const { outboundByThread, decideOutbound, consentBusy } = useInlineConsent({
    messages,
    requests,
    consent,
  });

  return {
    ...derivations,
    messages,
    messagesLoading,
    members,
    refetchMembers: () => void refetchMembers(),
    threads,
    threadsTruncated,
    threadsLoading,
    mentions,
    mentionsTruncated,
    mentionsLoading,
    requests,
    agentSessions,
    refreshAgents,
    agentsPanel,
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
