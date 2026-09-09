"use client";

/**
 * Channels v2 — the composer card, with the @-mention autocomplete floating
 * above its left edge.
 *
 * ⚠ ONE SEND, ONE ACT, SINCE 2026-09-08. This card posts a plain chat message
 * (`intent:"chat"` — the wire value is load-bearing, it is what tells the
 * receiving side this reaches nobody's agent) and does nothing else. **THREAD
 * CREATION LEFT THE CARD:** both entries — the Threads tab's "New thread" and
 * this toolbar's `MessageSquarePlus` glyph — open {@link NewThreadDialog}, a
 * modal carrying its own Create. The INLINE request panel and
 * `use-thread-request.ts` are DELETED rather than disarmed (Samuel, 2026-09-08:
 * *"look there is an icon in the text input bar that is supposed to spawn new
 * threads. Why wasn't that wired in"*).
 *
 * ⚠ TWO SOURCES, ONE DIALOG, AND THEY ARE ADDED. `newThreadSignal` is the
 * Threads tab's nonce and `threadDialogNonce` is this glyph's; their SUM is what
 * the dialog watches, so either source re-opens the form and neither can shut
 * the other's.
 *
 * ⚠ THE CHAT TEXTAREA IS ALWAYS MOUNTED NOW, and that is the popup's doing. "One
 * edit surface at a time" (Samuel, 2026-08-26) unmounted it because the request
 * form stood ON this card; a dialog draws its own scrim, so the draft is simply
 * left alone behind it. **Nothing on this card branches on a panel any more** —
 * `panelOpen`, the `!panelOpen` unmounts and `composer-submit-state.ts`'s
 * three-act derivation all went with the panel, and the submit has one face.
 *
 * ⚠ THE FAN-OUT WRITE IS STILL THIS FILE'S. `fanOutThreads` lives here and the
 * dialog is its CALLER — it hands over a finished draft, one `channel_tasks` row
 * per addressee (INVARIANTS §5 — a thread is one requester + one target) which
 * the transcript renders as ONE card (`transcript.tsx › ThreadCardMessage`), and
 * the base idempotency key is minted at the press inside the dialog (§8).
 *
 * ⚠ THE BOT ICON AND THE THREAD GLYPH ARE TWO CONTROLS SINCE 2026-08-21
 * (Samuel). One glyph used to mean both "start an agent" and "open the
 * thread-creation form", which are not the same act and do not even hit the same
 * layer — a thread raises a REQUEST at another member over the write layer; the
 * Bot icon spawns MY OWN agent on THIS machine over the bridge, and nothing is
 * posted. **`MessageSquarePlus` ("New thread") opens the popup, and `Bot` is New
 * Agent.**
 *
 * ⚠ THE BOT ICON IS CONTEXT-SENSITIVE and takes its target from the OPEN THREAD:
 * in thread view the agent lands on that exchange; in channel view it is a
 * CHANNEL-LEVEL agent (`taskId: null`). Same op, same hook, same refusal copy as
 * the Agents tab's button — this surface is a second BUTTON, never a second
 * launch path.
 */

import { useRef, useState } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { cn } from "@/shared/lib/utils";
import { COMPOSER_BOTTOM, ComposerInputRow } from "./composer-input";
import { ComposerToolbar } from "./composer-toolbar";
import { NewThreadDialog } from "./new-thread-dialog";
import { MentionPopover } from "./composer-mentions";
import { ComposerRecipients } from "./composer-recipients";
import { ComposerTint } from "./composer-tint";
import { useComposerMentions } from "./use-composer-mentions";
import type { LiveAgentSession } from "../../lib/draft-recipients";
import type { AgentLaunchControls } from "./use-agents-panel";
import { LaunchAgentDialog } from "./launch-agent-dialog";
import { useAgentLaunch } from "./use-agent-launch";
import { useAutoGrow } from "./use-auto-grow";
import { useDictation } from "./use-dictation";
import { useThreadWrites } from "../../hooks/use-thread-writes";
import { newClientMsgId } from "../../lib/optimistic-cache";
import type { ChannelMember } from "../../types";

/** ⚠ A STABLE EMPTY ARRAY, not `[]` at the call site: an agents prop that is a fresh object every
 *  render re-derives the whole @-picker shortlist on a surface that has no sessions read. */
const EMPTY_LIVE_AGENTS: readonly LiveAgentSession[] = [];
const EMPTY_RECENT: readonly string[] = [];

export function ChannelsV2Composer({
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
  recentAgentIds = EMPTY_RECENT,
  threadOtherParty = null,
}: {
  /** ⚠ CAPTURED AT SUBMIT into every draft — never re-read from the selection
   *  while a write is in flight (INVARIANTS §8, rule 4). */
  channelId: string;
  workspaceId: string;
  members: ChannelMember[];
  currentUserId: string;
  currentUserName?: string | null;
  currentUserAvatarUrl?: string | null;
  /** The page's refetch coordinator — the SAME gate the reads register. */
  gate: MutationGate;
  /**
   * THE BOT ICON'S WIRING — the page's own `use-agents-panel.ts` instance,
   * handed down. ⚠ ABSENT MEANS NO BUTTON, not a dead one: a surface with no
   * launch controls to offer (the pop-out thread window) renders none, which is
   * the same feature-detected rule every bridge affordance in this family
   * follows (INVARIANTS §11).
   */
  newAgent?: AgentLaunchControls;
  /** Which exchange a new agent lands on; `null` is a CHANNEL-LEVEL agent. */
  openThreadId?: string | null;
  /** Nonced ask from the Threads tab to open the new-thread POPUP. ⚠ A COUNTER,
   *  not a boolean: the dialog's open state stays OWNED THERE, so there is no
   *  mirror to drift. Each increment is one request; the default is nobody
   *  asking, and this composer ADDS the toolbar glyph's own nonce to it. */
  newThreadSignal?: number;
  /**
   * **THE CHANNEL'S LIVE AGENTS — every member's, not this machine's** (2026-09-02, slice B10).
   * The peer projection the Agents tab already polls (`use-channel-agent-sessions.ts`), which is
   * the same set the server resolves a person's `to=` against. Empty where a surface has no
   * sessions read; the picker then offers members only.
   */
  liveAgents?: readonly LiveAgentSession[];
  // ⚠ **`defaultResponderAgentName` IS GONE FROM THIS PROP CHAIN (2026-09-07, items 10 and
  // 11).** It was the channel's room-wide nomination, threaded down from the channel row so
  // the recipient line could state RR3 arm 1. The question is PER MEMBER now, so
  // `ComposerRecipients` reads it off the VIEWER'S OWN roster row — a roster this surface
  // already passes for the @-picker — and no host has to remember to hand it over.
  /** RR3 arm 3's input — the room's recent agent posters, newest first. */
  recentAgentIds?: readonly string[];
  /** RR1's answer for a thread composer: the exchange's OTHER party. `null` in the main room. */
  threadOtherParty?: ChannelMember | null;
}) {
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // AUTO-GROW to three visible lines, then scroll (Samuel, 2026-08-20 — the second line was
  // clipping invisibly at rows={1}). ⚠ THE MECHANISM IS `use-auto-grow.ts` SINCE 2026-08-27, when
  // the panels' Description fields wanted it too; it was written inline here and a second copy is
  // how one of them ends up growing to a different ceiling than the other.
  useAutoGrow(draftRef, draft);
  // WHO THE NEW AGENT IS — the Bot icon's form. ⚠ ONLY THE STATE lives here; the dialog that
  // draws it is `launch-agent-dialog.tsx`, mounted only where a launch is possible.
  const launch = useAgentLaunch();
  // ⚠ THE TOOLBAR GLYPH'S OWN NONCE (Samuel, 2026-09-08: *"there is an icon in the text input bar
  // that is supposed to spawn new threads"*). It is ADDED to the Threads tab's signal below, so
  // either source re-opens {@link NewThreadDialog} and there is no second thread form to reach.
  const [threadDialogNonce, setThreadDialogNonce] = useState(0);
  const { send, fanOutThreads, pending } = useThreadWrites({
    workspaceId,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    gate,
  });

  // THE @-PICKER — `use-composer-mentions.ts` (the §1 split at the cap, 2026-08-27).
  const mentions = useComposerMentions({ draft, setDraft, members, sessions: liveAgents, currentUserId });

  /**
   * THE TINT (2026-09-07, Samuel: blue = *"will route to an agent"*) — the SAME question
   * `ComposerRecipients` answers in words one row down, asked per token and answered in place.
   * Same roster, same live agents, same index (`lib/draft-recipients.ts › draftAgentIndex`), so
   * the line and the colour cannot disagree about who a draft reaches. The RULE is
   * `composer-tint.tsx`'s; this file states only that the field wears it.
   *
   * ⚠ **NAMED HERE RATHER THAN INLINED AT THE PROP, AND NOT FOR TIDINESS.**
   * `composer-input.test.ts` pins the bare mount by matching `<ComposerInputRow …/>` up to the
   * FIRST `/>`, so a self-closing element written inside that JSX truncates the slice the
   * assertion reads — the pin would still pass while covering less than it claims to. A function
   * reference keeps the element's own props the only thing between those two tags.
   */
  const tintDraft = (value: string) => (
    <ComposerTint text={value} members={members} sessions={liveAgents} />
  );

  /**
   * DICTATION — the Mic glyph's engine (`use-dictation.ts`, which owns every rule about it).
   *
   * ⚠ IT ONLY EVER APPENDS, WHICH IS WHAT MAKES "the text stays" TRUE BY CONSTRUCTION. There is no
   * stop path anywhere that clears the draft, because nothing here can: the hook hands over
   * finished phrases and this closure adds them to the end of whatever the operator has.
   * ⚠ THE FUNCTIONAL UPDATE IS LOAD-BEARING. A phrase can land while the operator is still typing,
   * and reading `draft` from this render's closure would overwrite the characters typed since.
   * ⚠ ONE SPACE, NEVER TWO, and none at all into an empty box — dictation should read as if it
   * were typed there.
   */
  const dictation = useDictation((text) =>
    setDraft((prev) => {
      const kept = prev.replace(/\s+$/, "");
      return kept.length === 0 ? text : `${kept} ${text}`;
    })
  );

  const body = draft.trim();
  /**
   * ONE CONTROL, ONE ACT, AND THE DERIVATION IS THREE LINES AGAIN (2026-09-08).
   *
   * ⚠ `composer-submit-state.ts` IS DELETED, NOT STUBBED. It existed to answer "which of the three
   * acts is this press" while a launch panel and a request panel shared this card's one submit;
   * both forms are modals with their own submit now, so the question has one answer and a pure
   * function returning a constant `act` is a rule that no longer decides anything.
   * ⚠ A DISABLED SEND STILL SAYS WHY (INVARIANTS §8, rule 4) — a disabled control with no reason
   * is indistinguishable from a broken one.
   */
  const canSend = !pending && body.length > 0;
  const hint = canSend ? "Send" : pending ? "Sending…" : "Write a message first";

  const clear = () => {
    setDraft("");
    launch.reset();
  };

  /**
   * ⚠ THE COMPOSER CLEARS BEFORE THE AWAIT and the drafts carry everything the
   * write needs — the optimistic layer owns the rollback, and re-reading state
   * after the round trip would read a composer the user has since typed into.
   */
  const submit = () => {
    if (!canSend) return;
    // ⚠ THE LAUNCH AND REQUEST ARMS ARE BOTH GONE FROM HERE (2026-09-08). Each dialog owns its own
    // act and its own submit; this control sends a chat message, and nothing else.
    const message = {
      channelId,
      clientMsgId: newClientMsgId(),
      body,
      // ⚠ EXPLICIT, never omitted. Absence reads as `request` on the wire
      // (`schema.ts › MessageIntentSchema`), and the plain composer is human
      // chat, full stop — the intent pill that used to choose is retired.
      intent: "chat" as const,
    };
    clear();
    send.mutate(message);
  };

  // ⚠ THE BOTTOM OFFSET IS NOT WRITTEN HERE. It is `COMPOSER_BOTTOM`, shared with the agent
  // composer, because the two boxes sit side by side across the pane divider and any difference
  // reads as one floating higher than the other (Samuel, live review 2026-08-27).
  return (
    <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
      {/* ⚠ NO `!panelOpen` GUARD ANY MORE (2026-09-08): the popover belongs to the chat textarea,
          and the textarea no longer goes anywhere. The condition it used to carry was about the
          INLINE panel unmounting the field under it — see the header. */}
      {mentions.query !== null && (
        <MentionPopover suggestions={mentions.suggestions} active={mentions.active} onPick={mentions.pick} />
      )}
      {/* WHO THIS DRAFT REACHES (2026-09-02, slice B10, Samuel's ruling) — `→ @handle`,
          `→ <the default responder>` or `→ nobody`, restated on every keystroke.
          ⚠ IT IS OUTSIDE THE CARD SINCE 2026-09-08, ABOVE IT AND HARD LEFT (Samuel: *"let's
          move this: → nobody to be outside the bar, above it, on the top left. instead of
          right."*). It began at the card's bottom-left, moved to the card's first row hard
          RIGHT on 2026-09-04, and is now a caption over the box rather than a row inside it —
          which is the shape that stops it reading as one of the toolbar's controls without
          spending a line of the card's own height. **Nothing else in the card moved up**: the
          card's first row is the chat field, exactly as it was.
          ⚠ THE ALIGNMENT IS THE COMPONENT'S OWN (`composer-recipients.tsx`, `justify-start`),
          not a wrapper here. This file states WHERE the line sits and nothing about how it
          draws, which is the same rule the send arrow's slot follows.
          ⚠ `px-0.5` MATCHES THE CARD'S OWN CONTENT INSET as closely as a caption outside a
          13px-padded box can — the tag's `→` is meant to hang over the card's left edge, not
          to line up with the field's first character.
          ⚠ IT IS UNCONDITIONAL SINCE 2026-09-08, with the panel that used to hide it. A thread
          form is a modal now: it states its own addressing behind a scrim, and there is always a
          chat draft on this card for this line to describe. */}
      <ComposerRecipients
        body={body}
        members={members}
        sessions={liveAgents}
        currentUserId={currentUserId}
        recentAgentIds={recentAgentIds}
        threadOtherParty={threadOtherParty}
      />
      {/* ⚠ THE CARD WEARS `.raised-tab` — THE WHOLE FACE THE AGENT PILL WEARS, VERBATIM (Samuel,
          live review 2026-08-27). Not `.bento`, and NOT an extracted layer of the raised recipe:
          a lone 1px ring lifted out of it read FLAT beside the agent bar's dimensional material,
          which was the miss. The class IS the shared source — `composer-input.tsx` gives the
          agent's row that same one — so "same material" cannot drift into "same-ish".
          ⚠ NO `bg-*`, EVER: `.raised-tab` supplies the gradient fill and the utility layer
          outranks the kit layer, so the old `bg-white` here would flatten it to a solid. Its
          bevel and drops replace `.bento`'s. ⚠ THE RADIUS IS THE CARD'S OWN — `.raised-tab` sets
          none and `.bento`'s 14px left with it, so `rounded-[14px]` restates it, unchanged.
          ⚠ THE 1px MOVED INTO THE PADDING AND THE BOX IS THE SAME BOX: `.bento` declared a real
          border, `.raised-tab` must sit on a BORDERLESS element (docs/DESIGN-SYSTEM.md), so
          `px-3 py-2.5` became `px-[13px] py-[11px]` — same outer size, same content position,
          same HEIGHT. Tidying these back to the scale values shrinks the card 2px.
          ⚠ AND STILL NO ROW GAP: a `gap-2` here once grew the card visibly. */}
      <div className="raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]">
        <div className="flex flex-col gap-2">

          <ComposerInputRow
            // ⚠ BARE: no ring, no fill, NO INSET AND NO SEND WIRING — the CARD is the box, it
            // pays that inset once (`px-[13px] py-[11px]`), and the arrow is in the toolbar row
            // below. Paying the inset twice sat the field 12px right of and 6px below those
            // icons (Samuel, live review 2026-08-28); both rows now start flush at the card's
            // content box. Row shape stays `composer-input.tsx › ROW_GEOMETRY`, unbranched.
            face="bare"
            value={draft}
            inputRef={draftRef}
            onChange={(next) => {
              setDraft(next);
              // A new token is a new shortlist — start at the top of it.
              mentions.setHighlight(0);
            }}
            // ⚠ THE HANDLER IS THE PICKER'S (`use-composer-mentions.ts › keyDown`, moved
            // there 2026-09-02 at the cap): four of its five branches are about the shortlist,
            // and what stays this file's is the one act it owns — send.
            onKeyDown={(e) => mentions.keyDown(e, submit)}
            placeholder="Write a message"
            ariaLabel="Message"
            highlight={tintDraft}
          />

          <ComposerToolbar
            newAgent={newAgent}
            launchOpen={launch.open}
            onToggleLaunch={launch.toggle}
            // ⚠ IT OPENS THE POPUP, IT DOES NOT TOGGLE A PANEL (2026-09-08). `launch.close()`
            // rides along so two forms never stand at once — the 2026-08-27 rule, kept.
            onNewThread={() => { launch.close(); setThreadDialogNonce((n) => n + 1); }}
            onMention={() => { mentions.openFromButton(); draftRef.current?.focus(); }}
            dictation={dictation}
            hasContent={body.length > 0}
            onClear={clear}
            submitHint={hint}
            submitDisabled={!canSend}
            onSubmit={submit}
          />

          {/* ⚠ A REFUSED LAUNCH IS SAID OUT LOUD, HERE, because nothing else
              will: main answering `{ok:false}` changes nothing on its side, so
              no push follows to explain the button that visibly did nothing
              (`use-agents-panel.ts › LAUNCH_REFUSALS`). `role="alert"` because
              it appears only AFTER the operator acted. */}
          {newAgent?.launchError && (
            <p role="alert" className="px-0.5 text-caption text-danger">
              {newAgent.launchError}
            </p>
          )}

          {/* ⚠ A CENTERED POPUP SINCE 2026-09-08 (Samuel: *"scrap that and unwire it from the
              text input bar … make it a pop up panel"*). The Bot icon's toggle and the launch
              lane are unchanged; what moved is WHERE the form is drawn — and with it the
              Discard/Launch pair and the foreign-template question, which is why neither is on
              this card any more. `composer-launch-panel.tsx` stays, unreferenced from here. */}
          {newAgent?.canLaunch && (
            <LaunchAgentDialog
              panel={launch}
              newAgent={newAgent}
              openThreadId={openThreadId ?? null}
              channelId={channelId}
              workspaceId={workspaceId}
              currentUserId={currentUserId}
              members={members}
            />
          )}

          {/* ⚠ THE ONLY THREAD FORM SINCE 2026-09-08 (Samuel: *"i want to make a pop up for the
              threads creation as well"*, then *"why wasn't that wired in"* about the glyph). BOTH
              openers land here — the Threads tab's nonce and this toolbar's — and their SUM is
              the signal, so neither can swallow the other's ask. It is a MODAL carrying its own
              Create; the WRITE is this composer's `fanOutThreads`, handed a finished draft. */}
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
