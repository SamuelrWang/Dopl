"use client";

/**
 * Channels — THE OUTBOUND REVIEW CARD.
 *
 * ⚠ ITS OWN FILE by §1's "one file, one reason to change". This card moves when the OUTBOUND CONSENT product moves (§6) —
 * it has already gained a Pending face, a decision and an expiry rule, and it is
 * the ONLY review surface left now the consent inbox is deleted — where
 * `agent-stream.tsx` moves when a STREAM ROW's shape moves. It is re-exported from
 * that file, the import path its callers use.
 */

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { agentColorVar } from "../lib/agent-colors";
import type { RecipientTag } from "../lib/recipient-tags";
import { AGENT_PILL_SHAPE } from "./agent-bits";
import type { PostDestination } from "./agents-model";
import { StreamProse } from "./agent-stream-prose";
import type { AgentColorKey } from "../types";
import { TAB_ACTION } from "./bits";
import { useOverflowMeasure } from "./use-overflow-measure";

/**
 * WHAT THE BANNER SAYS BEFORE A POST HAS LEFT THE MACHINE, and what it says when
 * it never will (Samuel, 2026-08-25). ⚠ Exported for the tests: "Pending" and
 * "Posted to channel" over the same box are opposite claims about whether the
 * counterparty has read something, which is the failure this card was built to
 * stop.
 */
export const POST_PENDING_LABEL = "Pending";
export const POST_NOT_SENT_LABEL = "Not sent";
export const POST_ACTION_LABEL = "Post";

/** The collapse control's two faces. ⚠ THE LOG LANE'S WORDS, DELIBERATELY
 *  (`agent-stream-log.tsx` › `LogLine`): one stream, one verb for "there is more
 *  of this than you are being shown". Exported for the tests. */
export const POST_EXPAND_LABEL = "Show more";
export const POST_COLLAPSE_LABEL = "Show less";

/**
 * **WHAT THE SETTLED BANNER SAYS — THE PLACE, BY NAME (Samuel, 2026-09-16)**: *"these
 * currently say, posted to channel. I want it to say the name of the channel, or the
 * thread, that it is posted to. Aka, Posted to Dopl channel. Or, posted to Yada Yada
 * thread."*
 *
 * ⚠ **"Sent to <thread>" IS GONE, AND THAT IS THE RULING, NOT A TIDY-UP.** The card had
 * TWO verbs for one event — `Sent to Alpha audit` for a thread and `Posted to channel`
 * for the room — so the same delivery read as two different kinds of thing depending on
 * where the agent happened to be launched. One verb, one shape, the place named in both.
 * ⚠ **THE BARE NOUN IS THE FALLBACK AND IT IS NEVER A BLANK** (INVARIANTS §11). An older
 * main reports no `channelName`, and `Posted to  channel` with a hole in it is the one
 * output this must not produce — so an absent name drops the slot rather than filling it.
 * ⚠ **THE KIND STILL COMES THROUGH WHEN THE NAME DOES NOT**, which is why the fallback has
 * two spellings: *"Posted to thread"* is a true statement about a thread-scoped agent
 * whose title did not arrive, and calling it the channel would be a wrong one.
 * ⚠ **NO ESCAPING HERE, DELIBERATELY.** The name is rendered as a React TEXT CHILD, which
 * is the same neutralisation every other name render in this tree relies on
 * (`message-pane-header.tsx` prints `threadTitle ?? channelName` the same way); the banner
 * is a single `truncate` line, so a name carrying newlines cannot forge a second one.
 * Exported for the tests, beside the three faces it is the fourth of.
 */
export function postedToLabel(to: PostDestination | null | undefined): string {
  const kind = to?.kind ?? "channel";
  const name = to?.name?.trim();
  return name ? `Posted to ${name} ${kind}` : `Posted to ${kind}`;
}

/**
 * HOW MUCH OF A POSTED BODY SHOWS BEFORE THE OPERATOR ASKS FOR THE REST
 * (task 10, #1058/#1059).
 *
 * ⚠ THE CLAMP IS A HEIGHT, NOT A SLICE, and that is the whole difference between
 * this lane and the log's. `agent-stream-prose.tsx` rule 4 states it: the body is
 * MARKDOWN, a slice cuts a fence or a link mid-token and renders the wreckage,
 * and `line-clamp` is a `-webkit-box` rule that does not clamp a container of
 * sibling blocks. Bounding the CONTAINER touches neither the string nor the
 * renderer — every character is still in the DOM and one press shows it.
 */
const COLLAPSED_BODY_LINES = 6;

/**
 * **THE BANNER'S GEOMETRY** — the dark strip across the top of this card.
 *
 * ⚠ **THIS FILE'S OWN, SHARED WITH NOTHING:** the transcript's agent accent is a 3px side bar
 * and a ringed pill (Samuel, 2026-09-14), which shares no geometry with a full-width banner.
 *
 * ⚠ **AND THIS CARD IS DELIBERATELY *NOT* RESTYLED TO FOLLOW** (measured, not assumed). The
 * restyle is a rule about a TRANSCRIPT ROW: it needs a side because a row has one, and it
 * rings the attribution PILL. This card is a delivery RECORD in the agent's own stream — full
 * stream width by ruling, no side, no pill, no author to attribute — so a ringed pill and an
 * outer-edge bar have nothing here to attach to. What Samuel's ruling item 5 gave it is the
 * COLOUR, and the colour is unchanged.
 */
const AGENT_BAR = "flex items-center gap-1.5 px-2.5 py-[5px]";

/**
 * **WHO THE POST WAS ADDRESSED TO, AS A PILL ON THE BANNER** (Samuel, 2026-10-10, #3081:
 * *black pill(s) naming who the post was addressed to*).
 *
 * ⚠ **IT IS {@link AGENT_PILL_SHAPE} WITH ITS OWN INK, AND THE FILL IS WHY.** The black pill
 * Samuel named is `agent-bits.tsx › AGENT_PILL_FACE`, and this banner is ALREADY
 * `--surface-cta` — or, once a post has settled, the agent's own colour, which is a dark ramp
 * (L 0.44). The black pill drawn there is black on black: the shape asked for, rendered
 * unreadable. So the GEOMETRY is the one shared recipe and the fill is a translucent lift of
 * the banner's own ink, which reads on the CTA face and on all sixteen colour keys without a
 * second rule per hue.
 * ⚠ **`text-on-cta` IS ALREADY THE PROVEN INK HERE.** The label and the timestamp beside it
 * wear it on both faces (`AgentPill.color`'s note: the ramp is dark enough that one ink
 * serves), so the pill borrows the contrast decision rather than making a new one.
 * ⚠ **IT MAY SHRINK**, and three addressees on a 380px panel have to: the override is the one
 * `agent-bits.tsx › AGENT_PILL_SHAPE` rules, where the whole argument is stated once.
 */
const BANNER_PILL = cn(
  AGENT_PILL_SHAPE,
  "flex min-w-0 shrink items-center bg-text-on-cta/20 text-text-on-cta"
);

/**
 * THE ADDRESSEE PILLS, IN ORDER. ⚠ EMPTY DRAWS NOTHING — never a marker, never an "unaddressed"
 * word. A post with no addressee is the ordinary case for a channel-wide message and for a
 * `record`, and a frame-backed echo has no addressee to read at all (`agent-stream-model.ts ›
 * StreamItem.tagUserIds`); all three are silence rather than a claim.
 * ⚠ **FACES ONLY, RESOLVED UPSTREAM.** `lib/recipient-tags.ts` owns the resolution so a raw agent
 * id can never reach this surface (`agent-id-visibility.test.ts`), and the face is rendered as a
 * React TEXT CHILD on a `truncate` line — the one neutralisation every name render here relies on.
 */
function BannerTags({ tags }: { tags: readonly RecipientTag[] }) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((tag) => (
        <span
          key={`${tag.kind}:${tag.id}`}
          title={tag.title === tag.face ? undefined : tag.title}
          /* The transcript's own tag row carries the same hook, so one test vocabulary covers
             both panes' answer to "who did this post address". */
          data-recipient-tag={tag.kind}
          className={BANNER_PILL}
        >
          <span className="truncate">{tag.face}</span>
        </span>
      ))}
    </>
  );
}

/**
 * ⚠ READ IN `em`, AGAINST `text-caption`, SO A TOKEN CHANGE MOVES THE CLAMP WITH
 * IT. The clip box below carries `text-caption`, so `1em` is
 * `--text-caption` (11.5px today) rather than whatever the card inherits; `1.5`
 * is `leading-normal` from the body's own `textClassName`, and the `18px` is
 * `StreamProse`'s `py-[9px]` top and bottom. Change either of those two on the
 * body and change them here — that pairing is why the numbers are spelled out
 * instead of being one magic pixel count.
 */
const COLLAPSED_BODY_MAX_HEIGHT = `calc(${COLLAPSED_BODY_LINES} * 1.5em + 18px)`;

/**
 * THE BODY, BOUNDED — and the control appears ONLY on a card that is actually
 * taller than the bound (#1059, in those words).
 *
 * ⚠ THE MEASUREMENT IS `use-overflow-measure.ts`, SHARED WITH THE ARTIFACT CARD
 * (extracted 2026-09-06; the two were byte-identical copies). Why it measures at
 * all rather than reading the CSS, why the observer watches the inner content,
 * and why it runs only while collapsed are all recorded there. This card keeps
 * its own constants, its own labels and its own clip-box markup.
 *
 * ⚠ `text` IS THIS CARD'S RE-MEASURE TRIGGER, and it is deliberately NOT the
 * artifact card's `members.length`: the `post` frame is pushed as the agent calls
 * the tool and this body GROWS while it streams, so a one-shot measure on mount
 * would leave the control missing on exactly the long cards it exists for. It
 * also re-measures where `ResizeObserver` is absent (jsdom, old hosts).
 *
 * ⚠ `collapsible` IS THE HOOK'S `enabled`: a body still under review is rendered
 * whole and asks nothing.
 *
 * ⚠ IT WRAPS `StreamProse`, IT DOES NOT REACH INTO IT (Samuel, 2026-08-31): same
 * renderer, same props, same string as the transcript one pane over. The banner,
 * the four faces, the Post button and the expiry rule are untouched — the §6 seam
 * this card owns does not move for a render bound.
 */
function SentBody({ text, collapsible }: { text: string; collapsible: boolean }) {
  const {
    open,
    setOpen,
    overflows,
    clipRef,
    contentRef,
    boxId: bodyId,
  } = useOverflowMeasure({ enabled: collapsible, remeasureOn: text });

  const prose = (
    <StreamProse
      text={text}
      className="px-3 py-[9px]"
      textClassName="text-caption leading-normal text-text-primary"
    />
  );
  if (!collapsible) return prose;

  return (
    <>
      <div
        ref={clipRef}
        id={bodyId}
        className="min-w-0 overflow-hidden text-caption"
        style={open ? undefined : { maxHeight: COLLAPSED_BODY_MAX_HEIGHT }}
      >
        <div ref={contentRef}>{prose}</div>
      </div>
      {overflows && (
        <div className="flex px-3 pb-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="text-micro font-medium text-link"
          >
            {open ? POST_COLLAPSE_LABEL : POST_EXPAND_LABEL}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * WHAT THE AGENT POSTED INTO THE CHANNEL — **the v1 session window's outbound
 * record, recovered.**
 *
 * ⚠ PROVENANCE: v1's `.outbound` rules + `makeOutbound` (deleted with the session window in
 * `db901c39`; `git show 'db901c39^:dopl-desktop-app/renderer/session/session.css'`). An
 * ADAPTATION: v1's geometry, banner idea and label wording, with every colour from the
 * current token set (docs/DESIGN-SYSTEM.md).
 *
 * ⚠ WHAT WAS KEPT, and why each part earned its way back:
 *   - **Full stream width, not a chat bubble.** v1's own comment: "a delivery
 *     RECORD, not a conversational turn, so it spans the full stream width like a
 *     tool card". That is exactly the distinction this stream needs.
 *   - **The dark CTA banner.** `--surface-cta` reads as a HEADER, which is what
 *     stops the box being mistaken for another log line.
 *   - **`border-active` + `card-surface-subtle`**, radius 12, and a `pre-wrap`
 *     body that breaks anywhere — a posted body is somebody's real words and must
 *     wrap rather than escape the column.
 *   - **The label says where it went** (v1 › `outboundLabel`), and the timestamp rides in
 *     the banner's trailing tag. ⚠ THE WORDING IS {@link postedToLabel}'S SINCE 2026-09-16:
 *     v1's two verbs ("Sent to <thread>" / "Posted to channel") are one, and the PLACE is
 *     named in both cases.
 *
 * ── ⚠ v1'S PENDING FACE IS BACK, AND SO IS THE DECISION (Samuel, 2026-08-25) ──
 *
 * The pending face exists because the work stream's `post` frame is pushed the moment the
 * agent CALLS the tool — before the outbound consent gate has been answered, and
 * whether or not it ever will be — without it a held draft would read "Posted to
 * channel" over words the counterparty had not seen and might never see.
 *
 * ⚠ THE CARD IS NOW THE REVIEW SURFACE, AND IT IS THE ONLY ONE. The separate
 * consent INBOX is deleted (INVARIANTS §6): a solo /home channel never had a way
 * to reach it, so a pending post there dead-ended forever. The gate is unchanged
 * — the post still queues as a `channel_consent_requests` row and still needs a
 * human — the review just happens where the operator is already looking.
 *
 * ⚠ ONE BUTTON, AND IT IS "Post" (Samuel's ruling, in those words). There is no
 * Deny here and one must not be added: the only other exit is the row's own 24h
 * expiry, and an expired draft renders as {@link POST_NOT_SENT_LABEL} with
 * nothing to press, which is the truth rather than a second verb.
 *
 * ⚠ **{@link POST_NOT_SENT_LABEL} IS THE NARROWEST FACE HERE, NOT THE FALLBACK
 * (corrected 2026-08-25 — Samuel saw it over a post that had DEMONSTRABLY been
 * delivered).** It requires a real consent row past its own TTL. Everything else
 * this card cannot explain — a Post whose delivery is still in flight, a row
 * decided on another surface, a body-join that missed — reads as
 * {@link POST_PENDING_LABEL} with no button, because "I do not know yet" and "it
 * failed" are different facts and only one of them makes an operator re-send.
 */
export function SentToChannelBox({
  text,
  to,
  at,
  tags = [],
  pending = false,
  requestId,
  expired = false,
  onPost,
  busy = false,
  color = null,
}: {
  text: string;
  /**
   * **WHO THIS POST WAS ADDRESSED TO** — already-resolved faces, agents and people
   * (Samuel, 2026-10-10, #3081). See {@link BannerTags}.
   *
   * ⚠ **`[]` IS THE DEFAULT AND DRAWS NOTHING**, which keeps every existing caller
   * byte-identical: an unaddressed post, a `record`, and a narration echo that has no
   * addressee to read all render the banner exactly as they did before this prop existed.
   * ⚠ **FACES, NEVER IDS** — the resolution is `lib/recipient-tags.ts`'s, done by the host
   * that holds the roster, because an agent id is never printed at a person on this surface.
   */
  tags?: readonly RecipientTag[];
  /** WHERE IT WENT — see {@link postedToLabel}. `null` is "cannot say", which reads as
   *  the bare noun and never as a blank. */
  to?: PostDestination | null;
  /** Epoch ms. `0` means the stamp was unreadable — the tag drops rather than
   *  printing an epoch date at somebody. */
  at?: number;
  /** This post has NOT gone out — the outbound gate is holding it. */
  pending?: boolean;
  /** The consent row the button decides; `null` = nothing decidable matched. */
  requestId?: string | null;
  /**
   * This draft's row is past its TTL and nothing will ever post it.
   *
   * ⚠ IT IS A SEPARATE FLAG FROM `!requestId` ON PURPOSE, and that separation IS
   * the 2026-08-25 fix. The card used to read "no row matched" as failure, which
   * is also true of the seconds between a Post and the desktop's poll delivering
   * it — so an operator who had just approved a reply was told it was not sent,
   * the one wrong direction (they send it again). **Absence is unknown; only a
   * dead row is failure.**
   */
  expired?: boolean;
  onPost?: (requestId: string) => void;
  busy?: boolean;
  /**
   * **THIS AGENT'S COLOUR, FOR THE SETTLED BANNER ONLY** (Samuel, 2026-09-13;
   * docs/specs/agent-colors.md item 5).
   *
   * ⚠ **AND ONLY WHEN THE POST HAS ACTUALLY GONE OUT — see the branch below.** Every
   * argument in this file's docblock about the four faces is an argument about not painting
   * a claim the words have not earned, and the agent's colour is precisely the claim *"this
   * is in the channel, attributed to me"*: it is what the boxed row in the transcript wears.
   * A Pending or Not-sent draft is not in any transcript, so colouring it would make the
   * review card the one surface that shows a post's public identity before the post is
   * public.
   *
   * ⚠ `null` KEEPS `--surface-cta`, the face this banner has always had, which is what
   * every host with no colour in hand renders.
   */
  color?: AgentColorKey | null;
}) {
  // ⚠ THE FACES ARE ORDERED BY WHAT THEY CLAIM, strongest claim last. Only the
  // final one asserts the counterparty has it, and it is reachable ONLY once the
  // words are in the channel (`agent-stream-model.ts` clears `pending` then).
  const canPost = pending && !!requestId && !!onPost && !expired;
  const label = pending
    ? expired
      ? POST_NOT_SENT_LABEL
      : POST_PENDING_LABEL
    : postedToLabel(to);
  const stamp = at ? formatChannelTimestamp(new Date(at).toISOString()) : "";
  /* ⚠ **THE COLOUR IS GATED ON `!pending`, NOT ON `color` ALONE** — see the prop. That is
     the same boundary `label` above is drawn on, and it is drawn twice on purpose: a face
     and a fill that could disagree about whether a post is settled is the exact defect this
     card was rebuilt to stop (the 2026-08-25 "Posted to channel over words nobody had seen"
     entry in this file's docblock). ⚠ AND IT IS THE PILL'S PAINT ROUTE, NOT A SECOND ONE:
     `lib/agent-colors.ts › agentColorVar` is the only place a key becomes a `var()`. */
  const paint = !pending && color ? agentColorVar(color) : null;
  return (
    <div className="min-w-0 overflow-hidden rounded-[12px] border border-border-active bg-card-surface-subtle">
      {/* ⚠ THE CTA FILL STAYS AS A CLASS and the colour arrives as an inline `style`, so
          the uncoloured face is byte-identical to what shipped before the colours wave.
          ⚠ {@link AGENT_BAR} IS THIS FILE'S AGAIN since 2026-09-14 — read its note for why
          this banner did NOT follow the transcript's restyle. */}
      <div className={cn(AGENT_BAR, !paint && "bg-surface-cta")} style={paint ? { backgroundColor: paint } : undefined}>
        <span className="min-w-0 truncate text-micro font-medium text-text-on-cta">
          {label}
        </span>
        {/* ⚠ AFTER THE LABEL, BEFORE THE STAMP — the banner reads left to right as *what
            happened*, *to whom*, *when*, and the stamp keeps its `ml-auto` trailing slot.
            ⚠ **THIS COMPONENT NEVER GATES THE PILLS ON `pending`** — *who this is addressed
            to* is a fact about the draft the operator is deciding on, not a claim that it was
            delivered, unlike the agent's colour, which `paint` gates on `!pending` for
            exactly that reason.
            🔴 **BUT NO PENDING BOX CAN ACTUALLY SHOW ANY, AND THE NOTE USED TO CLAIM THE
            OPPOSITE** ("the pills show on every face, Pending included" — corrected in the
            2026-10-11 release review). The two facts come from different halves of
            `agent-stream-model.ts › buildAgentStream`: `tags` resolve from
            `StreamItem.tagUserIds` / `tagAgentIds`, set ONLY on items built from a stored
            TRANSCRIPT row, while `pending: true` is set ONLY on a frame-backed held draft —
            and a narration frame carries no addressee at all. So `tags` is empty on every
            Pending box by construction.
            ⚠ **IT IS LEFT THAT WAY ON PURPOSE, not postponed for convenience.** The two
            places a held draft's addressees could come from are both refused: a
            `ChannelConsentRequest` has no addressee field (`types-consent.ts` — a summary, a
            preview and the proposed reply, no `metadata`, no `recipient_agent_ids`), and
            re-parsing the draft BODY for `@handles` is the client re-derivation
            `lib/recipient-tags.ts` opens by forbidding: those ids are what the SERVER
            resolved, and a draft has not reached the server yet. Pilling a client's guess
            at a review gate would tell the operator somebody will be woken when nothing
            has resolved that. **A pending draft's addressees become visible the moment it
            posts**, off the row the server wrote. */}
        <BannerTags tags={tags} />
        {stamp && (
          <span className="ml-auto shrink-0 text-micro text-text-on-cta opacity-75">
            {stamp}
          </span>
        )}
      </div>
      {/* ⚠ MARKDOWN, LIKE EVERY OTHER MESSAGE FACE (Samuel, 2026-08-31 — the
          ruling extends here). This body is the SAME STRING the transcript
          renders as markdown one pane over, so a post that read as formatted in
          the channel and as raw asterisks in the operator's own review card was
          one message wearing two faces. ⚠ THE §6 SEAM IS UNTOUCHED: the banner,
          the four faces, the Post button and the expiry rule are what this card
          owns, and none of them moved — only the body's renderer did. */}
      {/* ⚠ ONLY THE SETTLED FACES COLLAPSE — every {@link postedToLabel} wording.
          A body still under review is the one an operator is deciding
          about, and hiding two thirds of it behind a control that sits beside
          the Post button would be this card asking for a press on words it had
          folded away. `pending` covers {@link POST_NOT_SENT_LABEL} too: an
          expired draft is the last chance to read what never went, whole.
          ⚠ THAT ALSO KEEPS THE TWO CONTROLS APART BY CONSTRUCTION — `canPost`
          requires `pending`, so the Post button and the collapse control can
          never contend for the card's last row. */}
      <SentBody text={text} collapsible={!pending} />
      {/* ⚠ THE ACTION IS ON THE LAST ROW, RIGHT-ALIGNED — the position every card
          in this tree keeps (`bits.tsx › CARD_BUTTON`), so the eye finds the same
          control in the same corner. `TAB_ACTION`'s geometry: a 36px dark pill.
          ⚠ NO LABEL, NO EXPLAINER, NO SECOND VERB beside it (Samuel's minimal-UI
          ruling) — the banner already said Pending. */}
      {canPost && (
        <div className="flex justify-end px-3 pb-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => onPost?.(requestId as string)}
            className={cn(TAB_ACTION, "disabled:opacity-60")}
          >
            {POST_ACTION_LABEL}
          </button>
        </div>
      )}
    </div>
  );
}

