"use client";

/**
 * Channels v2 — the composer card, with the @-mention autocomplete floating
 * above its left edge and the "New thread" panel recessed inside it.
 *
 * ⚠ TWO SENDS, ONE BUTTON, AND THEY ARE DIFFERENT WRITES. With the panel CLOSED
 * Send posts a plain chat message (`intent:"chat"` — the wire value is
 * load-bearing, it is what tells the receiving side this reaches nobody's
 * agent). With the panel OPEN it raises a REQUEST: the title becomes the thread
 * title, every remaining pill becomes an addressee, and the fan-out writes one
 * `channel_tasks` row per pill (INVARIANTS §5 — a thread is one requester + one
 * target) which the transcript renders as ONE card
 * (`transcript.tsx › ThreadCardMessage`).
 *
 * ⚠ TWO SENDS, TWO EDIT SURFACES, AND ONLY ONE IS EVER SHOWING (Samuel, 2026-08-26: *"the user
 * will solely need to edit the new thread panel"*). The request's BODY used to be this chat
 * textarea wearing a "Describe the request" placeholder; it is now the panel's own Description
 * field (`use-thread-request.ts`), and the textarea is UNMOUNTED while a panel is open rather
 * than disabled — a greyed box under a form is still a box the eye has to rule out. ⚠ THE CHAT
 * DRAFT SURVIVES: `draft` is state here, not in the element.
 *
 * ⚠ N PILLS = N ADDRESSEES, AND ZERO PILLS IS NOT SENDABLE. "Broadcast" is not
 * a shape this product has. The button disables at zero as a courtesy; the
 * CONTRACT is `schema.ts › TaskFanOutSchema`, where an empty addressee list is
 * a 400 — a UI-only refusal would be a rule that exists until somebody writes a
 * second client.
 *
 * ⚠ THE BASE IDEMPOTENCY KEY IS MINTED HERE, at submit, exactly once per Send.
 * The server derives one key per addressee from it plus the group id the card
 * is drawn from, so a retry converges thread-by-thread instead of raising the
 * request twice (INVARIANTS §8).
 *
 * ⚠ THE BOT ICON AND THE THREAD PANEL ARE TWO CONTROLS SINCE 2026-08-21
 * (Samuel). One glyph used to mean both "start an agent" and "open the
 * thread-creation panel", which are not the same act and do not even hit the
 * same layer — the panel raises a REQUEST at another member over the write
 * layer; the Bot icon spawns MY OWN agent on THIS machine over the bridge, and
 * nothing is posted. **`MessageSquarePlus` ("New thread") now toggles the panel,
 * unchanged in every other respect, and `Bot` is New Agent.**
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
import { AgentRequestPanel } from "./composer-request-panel";
import { NewThreadDialog } from "./new-thread-dialog";
import { useThreadRequest } from "./use-thread-request";
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
import { composerSubmitState } from "./composer-submit-state";
import { useThreadWrites } from "../../hooks/use-thread-writes";
import { newClientMsgId } from "../../lib/optimistic-cache";
import type { ChannelMember } from "../../types";

/** ⚠ A STABLE EMPTY ARRAY, not `[]` at the call site: an agents prop that is a fresh object every
 *  render re-derives the whole @-picker shortlist on a surface that has no sessions read. */
const EMPTY_LIVE_AGENTS: readonly LiveAgentSession[] = [];
const EMPTY_RECENT: readonly string[] = [];

/** THE LAUNCH PANEL, AS `composerSubmitState` NOW SEES IT — permanently closed, and a DELIBERATE
 *  zero rather than a stub. The form is a modal with its own submit since 2026-09-08, so this
 *  control has TWO acts; deleting the shared function's `launch` arm would touch the thread
 *  panel's pins for a change that is only about this caller. */
const NO_LAUNCH = { open: false, ready: false, name: "", description: "" } as const;

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
  /** Nonced ask from the Threads tab to open the new-thread panel. ⚠ A COUNTER,
   *  not a boolean: the panel's state stays OWNED HERE, so there is no mirror to
   *  drift. Each increment is one request; the default is nobody asking. */
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
  // WHO THE NEW AGENT IS — the Bot icon's panel. ⚠ ONLY THE STATE lives here; the TEMPLATES read
  // is inside `ComposerLaunch`, which mounts only where a launch is possible (that component's
  // header says why).
  const launch = useAgentLaunch();

  // ⚠ `0`, NOT `newThreadSignal` (2026-09-08, Samuel: *"i want to make a pop up for the threads
  // creation as well"*). The Threads tab's "New thread" now opens {@link NewThreadDialog} at the
  // bottom of this file; the INLINE panel keeps its own opener — the toolbar's
  // `MessageSquarePlus` glyph — and nothing else reaches it. Two thread forms live until Samuel
  // rules on the glyph. The hook's signal arm is therefore dormant rather than deleted.
  const request = useThreadRequest({ members, currentUserId, newThreadSignal: 0 });
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
   * ONE CONTROL, THREE ACTS, ONE DERIVATION (`composer-submit-state.ts`). The launch panel lost
   * its own button for the reason the thread panel never had one: two submits on one card is two
   * answers to "what does pressing this do".
   *
   * ⚠ `sendState.panelOpen` IS READ BY FOUR SURFACES AND DERIVED BY NONE OF THEM — the submit's
   * face, the chat textarea's mount, the @-picker's popover and the `@` glyph that writes into
   * that textarea. Until 2026-08-28 three of the four re-spelled it inline, and THAT IS THE BUG
   * THIS SHAPE FIXES: the "one edit surface at a time" rule (2026-08-26) unmounts the textarea
   * while a panel is open, while the @-picker (2026-08-27) was gated on the DRAFT alone
   * (`mentionQuery`), which is state the unmount does not clear. A draft holding a half-typed
   * `@dia` therefore kept the popover floating over the panel with no field under it, and the
   * `@` glyph — writing its token into that same invisible draft, then focusing a null ref — was
   * a control whose only effect was to summon it. Two waves, one surface, neither asking what the
   * other did with the draft.
   * ⚠ THE DRAFT ITSELF IS UNTOUCHED, exactly as the unmount already left it: shutting the panel
   * brings back the half-typed message AND its popover, which is the state the operator left.
   */
  // ⚠ `NO_LAUNCH`, NOT `launch`: the dialog carries its own Launch, so feeding the panel's real
  // state in would put a SECOND one behind its scrim and unmount the textarea under a modal.
  const sendState = composerSubmitState({ pending, body, launch: NO_LAUNCH, request });
  const { canSend, panelOpen, hint } = sendState;

  const clear = () => {
    setDraft("");
    request.reset();
    launch.reset();
  };

  /**
   * ⚠ THE COMPOSER CLEARS BEFORE THE AWAIT and the drafts carry everything the
   * write needs — the optimistic layer owns the rollback, and re-reading state
   * after the round trip would read a composer the user has since typed into.
   */
  const submit = () => {
    if (!canSend) return;
    // ⚠ THE LAUNCH ARM IS GONE FROM HERE (2026-09-08). The dialog owns the three-step act and
    // the foreign-template question; this control sends and creates, and nothing else.
    if (request.open) {
      const fanOut = {
        channelId,
        clientMsgId: newClientMsgId(),
        title: request.title.trim(),
        // ⚠ THE PANEL'S DESCRIPTION, NOT THE CHAT DRAFT. The wire field is
        // still `body` — this changed which BOX the operator types it in, not
        // what `TaskFanOutSchema` receives.
        body: request.description.trim(),
        toUserIds: request.addressed.map((target) => target.id),
      };
      clear();
      fanOutThreads.mutate(fanOut);
      return;
    }
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
      {/* ⚠ `!panelOpen` IS PART OF THE CONDITION, NOT DECORATION — see the constant's note. The
          popover belongs to the chat textarea, which is not mounted while a panel is; without
          this it floats over the panel, anchored to a field that is not there. */}
      {!panelOpen && mentions.query !== null && (
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
          card's first row is the chat field (or a panel), exactly as it was.
          ⚠ THE ALIGNMENT IS THE COMPONENT'S OWN (`composer-recipients.tsx`, `justify-start`),
          not a wrapper here. This file states WHERE the line sits and nothing about how it
          draws, which is the same rule the send arrow's slot follows.
          ⚠ `px-0.5` MATCHES THE CARD'S OWN CONTENT INSET as closely as a caption outside a
          13px-padded box can — the tag's `→` is meant to hang over the card's left edge, not
          to line up with the field's first character.
          ⚠ ON THE SAME `!panelOpen` CONDITION THE CHAT FIELD ITSELF FOLLOWS. With a panel up
          there is no chat draft on screen, and a line reporting the reach of an invisible one
          would describe a message the operator is not writing — the same misfire the `@` glyph
          was gated for on 2026-08-28. A PANEL states its own addressing
          (`composer-request-panel.tsx › AgentRequestPanel`). */}
      {!panelOpen && (
        <ComposerRecipients
          body={body}
          members={members}
          sessions={liveAgents}
          currentUserId={currentUserId}
          recentAgentIds={recentAgentIds}
          threadOtherParty={threadOtherParty}
        />
      )}
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
        {/*
          Height animates through the grid-rows 0fr→1fr idiom rather than a
          measured pixel height: the panel's own content decides how far the
          card grows, and no layout number is hardcoded. `motion-reduce` snaps.
        */}
        {/* ⚠ TWO PANELS IN ONE SLOT, AND NEVER BOTH OPEN AT ONCE — the toggles close each other
            below. Same grid-rows 0fr→1fr idiom either way, so neither hardcodes a height. */}
        <div
          className={cn(
            "grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
            request.open ? "grid-rows-[1fr] opacity-100"
              : "grid-rows-[0fr] opacity-0"
          )}
        >
          <div className="overflow-hidden" inert={!request.open}>
            <div className="pb-2">
              <AgentRequestPanel
                targets={request.targets}
                removed={request.removed}
                title={request.title}
                description={request.description}
                onTitleChange={request.setTitle}
                onDescriptionChange={request.setDescription}
                onRemove={request.removeTarget}
                onDismiss={request.close}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">

          {/* ⚠ THE CHAT DRAFT IS NOT ON SCREEN WHILE THE PANEL IS. One edit
              surface at a time (Samuel, 2026-08-26) — the request's own
              description field is inside the panel, and a second box under it
              could only be the wrong one to type in. Unmounted, not disabled:
              `draft` is state up here, so the half-typed message comes back
              intact when the panel shuts.
              ⚠ EITHER PANEL (2026-08-27). The launch panel is the same kind of object in the
              same slot, and the two are mutually exclusive, so this is one condition and not a
              second rule that could disagree with the first — `panelOpen`, the SAME constant the
              submit face and the picker read, rather than a third spelling of it. */}
          {!panelOpen && (
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
          )}

          <ComposerToolbar
            newAgent={newAgent}
            launchOpen={launch.open}
            onToggleLaunch={() => { request.close(); launch.toggle(); }}
            requestOpen={request.open}
            onToggleRequest={() => { launch.close(); request.toggle(); }}
            panelOpen={panelOpen}
            onMention={() => { mentions.openFromButton(); draftRef.current?.focus(); }}
            dictation={dictation}
            hasContent={sendState.hasContent}
            onClear={clear}
            submitLabel={sendState.label}
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

          {/* ⚠ THE THREADS TAB'S "New thread" LANDS HERE SINCE 2026-09-08 (Samuel: *"i want to
              make a pop up for the threads creation as well"*). It is a MODAL, so it sits outside
              the card's flow and carries its own Create — the inline panel above still submits
              through this composer's Send, and the two never open together because only the
              toolbar glyph opens that one now. The WRITE is the same `fanOutThreads` either way:
              this hands the mutation a finished draft. */}
          <NewThreadDialog
            signal={newThreadSignal}
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
