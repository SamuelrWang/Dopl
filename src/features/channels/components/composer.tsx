"use client";

/**
 * Channels — the composer card, with the @-mention autocomplete floating
 * above its left edge.
 *
 * ⚠ ONE SEND, ONE ACT, SINCE 2026-09-08. This card posts a plain chat message
 * (`intent:"chat"` — the wire value tells the receiving side this reaches
 * nobody's agent) and does nothing else. **THREAD CREATION LEFT THE CARD:** both
 * entries — the Threads tab's "New thread" and this toolbar's
 * `MessageSquarePlus` glyph — open {@link NewThreadDialog}, a modal carrying its
 * own Create. The INLINE request panel and `use-thread-request.ts` are DELETED
 * rather than disarmed (Samuel, 2026-09-08: *"look there is an icon in the text
 * input bar that is supposed to spawn new threads. Why wasn't that wired in"*).
 *
 * ⚠ TWO SOURCES, ONE DIALOG, AND THEY ARE ADDED. `newThreadSignal` is the
 * Threads tab's nonce and `threadDialogNonce` is this glyph's; their SUM is what
 * the dialog watches, so neither source can shut the other's.
 *
 * ⚠ THE CHAT TEXTAREA IS ALWAYS MOUNTED NOW. "One edit surface at a time"
 * (Samuel, 2026-08-26) unmounted it because the request form stood ON this card;
 * a dialog draws its own scrim. **Nothing on this card branches on a panel any
 * more** — `panelOpen`, its unmounts and `composer-submit-state.ts`'s three-act
 * derivation went with the panel, and the submit has one face.
 *
 * ⚠ THE FAN-OUT WRITE IS STILL THIS FILE'S. `fanOutThreads` lives here and the
 * dialog is its CALLER — one `channel_tasks` row per addressee (INVARIANTS §5 —
 * a thread is one requester + one target) rendered as ONE card
 * (`transcript.tsx › ThreadCardMessage`), base idempotency key minted at the
 * press inside the dialog (§8).
 *
 * ⚠ THE BOT ICON AND THE THREAD GLYPH ARE TWO CONTROLS SINCE 2026-08-21
 * (Samuel) — different layers: a thread raises a REQUEST at another member over
 * the write layer; the Bot icon spawns MY OWN agent over the bridge, posting
 * nothing. It is CONTEXT-SENSITIVE, taking its target from the OPEN THREAD
 * (channel view = `taskId: null`), on the same op, hook and refusal copy as the
 * Agents tab's button — a second BUTTON, never a second launch path.
 */

import { useRef, useState, type ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { cn } from "@/shared/lib/utils";
import { COMPOSER_BOTTOM, ComposerInputRow } from "./composer-input";
import { ComposerToolbar } from "./composer-toolbar";
import { NewThreadDialog } from "./new-thread-dialog";
import { MentionPopover } from "./composer-mentions";
import { ComposerRecipients } from "./composer-recipients";
// ⚠ THE SAME RULE THE LINE DRAWS, ASKED ONCE MORE AT SEND TIME — see `autoTag`.
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

/** ⚠ A STABLE EMPTY ARRAY, not `[]` at the call site: an agents prop that is a fresh object every
 *  render re-derives the whole @-picker shortlist on a surface that has no sessions read. */
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
   * handed down. ⚠ ABSENT MEANS NO BUTTON, not a dead one — the feature-detected
   * rule every bridge affordance in this family follows (INVARIANTS §11).
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
   * The peer projection the Agents tab already polls (`use-channel-agent-sessions.ts`), the same
   * set the server resolves a person's `to=` against. Empty where a surface has no sessions read.
   */
  liveAgents?: readonly LiveAgentSession[];
  /** **MY OWN AGENTS MID-TURN**, drawn at the END of the recipient line since
   *  2026-09-20 (Samuel: *"put agents working to the right"*). ⚠ A NODE BUILT BY
   *  `channel-surface.tsx` — it was its own band above this card, under a
   *  hairline; both are gone. This card states WHERE it sits, never what it says. */
  working?: ReactNode;
  // ⚠ **`defaultResponderAgentName` IS GONE FROM THIS PROP CHAIN (2026-09-07, items 10 and
  // 11).** The question is PER MEMBER now, so `ComposerRecipients` reads it off the VIEWER'S OWN
  // roster row and no host has to remember to hand it over.
  /** RR3 arm 3's input — the room's recent agent posters, newest first. */
  recentAgentIds?: readonly string[];
  /** RR1's answer for a thread composer: the exchange's OTHER party. `null` in the main room. */
  threadOtherParty?: ChannelMember | null;
}) {
  const [draft, setDraft] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  // AUTO-GROW to three visible lines, then scroll (Samuel, 2026-08-20 — the second line was
  // clipping invisibly at rows={1}). ⚠ SHARED VIA `use-auto-grow.ts` SINCE 2026-08-27, so the
  // panels' Description fields cannot grow to a different ceiling.
  useAutoGrow(draftRef, draft);
  // WHO THE NEW AGENT IS — the Bot icon's form. ⚠ ONLY THE STATE lives here; the dialog that
  // draws it is `launch-agent-dialog.tsx`, mounted only where a launch is possible.
  const launch = useAgentLaunch();
  // ⚠ THE TOOLBAR GLYPH'S OWN NONCE (Samuel, 2026-09-08: *"there is an icon in the text input bar
  // that is supposed to spawn new threads"*), ADDED to the Threads tab's signal below.
  const [threadDialogNonce, setThreadDialogNonce] = useState(0);
  const { send, fanOutThreads, pending } = useThreadWrites({
    workspaceId,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    gate,
  });

  /**
   * **ESCAPE DECLINED THE DEFAULT ADDRESS FOR THIS DRAFT** (Samuel, 2026-09-20).
   *
   * ⚠ **IT IS PER MESSAGE AND IT IS NOT A SETTING.** `channel_members
   * .unaddressed_responder = "none"` is the standing opt-out and lives in
   * Settings; this is one keystroke about one draft, cleared on send. Conflating
   * them would let a reflex turn the feature off for good.
   */
  const [addressOff, setAddressOff] = useState(false);

  // THE @-PICKER — `use-composer-mentions.ts` (the §1 split at the cap, 2026-08-27).
  const mentions = useComposerMentions({ draft, setDraft, members, sessions: liveAgents, currentUserId });

  /**
   * THE TINT (2026-09-07, Samuel: blue = *"will route to an agent"*) — the SAME question
   * `ComposerRecipients` answers in words one row down, asked per token. Same roster, same live
   * agents, same index (`lib/draft-recipients.ts › draftAgentIndex`), so the line and the colour
   * cannot disagree. The RULE is `composer-tint.tsx`'s.
   *
   * ⚠ **NAMED HERE RATHER THAN INLINED AT THE PROP, AND NOT FOR TIDINESS.**
   * `composer-input.test.ts` pins the bare mount by matching `<ComposerInputRow …/>` up to the
   * FIRST `/>`, so a self-closing element inside that JSX would truncate the slice it reads.
   */
  const tintDraft = (value: string) => (
    <ComposerTint text={value} members={members} sessions={liveAgents} />
  );

  /**
   * DICTATION — the Mic glyph's engine (`use-dictation.ts`, which owns every rule about it).
   *
   * ⚠ IT ONLY EVER APPENDS, WHICH IS WHAT MAKES "the text stays" TRUE BY CONSTRUCTION — no stop
   * path anywhere can clear the draft.
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
   * ⚠ `composer-submit-state.ts` IS DELETED, NOT STUBBED: both forms are modals with their own
   * submit now, so "which of the three acts is this press" has one answer.
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
    // ⚠ THE LAUNCH AND REQUEST ARMS ARE BOTH GONE FROM HERE (2026-09-08) — each dialog owns its
    // own act and its own submit.
    /**
     * 🔒 **AN AUTO-ADDRESS IS WRITTEN INTO THE MESSAGE, AS A REAL TAG** (Samuel,
     * 2026-09-20: *"if a user sends a message but didn't tag, but it has an auto
     * address agent resolved, can we make it so that a tag is put in the text,
     * before their message, and it just gets auto added? That way it makes it
     * more clear too who it sent to, and we can consolidate to one surface"*).
     *
     * ⚠ **IT REPLACES THE GREY ARROW UNDER THE BADGE, IT DOES NOT JOIN IT.** The
     * transcript used to FACE a server pick as chrome under the pill
     * (`authored-row.tsx › routedTo`, deleted the same day) precisely because the
     * body could not be touched. Writing the tag HERE, before the post leaves,
     * makes the address a thing the author sent rather than a thing the server
     * reports — one surface, and the same words in the notification, the MCP read
     * and the quote.
     * ⚠ **AND IT IS NOT A BODY REWRITE.** The old rule — *the stored body is never
     * touched, a rewrite would put words in somebody's mouth* — is about the
     * SERVER editing a post at rest. Nothing edits anything at rest: the draft
     * gains the tag in the composer, on this machine, from the line the author is
     * already reading, and Escape declines it.
     * ⚠ **SO THE SERVER SEES A TYPED ADDRESS AND RR3 NEVER RUNS FOR THIS POST.**
     * That is the consolidation: one path (a named agent), one stored shape, and
     * `metadata.wake_reason` stays empty because nobody guessed.
     * ⚠ **AGENTS ONLY, AND `responder` ONLY.** RR1's thread party is a MEMBER and
     * is the thread's own address, not a default — there is no handle to insert
     * and nothing to cancel.
     */
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
      // ⚠ EXPLICIT, never omitted. Absence reads as `request` on the wire
      // (`schema.ts › MessageIntentSchema`), and the plain composer is human chat.
      intent: "chat" as const,
      // ⚠ **ONLY EVER `false`, AND ONLY WHEN THE AUTHOR PRESSED ESCAPE.** Absent
      // is the wire's default and every other client's behaviour; sending `true`
      // would be asking for a repair this composer has just done itself.
      ...(addressOff ? { autoAddress: false as const } : {}),
    };
    clear();
    // ⚠ **THE CANCEL IS FOR ONE MESSAGE** (*"esc just removes it for that message
    // currently"*). Cleared with the draft, so the next message starts from the
    // default again — and addressing an agent by hand meanwhile simply moves what
    // that default resolves to.
    setAddressOff(false);
    send.mutate(message);
  };

  // ⚠ THE BOTTOM OFFSET IS `COMPOSER_BOTTOM`, shared with the agent composer: the two boxes sit
  // side by side across the pane divider and any difference reads as one floating higher than the
  // other (Samuel, live review 2026-08-27).
  return (
    <div className={cn("relative shrink-0 px-4 pt-1", COMPOSER_BOTTOM)}>
      {/* ⚠ NO `!panelOpen` GUARD ANY MORE (2026-09-08): the popover belongs to the chat textarea,
          and the textarea no longer goes anywhere. */}
      {mentions.query !== null && (
        <MentionPopover suggestions={mentions.suggestions} active={mentions.active} onPick={mentions.pick} />
      )}
      {/* WHO THIS DRAFT REACHES (2026-09-02, slice B10, Samuel's ruling) — `→ @handle`,
          `→ <the default responder>` or `→ nobody`, restated on every keystroke.
          ⚠ OUTSIDE THE CARD SINCE 2026-09-08, ABOVE IT AND HARD LEFT (Samuel: *"let's move
          this: → nobody to be outside the bar, above it, on the top left. instead of right."*)
          — a caption over the box, so it stops reading as a toolbar control without spending a
          line of the card's height. **Nothing else in the card moved up.**
          ⚠ THE ALIGNMENT IS THE COMPONENT'S OWN (`composer-recipients.tsx`, `justify-start`),
          not a wrapper here: this file states WHERE the line sits, never how it draws.
          ⚠ `px-0.5` MATCHES THE CARD'S OWN CONTENT INSET as closely as a caption outside a
          13px-padded box can — the tag's `→` hangs over the card's left edge.
          ⚠ UNCONDITIONAL SINCE 2026-09-08, with the panel that used to hide it: a thread form is
          a modal stating its own addressing behind a scrim. */}
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
      {/* ⚠ THE CARD WEARS THE WHOLE FACE THE AGENT PILL WEARS, VERBATIM (Samuel, live review
          2026-08-27) — not `.bento`, and not an extracted layer of it: a lone 1px ring read FLAT
          beside the agent bar's dimensional material. The class IS the shared source.
          ⚠ NO `bg-*`, EVER: the kit supplies the gradient fill and a utility would flatten it to
          a solid. ⚠ THE RADIUS IS THE CARD'S OWN — the kit sets none, so `rounded-[14px]`
          restates `.bento`'s, unchanged.
          ⚠ THE 1px MOVED INTO THE PADDING AND THE BOX IS THE SAME BOX: the face must sit on a
          BORDERLESS element (docs/DESIGN-SYSTEM.md), so `px-3 py-2.5` became `px-[13px]
          py-[11px]` — same outer size, same content position, same HEIGHT. Tidying these back to
          the scale values shrinks the card 2px.
          ⚠ AND STILL NO ROW GAP: a `gap-2` here once grew the card visibly. */}
      <div className="raised-tab flex flex-col rounded-[14px] px-[13px] py-[11px]">
        <div className="flex flex-col gap-2">

          <ComposerInputRow
            // ⚠ BARE: no ring, no fill, NO INSET AND NO SEND WIRING — the CARD is the box and
            // pays that inset once, and the arrow is in the toolbar row below. Paying it twice
            // sat the field 12px right of and 6px below those icons (Samuel, live review
            // 2026-08-28). Row shape stays `composer-input.tsx › ROW_GEOMETRY`, unbranched.
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
            onKeyDown={(e) => {
              // ⚠ **ESCAPE IS THIS ROW'S ONLY NEW KEY, AND IT IS READ BEFORE THE
              // PICKER'S HANDLER** — which ignores it, so nothing is intercepted.
              // ⚠ IME-SAFE for `keyDown`'s own reason: a composition Escape is
              // the input method cancelling a candidate, not the author
              // declining an address.
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

          {/* ⚠ A REFUSED LAUNCH IS SAID OUT LOUD HERE because nothing else will: main answering
              `{ok:false}` pushes nothing to explain the button that visibly did nothing
              (`use-agents-panel.ts › LAUNCH_REFUSALS`). `role="alert"` because it appears only
              AFTER the operator acted. */}
          {newAgent?.launchError && (
            <p role="alert" className="px-0.5 text-caption text-danger">
              {newAgent.launchError}
            </p>
          )}

          {/* ⚠ A CENTERED POPUP SINCE 2026-09-08 (Samuel: *"scrap that and unwire it from the
              text input bar … make it a pop up panel"*). Only WHERE the form is drawn moved —
              taking the Discard/Launch pair and the foreign-identity question off this card.
              `composer-launch-panel.tsx` stays, unreferenced from here. */}
          {newAgent?.canLaunch && (
            <LaunchAgentDialog
              panel={launch}
              newAgent={newAgent}
              /* ⚠ **THE TAKEN SET, OFF THE SET THIS CARD ALREADY HOLDS** (2026-09-13;
                 docs/specs/agent-colors.md item 7). `liveAgents` is `lib/live-agents.ts ›
                 liveAgentsKey`'s peer ∪ own union — the same rows the @-picker, the recipient
                 line and the tint read — so the circles answer the same question the composer's
                 other three surfaces do, one push later than nothing. ⚠ **THE UNION, NOT
                 `peerSessions`**: a colour is unique across members AND across this operator's
                 own agents, and the projection alone lags a launch by up to a 30s poll (the bug
                 that union exists to fix). ⚠ Its rows carry NO `state` because that function has
                 already dropped every ended one; `agentColorsTaken` reads an absent state as
                 LIVE, which is the same answer. */
              liveSessions={liveAgents}
              openThreadId={openThreadId ?? null}
              channelId={channelId}
              workspaceId={workspaceId}
              currentUserId={currentUserId}
              members={members}
            />
          )}

          {/* ⚠ THE ONLY THREAD FORM SINCE 2026-09-08 (Samuel: *"i want to make a pop up for the
              threads creation as well"*, then *"why wasn't that wired in"* about the glyph). Both
              openers land here and their SUM is the signal, so neither swallows the other's ask.
              A MODAL carrying its own Create; the WRITE is this composer's `fanOutThreads`. */}
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
