"use client";

/**
 * Channels composer card: one plain chat send (`intent:"chat"`) plus the @-mention popover. New thread and
 * New Agent open dialogs (`new-thread-dialog.tsx`, `launch-agent-dialog.tsx`); `fanOutThreads` stays here and
 * the thread dialog calls it — one `channel_tasks` row per addressee (INVARIANTS §5).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  dictationSpanAt,
  insertDictation,
  type DictationSpan,
} from "./dictation/insert-text";
import { useThreadWrites } from "../hooks/use-thread-writes";
import { newClientMsgId } from "../lib/optimistic-cache";
import { messageLanded } from "../client/api";
import { usePersistentDraft } from "@/shared/hooks/use-persistent-draft";
import { stashPendingSend } from "@/shared/lib/draft-store";
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
  // The unsent text survives navigation, reload and restart (`lib/draft-store.ts`), per member,
  // workspace and channel. Human posts land in the main room, so the channel is the target.
  const persisted = usePersistentDraft(
    { userId: currentUserId, workspaceId },
    `channel:${channelId}`,
    // A send a reload cut off: asked of the server by its idempotency key before the words return.
    (clientMsgId) => messageLanded(channelId, clientMsgId, workspaceId)
  );
  const draft = persisted.text;
  const setDraft = persisted.setText;
  const draftRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(draftRef, draft);
  // Only the launch form's state lives here; `launch-agent-dialog.tsx` draws it.
  const launch = useAgentLaunch();
  // The toolbar glyph's own nonce, summed with `newThreadSignal`.
  const [threadDialogNonce, setThreadDialogNonce] = useState(0);
  // ⚠ A MIRROR OF THE DIALOG'S OWN `open`, for the glyph's face only (item 4, 2026-10-12). The
  // dialog still owns the state and reports it (`new-thread-dialog.tsx › onOpenChange`); nothing
  // here may open or close it, which is what keeps the nonce the single way in.
  const [threadOpen, setThreadOpen] = useState(false);
  const { send, fanOutThreads, pending } = useThreadWrites({
    workspaceId,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    gate,
  });

  // Escape declined the auto-address for this draft only — not the standing
  // `unaddressed_responder` setting; cleared on send. Kept WITH the draft, so it survives too.
  const addressOff = persisted.value.extra?.addressOff === true;
  const setAddressOff = (off: boolean) => persisted.setExtra(off ? { addressOff: true } : undefined);

  const mentions = useComposerMentions({ draft, setDraft, members, sessions: liveAgents, currentUserId });

  // Named, not inlined: `composer-input.test.ts` slices `<ComposerInputRow …/>` to the first `/>`.
  const tintDraft = (value: string) => (
    <ComposerTint text={value} members={members} sessions={liveAgents} />
  );

  /**
   * **DICTATION TYPES INTO THE BOX, AT THE CARET, AS IT IS HEARD** (Samuel, 2026-10-12, item 2).
   *
   * 🔴 **IT WAS APPEND-TO-THE-END-ON-FINAL AND BOTH HALVES OF THAT ARE GONE.** The old callback
   * took finished phrases only and pushed each one onto the tail of the draft after stripping
   * trailing space, so nothing appeared until the engine closed a phrase and when it did it
   * appeared at the far end, wherever the operator was actually writing.
   *
   * ⚠ **THE ARITHMETIC IS NOT HERE.** `dictation/insert-text.ts › insertDictation` owns the
   * separator, the in-place replacement and the commit, and it is pure. This closure is the
   * three refs that pure function needs and nothing else.
   * ⚠ **`setDraft` TAKES A VALUE, NEVER AN UPDATER, AND THAT IS DELIBERATE.** The span and the
   * mirror below have to be written when the phrase arrives, and React may invoke a functional
   * updater twice (`composer-launch.test.tsx` pins exactly that defect for the launch panel), so
   * an updater that moved the anchor would advance it twice under StrictMode and write the phrase
   * beside itself.
   * ⚠ **`latest` IS WRITTEN SYNCHRONOUSLY HERE, which is what makes two phrases in one tick
   * compose.** The engine's events are async callbacks, so reading `draft` out of this closure
   * would read whatever the last RENDER saw — correct for the first phrase of a tick and one
   * phrase stale for the second.
   */
  const dictationSpan = useRef<DictationSpan | null>(null);
  const dictationCaret = useRef<number | null>(null);
  const latest = useRef(draft);
  /**
   * 🔴 **THE DRAFT AS THIS CLOSURE LAST LEFT IT — the whole of the stale-span fix** (Review 21).
   *
   * ⚠ **A SPAN IS A CHARACTER RANGE, AND AN OUTSIDE EDIT MOVES EVERY INDEX AFTER THE CARET.** So
   * the range the last interim wrote comes to cover the OPERATOR'S characters, and the next
   * interim replaces them: a `Z` typed at position 0 of `abc hi def` turned the next phrase into
   * `Zab hi therei def`, with the `c` gone. **It is a loss mode the old append-to-the-end
   * behaviour did not have**, which is why it is guarded by a ref rather than by care.
   * ⚠ **COMPARING AGAINST WHAT WE WROTE IS THE DETECTION, and it has to be its own ref.**
   * `latest` tracks the draft through every render, so it equals the typed text and cannot tell
   * who typed it; this one only ever moves when dictation itself writes. They are equal exactly
   * while nobody else has touched the box.
   */
  const lastWritten = useRef<string | null>(null);
  // Typing updates the mirror: every render, so the next phrase inserts into what is really there.
  useEffect(() => {
    latest.current = draft;
  });
  const dictation = useDictation((text, final) => {
    const before = latest.current;
    /**
     * ⚠ **AN EDIT THIS CLOSURE DID NOT MAKE RE-ANCHORS THE SESSION, AND THE OPERATOR'S EDIT
     * WINS** (Review 21's rule, in all three of its shapes — before the span, inside it, after
     * it). The anchor becomes their caret with an EMPTY span, so the next phrase is INSERTED
     * where they are writing and the stale range is never replaced. Whatever the last interim
     * had already put in the box stays behind as ordinary typed text: nothing is rewound,
     * nothing is deleted, and the words they typed are still theirs.
     * ⚠ **AN EMPTY SPAN IS WHAT MAKES IT LOSSLESS**, not the clamp in `insert-text.ts` — a
     * clamped span still REPLACES, it just replaces inside the bounds of the string.
     * ⚠ **IT MUST NOT FIRE ON OUR OWN WRITES**, or every interim would be appended instead of
     * replaced and a re-worded phrase would stack up ("hello wor hello world"). That is the
     * equality below, and `composer-toolbar.test.tsx` pins both directions.
     */
    const outsideEdit = before !== lastWritten.current;
    // ⚠ THE ANCHOR IS THE CARET, TAKEN ON THE FIRST PHRASE OF A SESSION rather than on the click:
    // a click that the engine's probe then refuses would have moved nothing, and the textarea
    // keeps its selection while the mic button holds focus.
    const span =
      dictationSpan.current !== null && !outsideEdit
        ? dictationSpan.current
        : dictationSpanAt(draftRef.current?.selectionStart ?? before.length);
    const edit = insertDictation(before, span, text, final);
    dictationSpan.current = edit.span;
    dictationCaret.current = edit.caret;
    latest.current = edit.text;
    lastWritten.current = edit.text;
    setDraft(edit.text);
  });
  // ⚠ A SESSION'S ANCHOR DIES WITH THE SESSION. Without this the next dictation would resume at
  // the end of the last one, wherever the caret has been since. `lastWritten` goes with it: a
  // draft left standing from the last session is not evidence about this one.
  useEffect(() => {
    if (!dictation.listening) {
      dictationSpan.current = null;
      lastWritten.current = null;
    }
  }, [dictation.listening]);
  // ⚠ AFTER the value lands, so the caret sits past the dictated words "as if typed" — a
  // controlled textarea's selection is reset by the render that changes its value.
  useEffect(() => {
    const at = dictationCaret.current;
    if (at === null) return;
    dictationCaret.current = null;
    draftRef.current?.setSelectionRange(at, at);
  }, [draft]);

  const body = draft.trim();
  // A disabled send still says why (INVARIANTS §8, rule 4).
  const canSend = !pending && body.length > 0;
  const hint = canSend ? "Send" : pending ? "Sending…" : "Write a message first";

  const clear = () => {
    persisted.clear();
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
      // Explicit: absence reads as a request on the wire (`schema-intent.ts › MessageIntentSchema`).
      intent: "chat" as const,
      // Only ever `false`, only after Escape; absent is the wire default.
      ...(addressOff ? { autoAddress: false as const } : {}),
    };
    // The box empties now; the text is held until the server answers and comes back on failure
    // (`use-thread-writes.ts › sendConfig` settles it by `clientMsgId`).
    stashPendingSend(persisted.key, message.clientMsgId, persisted.value);
    launch.reset();
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
            threadOpen={threadOpen}
            onMention={() => { mentions.openFromButton(); draftRef.current?.focus(); }}
            // ⚠ THE SAME FACT THE POPOVER ITSELF RENDERS ON (`mentions.query !== null`, the
            // condition above), so the glyph cannot disagree with the list it opened.
            mentionOpen={mentions.query !== null}
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
            onOpenChange={setThreadOpen}
          />
        </div>
      </div>
    </div>
  );
}
