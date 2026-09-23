"use client";

/**
 * Channels composer card: one plain chat send (`intent:"chat"`) plus the @-mention popover. New thread and
 * New Agent open dialogs (`new-thread-dialog.tsx`, `launch-agent-dialog.tsx`); `fanOutThreads` stays here and
 * the thread dialog calls it — one `channel_tasks` row per addressee (INVARIANTS §5).
 */

import { useRef, useState, type ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { cn } from "@/shared/lib/utils";
import { COMPOSER_BOTTOM, ComposerInputRow } from "./composer-input";
import { ComposerToolbar } from "./composer-toolbar";
import { NewThreadDialog } from "./new-thread-dialog";
import { MentionPopover } from "./composer-mentions";
import { ComposerRecipients } from "./composer-recipients";
import { draftReach, viewerUnaddressedResponder } from "../lib/draft-recipients";
import { ComposerTint } from "./composer-tint";
import { useComposerMentions } from "./use-composer-mentions";
import type { LiveAgentSession } from "../lib/draft-recipients";
import type { AgentLaunchControls } from "./use-agents-panel";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import { useAutoGrow } from "./use-auto-grow";
import { useDictation } from "./use-dictation";
import { useThreadWrites } from "../hooks/use-thread-writes";
import { newClientMsgId } from "../lib/optimistic-cache";
import type { ChannelMember } from "../types";

/** Stable empties: a fresh array per render re-derives the @-picker shortlist. */
const EMPTY_LIVE_AGENTS: readonly LiveAgentSession[] = [];
const EMPTY_RECENT: readonly string[] = [];

export function ChannelsComposer({
  channelId,
  workspaceId,
  members,
  currentUserId,
  currentUserName,
  currentUserAvatarUrl,
  gate,
  newAgent,
  openThreadId = null,
  newThreadSignal = 0,
  liveAgents = EMPTY_LIVE_AGENTS,
  working = null,
  recentAgentIds = EMPTY_RECENT,
  threadOtherParty = null,
}: {
  /** Captured at submit into every draft, never re-read mid-write (INVARIANTS §8, rule 4). */
  channelId: string;
  workspaceId: string;
  members: ChannelMember[];
  currentUserId: string;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  /** The page's refetch coordinator — the same gate the reads register. */
  gate: MutationGate;
  /** The Bot icon's wiring (`use-agents-panel.ts`), handed down; absent renders no button. */
  newAgent?: AgentLaunchControls;
  /** Which exchange a new agent lands on; `null` is a channel-level agent. */
  openThreadId?: string | null;
  /** Nonced ask from the Threads tab to open the new-thread dialog; a counter, so the dialog owns its open state. */
  newThreadSignal?: number;
  /** Every member's live agents (`use-channel-agent-sessions.ts`); empty where a surface has no sessions read. */
  liveAgents?: readonly LiveAgentSession[];
  /** My agents mid-turn, drawn at the end of the recipient line. */
  working?: ReactNode;
  /** The room's recent agent posters, newest first (RR3). */
  recentAgentIds?: readonly string[];
  /** A thread's other party (RR1); `null` in the main room. */
  threadOtherParty?: ChannelMember | null;
}) {
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(draftRef, draft);
  // Only the launch form's state lives here; `launch-agent-dialog.tsx` draws it.
  const launch = useAgentLaunch();
  // The toolbar glyph's own nonce, summed with `newThreadSignal`.
  const [threadDialogNonce, setThreadDialogNonce] = useState(0);
  const { send, fanOutThreads, pending } = useThreadWrites({
    workspaceId,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    gate,
  });

  // Escape declined the auto-address for this draft only — not the standing
  // `unaddressed_responder` setting; cleared on send.
  const [addressOff, setAddressOff] = useState(false);

  const mentions = useComposerMentions({ draft, setDraft, members, sessions: liveAgents, currentUserId });

  // Named, not inlined: `composer-input.test.ts` slices `<ComposerInputRow …/>` to the first `/>`.
  const tintDraft = (value: string) => (
    <ComposerTint text={value} members={members} sessions={liveAgents} />
  );

  // Append-only, via a functional update so a phrase landing mid-typing keeps what was typed since.
  const dictation = useDictation((text) =>
    setDraft((prev) => {
      const kept = prev.replace(/\s+$/, "");
      return kept.length === 0 ? text : `${kept} ${text}`;
    })
  );

  const body = draft.trim();
  // A disabled send still says why (INVARIANTS §8, rule 4).
  const canSend = !pending && body.length > 0;
  const hint = canSend ? "Send" : pending ? "Sending…" : "Write a message first";

  const clear = () => {
    setDraft("");
    launch.reset();
  };

  // Clears before the await: drafts carry everything the write needs and the optimistic layer owns rollback.
  const submit = () => {
    if (!canSend) return;
    // An auto-addressed agent is written into the body as a real `@handle` tag, so the server sees a
    // typed address and RR3 never runs for this post. Agents via `responder` only.
    const reach = draftReach({
      body,
      members,
      sessions: liveAgents,
      currentUserId,
      unaddressedResponder: viewerUnaddressedResponder(members, currentUserId),
      recentAgentIds,
      threadOtherParty,
    });
    const auto =
      !addressOff && reach.via === "responder" ? reach.recipients[0] : undefined;
    const tagged =
      auto && auto.kind === "agent" ? `@${auto.handle} ${body}` : body;
    const message = {
      channelId,
      clientMsgId: newClientMsgId(),
      body: tagged,
      // Explicit: absence reads as a request on the wire (`schema.ts › MessageIntentSchema`).
      intent: "chat" as const,
      // Only ever `false`, only after Escape; absent is the wire default.
      ...(addressOff ? { autoAddress: false as const } : {}),
    };
    clear();
    setAddressOff(false);
    send.mutate(message);
  };

  // `COMPOSER_BOTTOM` is shared with the agent composer so the two boxes sit level across the divider.
  return (
    <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
      {mentions.query !== null && (
        <MentionPopover suggestions={mentions.suggestions} active={mentions.active} onPick={mentions.pick} />
      )}
      {/* Who this draft reaches — a caption above the card; alignment is `composer-recipients.tsx`'s. */}
      <ComposerRecipients
        body={body}
        members={members}
        sessions={liveAgents}
        currentUserId={currentUserId}
        recentAgentIds={recentAgentIds}
        threadOtherParty={threadOtherParty}
        cancelled={addressOff}
        working={working}
      />
      {/* The agent pill's face; no `bg-*` (it would flatten the kit gradient). The 1px ring lives in the
          `13px`/`11px` padding — scale values shrink the card 2px. No row gap. */}
      <div className="raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]">
        <div className="flex flex-col gap-2">

          <ComposerInputRow
            // Bare: the card pays the inset once and the send arrow is in the toolbar row.
            face="bare"
            value={draft}
            inputRef={draftRef}
            onChange={(next) => {
              setDraft(next);
              // A new token is a new shortlist — start at the top of it.
              mentions.setHighlight(0);
            }}
            onKeyDown={(e) => {
              // Escape first (`use-composer-mentions.ts › keyDown` ignores it); an IME Escape is not a decline.
              if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                setAddressOff(true);
              }
              mentions.keyDown(e, submit);
            }}
            placeholder="Write a message"
            ariaLabel="Message"
            highlight={tintDraft}
          />

          <ComposerToolbar
            newAgent={newAgent}
            launchOpen={launch.open}
            onToggleLaunch={launch.toggle}
            // Closes the launch form so two forms never stand at once.
            onNewThread={() => { launch.close(); setThreadDialogNonce((n) => n + 1); }}
            onMention={() => { mentions.openFromButton(); draftRef.current?.focus(); }}
            dictation={dictation}
            hasContent={body.length > 0}
            onClear={clear}
            submitHint={hint}
            submitDisabled={!canSend}
            onSubmit={submit}
          />

          {/* A refused launch is said here: main's `{ok:false}` pushes nothing else
              (`use-launch-controls.ts › LAUNCH_REFUSALS`). */}
          {newAgent?.launchError && (
            <p role="alert" className="px-0.5 text-caption text-danger">
              {newAgent.launchError}
            </p>
          )}

          {newAgent?.canLaunch && (
            <LaunchAgentDialog
              panel={launch}
              newAgent={newAgent}
              /* Taken colours come from the peer ∪ own union (`lib/live-agents.ts › liveAgentsKey`);
                 the peer projection alone lags a launch. */
              liveSessions={liveAgents}
              openThreadId={openThreadId ?? null}
              channelId={channelId}
              workspaceId={workspaceId}
              currentUserId={currentUserId}
              members={members}
            />
          )}

          {/* Both openers' nonces are summed so neither swallows the other's ask. */}
          <NewThreadDialog
            signal={newThreadSignal + threadDialogNonce}
            channelId={channelId}
            members={members}
            currentUserId={currentUserId}
            onCreate={fanOutThreads.mutate}
          />
        </div>
      </div>
    </div>
  );
}
