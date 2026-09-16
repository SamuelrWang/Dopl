"use client";

/**
 * Channels — THE SHELL EVERY AUTHORED ROW SHARES, split out of `transcript.tsx` on
 * 2026-08-28 when that file crossed the 500-line cap (INVARIANTS §1).
 *
 * ⚠ THE SEAM IS THE SHARING, NOT THE LINE COUNT. `transcript.tsx › Message`,
 * `thread-card-row.tsx › ThreadCardMessage` and `escalation-card-row.tsx` are its consumers,
 * and once those live in different files the shell cannot stay inside any one of them without
 * the others importing THROUGH it — a cycle, and a file that changes for three reasons. It
 * moved VERBATIM; nothing about the row's behaviour changed in the move.
 *
 * ⚠ **AND SINCE 2026-09-14 IT IS THE *ONLY* ROW SHAPE AGAIN, INCLUDING AN AGENT'S.** The
 * 2026-09-13 wave gave a channel agent's post its own component — a full bordered box with a
 * coloured top bar holding the pill (the message-box-agent component, DELETED). Samuel replaced it
 * over a screenshot: *"instead of it being an entire box, I want to change it to instead be a
 * vertical bar. For messages that are right aligned, this bar should sit to the right, for
 * messages left aligned, bar should be on the left. And move the agent/user identification
 * pill to the right again, And basically, have the colored box, instead of this long box,
 * make it just around the pill, like a bordering, rounded to fit. and it's attached to a
 * vertical bar, that travels the length/amount of lines of the messages from that agent."*
 * An agent's post is therefore a PERSON's post again — same pill, same position, same
 * continuation rule, same side — plus {@link AuthoredRowAccent}, and putting the accent HERE
 * rather than in a second component is the ruling read literally: a fork would have to
 * re-derive the side and the continuation rule, which is the bug the box's own docblock
 * warned about and then committed anyway by hard-coding `items-start`.
 */

import { cn } from "@/shared/lib/utils";
import { AttributionPill } from "./attribution-pill";
import type { MessageRow } from "./view-model-rows";
import type { AgentColorKey } from "../types";

/**
 * **A CHANNEL AGENT'S COLOUR, ALREADY RESOLVED** — what the row draws its ring and its bar
 * in (Samuel, 2026-09-14; docs/specs/agent-colors.md).
 *
 * ⚠ **THE PAINT ARRIVES RESOLVED AND THIS SHELL NEVER LOOKS A KEY UP.** `agent-box-rule.ts ›
 * agentPostAccent` is the one place a key becomes a `var()` reference for a row, exactly as
 * `agentName` above arrives already resolved off `AuthorIndex.agents` — this file takes no
 * index and must not learn to read one.
 *
 * ⚠ **`null`/ABSENT MEANS NO ACCENT AT ALL, AND IT IS NOT THE SAME AS A `key` OF `null`.** A
 * person's post and a channel-less "Desktop agent" post get no ring and no bar (Samuel:
 * *"For desktop agents and for messages from users, keep those white"*); an ENDED agent's
 * post gets `{ key: null, paint: var(--border-strong) }` — a NEUTRAL ring and bar, because
 * its colour went back to the channel's bank but it is still an agent's post. Collapsing the
 * two would make every ended agent read as a person, on this surface and in the filter.
 */
export type AuthoredRowAccent = {
  /** The bank key, or `null` for the neutral face. ⚠ A DOM HOOK AND NOTHING ELSE — it is the
   *  KEY rather than the resolved paint so nothing downstream can start treating a hue as an
   *  identity, and it is never read back by this tree. */
  key: AgentColorKey | null;
  /** A CSS colour REFERENCE — `var(--agent-color-NN)` or `var(--border-strong)`, never a
   *  literal. docs/DESIGN-SYSTEM.md's no-hardcoded-colour rule, kept by construction. */
  paint: string;
};

/**
 * **THE BAR.** 3px, pill-ended, and the full height of the row it marks (Samuel: *"a vertical
 * bar, that travels the length/amount of lines of the messages from that agent"*).
 *
 * ⚠ `self-stretch` IS THE WHOLE OF "TRAVELS THE LENGTH", and it is why the bar is a flex item
 * beside the content column rather than an absolutely positioned decoration: a stretched item
 * is measured by the row's own height, so a one-line post and a forty-line post each get a bar
 * exactly as tall as they are with nothing to keep in step.
 *
 * ⚠ 3px AND NOT 1px, for the reason the deleted box's border was 2px: a mid-chroma hue on a
 * hairline against white is a thing a reader has to hunt for, and telling two agents apart at
 * a glance is the entire feature.
 *
 * ⚠ **`rounded-b-full`, NOT `rounded-full` — THE TOP END IS SQUARE AND THAT IS A RULING**
 * (Samuel, 2026-09-14, over the first build: *"where it connects with the bar, it should be a
 * straight, not rounded"*). The TOP is the end that meets the pill: a rounded cap there tapers
 * to a point exactly where the ring's colour has to continue into the bar's, so the join reads
 * as two marks that nearly touch instead of one shape. The FAR end has nothing to meet and
 * keeps its cap, which is what stops the bar reading as a cut-off rule.
 */
const ACCENT_BAR = "w-[3px] shrink-0 self-stretch rounded-b-full";

/**
 * **THE RING AROUND THE PILL** (Samuel: *"have the colored box … make it just around the pill,
 * like a bordering, rounded to fit"*).
 *
 * ⚠ **A WRAPPER, NOT A FORK OF THE PILL.** `attribution-pill.tsx › AttributionPill` is
 * untouched — one face for a human and an agent, one `data-attribution-pill`, one set of
 * `/home` overrides. A ring drawn on a wrapper is the only way to add a border to that capsule
 * without a second recipe for it (docs/DESIGN-SYSTEM.md forbids a local one).
 *
 * ⚠ **A RING, WHICH IS A `box-shadow` AND THEREFORE COSTS NO LAYOUT.** A `border` would
 * grow the wrapper on every side and push the pill off the row's edge; the ring is
 * painted OUTSIDE the border box, so the wrapper stays exactly the pill's size and the ring
 * lands in the gutter the negative margin below opens for it. `rounded-full` so it follows the
 * capsule's own shape rather than boxing it. The colour rides `--tw-ring-color` as an inline
 * custom property — `agent-color-circles.tsx › RING`'s recipe, and the only way a palette
 * member chosen by DATA can reach a Tailwind ring at all.
 *
 * 🔒 **3px, AND IT IS 3px BECAUSE {@link ACCENT_BAR} IS (Samuel, 2026-09-15, choosing
 * between thinning the bar and thickening the ring: option (b), "every agent message
 * reads heavier" accepted).** It was `ring-2` against a 3px bar, and that ONE PIXEL was
 * the whole defect: {@link GUTTER}'s geometry lays the ring over the bar's inner edge, so
 * a 2px ring covered 2px of a 3px bar and left the outer 1px standing beside it — the
 * STEP along the join, and the little triangular gaps where the ring's curve pulls away
 * from that leftover sliver.
 * ⚠ **THE TWO NUMBERS ARE ONE NUMBER AND MUST MOVE TOGETHER.** Ring width and bar width
 * are not independent styling choices; they are the two halves of a single unbroken line
 * of colour, and any difference between them reappears as a step. `agent-post-accent.test.tsx`
 * pins them as a PAIR for that reason — change one, change the other.
 * ⚠ `ring-[3px]` RATHER THAN `ring-3`: the arbitrary value is the spelling that cannot
 * depend on which widths the preset happens to ship.
 *
 * ⚠ **NO `ring-offset-*`.** The offset is exactly what the selected colour circle wants and
 * exactly what this must not have: the ring has to REACH the bar (see {@link GUTTER}).
 *
 * ⚠ **SQUARE ON THE BAR SIDE (Samuel, 2026-09-14, over the first cut: "where it connects
 * with the bar, it should be a straight, not rounded" — "it was not fixed?"): the ring
 * is a stadium on the OUTER three sides and a straight vertical edge on the side that
 * meets the bar, so ring and bar read as one continuous line of colour.
 *
 * 🔒 **AND IT CARRIES THE PILL'S PRESS, BECAUSE IT IS THE THING THE BORDER IS ON
 * (Samuel, 2026-09-15: the border "detaches" from the badge on hover).**
 *
 * ⚠ **CAUSE: THE LIFT WAS ON THE PILL, THE RING IS ON THIS WRAPPER, AND A
 * TRANSFORM MOVES ONLY THE ELEMENT IT IS ON.** `attribution-pill.tsx` stated the
 * app's raised affordance as `hover:-translate-y-px` on the `<button>` INSIDE this
 * span, so hovering slid the capsule up one pixel and left its own border behind —
 * the gap Samuel saw. Matching the two with a second transform here would be a 2px
 * lift; the fix is that exactly ONE element moves, and it has to be this one.
 *
 * ⚠ **`has-[button:hover]` READS THE CONDITION OFF THE DOM RATHER THAN RESTATING
 * THE PREDICATE.** The pill renders as a `<button>` when it is openable and a
 * `<span>` when it is not (`AttributionPill`'s own gate), so "there is a pressable
 * pill in here" is already expressed in the markup. Spelling `openable` a second
 * time in this file would be two copies of one rule in two components — the drift
 * `agent-box-rule.ts` exists to prevent — and this shell deliberately takes no
 * index and answers no identity questions.
 * ⚠ **AN UNOPENABLE PILL THEREFORE DOES NOT MOVE, WHICH IS CORRECT**: the pop-out
 * window and the guest lane hand no callback, and a capsule that cannot open
 * anything must not animate as though it can (the absent-not-disabled rule).
 *
 * 🔒 **AND IT CASTS THE BADGE'S SHADOW, BECAUSE THE RING WAS EATING IT (Samuel,
 * 2026-09-15: the shadow must cover the ENTIRE badge including the ring — on a
 * ringed badge it is blocked, while the ringless "You" badge shows it fine).**
 *
 * ⚠ **CAUSE: TWO ELEMENTS, AND THE OUTER ONE HAD THE RING.** The pill's elevation
 * comes from `.bento`, cast from the PILL's border box — and this wrapper's ring
 * is an opaque 3px band occupying exactly that first 3px. The shadow was being
 * laid down underneath the ring and never reached open air, which is why only the
 * unringed badge looked elevated. Nothing was missing; it had nowhere to fall.
 * ⚠ **SO THE ELEVATION MOVES OUT ONE ELEMENT, TO THE THING THAT IS ACTUALLY THE
 * BADGE'S OUTER EDGE.** `--shadow-bento` is `.bento`'s own pair, extracted to a
 * token (`globals.css`, mirrored in `tokens.css`) rather than copied, so a ringed
 * badge and a ringless one cast the IDENTICAL shadow and a restyle moves both.
 * ⚠ **THE COMPOSITION ORDER IS WHAT MAKES IT ONE SILHOUETTE, AND IT IS TAILWIND'S,
 * NOT OURS**: `box-shadow` is emitted ring-first, shadow-last, so the ring paints
 * ON TOP and the shadow falls from the ring's outer edge outward. Badge and ring
 * read as a single raised object with a single shadow under it.
 * ⚠ **THE PILL KEEPS `.bento` AND THAT IS NOT A SECOND SHADOW ANYONE SEES** — on a
 * ringed row it is hidden beneath the ring exactly as before, and on an UNRINGED
 * row (a person's pill, the "You" badge Samuel used as his reference) it is still
 * the only elevation there is. That case must not change.
 *
 * 🔒 **THE LIFT IS 2px, NOT THE KIT'S 1px, AND THE DEVIATION IS DELIBERATE**
 * (Samuel: 1px is "too subtle to read as clickable"). `.btn-light`,
 * `.auth-btn-3d` and `.menu-row` all lift 1px (`globals.css`) — but every one of
 * them changes its FILL on hover as well, so the motion is one cue among several.
 * This badge has no hover fill at all: its face is the agent's colour and must
 * stay that colour, so the lift is carrying the entire affordance alone and needs
 * to be legible by itself. 2px is the next real step on the scale rather than an
 * invented number, and with the shadow above now travelling with it the pair
 * reads as a press without the pill jumping.
 */
const ACCENT_RING =
  "inline-flex max-w-full ring-[3px] shadow-[var(--shadow-bento)] transition-transform duration-150 has-[button:hover]:-translate-y-0.5 has-[button:active]:translate-y-0.5 motion-reduce:transition-none";
const ACCENT_RING_SHAPE = { me: "rounded-l-full rounded-r-none", peer: "rounded-r-full rounded-l-none" } as const;

/**
 * **WHY THE PILL AND THE BAR TOUCH, IN TWO NUMBERS.**
 *
 * The content column is inset from the bar by 8px (`pl-2` / `pr-2`) so real prose never runs
 * into it; the pill's wrapper then takes an equal NEGATIVE margin on the same side, so the
 * pill alone reaches back out and its border box ends exactly at the bar's inner edge. Its
 * 3px ring is painted from there OUTWARD, across the bar's FULL 3px — **so the ring and the
 * bar are one unbroken 3px of colour with no seam and no step**, which is the *"attached to a
 * vertical bar"* half of the ruling and the only part of this geometry a reader can actually
 * see.
 *
 * 🔒 **THIS PARAGRAPH DESCRIBED A 2px RING OVER A 3px BAR UNTIL 2026-09-15, AND IT WAS
 * HONEST ABOUT THE DEFECT WITHOUT NAMING IT ONE**: it said the ring left "the bar's outer
 * 1px beside it" and then called the result unbroken, which it could not be. That leftover
 * pixel is exactly what Samuel reported as a step with triangular gaps at the corners.
 * Widening the ring to the bar's own 3px is what makes the sentence true.
 *
 * ⚠ **THE TWO HALVES MUST MOVE TOGETHER OR THE JOIN OPENS**, which is why they are one
 * constant apiece and not two numbers in two class strings a hundred lines apart.
 */
const GUTTER = { me: "pr-2", peer: "pl-2" } as const;
const GUTTER_PULL = { me: "-mr-2", peer: "-ml-2" } as const;

/**
 * **WHAT THE JUMP-TO-MESSAGE FLASH PAINTS — A LIGHT GREY, NOT THE LINK BLUE** (Samuel,
 * 2026-09-16: *"the highlight is in blue. I would like that highlight to be in like a
 * light gray. not blue."*).
 *
 * ⚠ **IT IS THE ELEVATION RAMP'S OWN TINT, NOT A NEW GREY.** `--surface-raised-3` is the
 * app's 5% black wash (docs/DESIGN-SYSTEM.md), one step above the `bg-surface-raised-2`
 * every hover row wears — so a flashed row reads as lifted rather than as hovered, and no
 * component here mints a colour of its own.
 * ⚠ **BLUE WAS SAYING SOMETHING IT DID NOT MEAN.** `--link` is this surface's ROUTING
 * colour — a tinted `@handle` in a body, the composer's live tint, the unread dot — so
 * tinting a row blue for 1.6s claimed the message had been addressed to somebody. Grey is
 * the honest reading: *"here it is"*, and nothing more.
 * ⚠ **ONE CONSTANT, BOTH FACES.** The bare row and the accented row flash from this
 * string; two spellings is how they came to disagree about geometry twice already.
 */
export const FLASH_TINT = "bg-surface-raised-3";

/**
 * The shell every authored row shares: the ATTRIBUTION PILL as the group header,
 * the body blocks under it, and the side.
 *
 * ⚠ THE HEADER IS A PILL AND THE AVATAR MOVED INSIDE IT (Samuel, 2026-08-22).
 * The `w-10` avatar gutter and the baseline name/chip/time row are GONE:
 * `attribution-pill.tsx › AttributionPill` carries avatar + name + time as one
 * capsule, and the message blocks stack BELOW it at full column width. That
 * changes the row from a horizontal pair into a column, so **the side is now
 * `items-end` / `items-start` on this element rather than `flex-row-reverse`** —
 * the RULE is unchanged (INVARIANTS §5: `authorUserId === currentUserId`), only
 * the axis it is expressed on. The bodies keep their own `items-end`, which is
 * what `MESSAGE_BLOCK`'s 92% cap gives them something to pull against.
 *
 * ⚠ A CONTINUATION STILL DROPS THE HEADER, and now drops NO indent with it.
 * Under the gutter layout a continuation had to keep a `w-10` spacer or it lined
 * up left of the row it continued; with the pill above the body, the first row's
 * body starts at the same edge a continuation's does, so the spacer would be the
 * thing that misaligned them.
 *
 * ⚠ **AN ACCENTED CONTINUATION KEEPS ITS BAR** (2026-09-14). The pill is dropped for a RUN by
 * one author and the ring goes with it — there is nothing to ring — but the BAR is a fact
 * about the post's lines, so a run of an agent's messages reads as a column of separate bars,
 * one per post. That is Samuel's *"one post, one bar"* in the same words the deleted box used
 * for *"one post, one box"*, and for a better reason than the box had: nothing is lost now,
 * since the time still rides the pill of whichever post carries one.
 */
export function AuthoredRow({
  id,
  side,
  author,
  authorLabel,
  time,
  agent,
  agentId = null,
  agentName = null,
  routedTo = null,
  routedTitle,
  continuation,
  flash,
  accent = null,
  onOpenAgent,
  children,
}: {
  id: string;
  side: "me" | "peer";
  author: MessageRow["author"];
  authorLabel: string;
  time: string;
  agent: boolean;
  /** WHICH agent, when the writer stamped it — see `attribution-pill.tsx`. */
  agentId?: string | null;
  /** ⚠ ITS CURRENT NAME, RESOLVED BY THE CALLER from `AuthorIndex.agents` and passed in — this
   *  shell takes no index. Never a field on the row (2026-08-27). */
  agentName?: string | null;
  /**
   * THE TAG THE SERVER RESOLVED for a post that named nobody — already FACED by
   * the caller (Samuel, 2026-09-05: *"it should still auto-add the agent tag
   * before the message"*, so looking back does not read as unaddressed).
   *
   * ⚠ **A LABEL THIS SHELL DRAWS, NOT A FACT IT DERIVES** — the same contract
   * `agentName` above is under, and for the same reason: this file takes no index
   * and must not learn to resolve one. `null` renders nothing at all.
   * ⚠ **IT IS NOT PART OF THE BODY AND MUST NEVER BE CONFUSED FOR IT.** The
   * stored body is untouched everywhere; this line is the transcript reporting a
   * stamped routing decision, which is why it is drawn as chrome (muted, small)
   * rather than as text inside the message block.
   */
  routedTo?: string | null;
  /** The raw address behind {@link routedTo} — `@agent-<id>`, on hover, the same
   *  arrangement `message-markdown.tsx › MentionText` uses so the id is never
   *  more than a hover from the name. */
  routedTitle?: string;
  continuation: boolean;
  flash: boolean;
  /** **THIS POST'S AGENT COLOUR, OR NOTHING** — see {@link AuthoredRowAccent}. ⚠ THE
   *  PREDICATE IS THE CALLER'S (`agent-box-rule.ts › agentBoxOf`), because the transcript
   *  FILTER asks the identical question to build its "People" option and two spellings of it
   *  would let a post paint one way and filter the other. */
  accent?: AuthoredRowAccent | null;
  /** ⚠ ALREADY GATED BY THE CALLER — see `Message`. This shell takes no index either. */
  onOpenAgent?: () => void;
  children: React.ReactNode;
}) {
  const mine = side === "me";
  const edge = mine ? "me" : "peer";
  const pill = continuation ? null : (
    <AttributionPill
      author={author}
      authorLabel={authorLabel}
      agent={agent}
      agentId={agentId}
      agentName={agentName}
      // 🔒 **THE CHIP'S FILL COMES OFF THE ROW'S OWN ACCENT (Samuel, 2026-09-15)**
      // — no new prop on this shell, because the paint it would carry is the paint
      // it is ALREADY handed. One value reaches the ring, the side bar and now the
      // `agent` chip, so the three cannot disagree about one agent's colour, and an
      // accent-less row (a person, a channel-less MCP post) hands `null` and keeps
      // the grey chip.
      agentPaint={accent?.paint ?? null}
      // 🔬 **THE BADGE'S BAR-SIDE CORNER IS SQUARE ON AN ACCENTED ROW — SAMUEL'S
      // FLUSH EXPERIMENT (2026-09-15).** The SAME constant the ring wears, so the
      // capsule and the border around it turn the same corner: the ring has been
      // square on this side since 2026-09-14 while the pill inside stayed a full
      // capsule, and the crescent between them is the *"two empty gaps with these
      // triangles"*.
      // ⚠ **ONLY WHEN THERE IS AN ACCENT**, because the square edge only makes sense
      // against a bar. A person's row has none and keeps its capsule.
      radius={accent ? ACCENT_RING_SHAPE[edge] : undefined}
      time={time}
      onOpenAgent={onOpenAgent}
    />
  );
  /* ⚠ `w-full` so the column is the row's full width whatever the article's
     align-items says — the pill hugs its content, the bodies must not. */
  const body = (
    <div className={cn("flex w-full min-w-0 flex-col gap-1.5", mine && "items-end")}>
      {/* ⚠ ABOVE THE BODY, BECAUSE IT IS AN ADDRESS AND AN ADDRESS COMES
          FIRST — and INSIDE the body column rather than beside the pill, so it
          sits on the writer's own side and truncates with the column instead
          of widening the row. ⚠ IT SURVIVES A CONTINUATION on purpose: the
          pill is dropped for a RUN by one author, but who a message reached is
          a fact about THAT message. */}
      {routedTo !== null && (
        <p className="max-w-full truncate text-micro text-text-muted" title={routedTitle}>
          → {routedTo}
        </p>
      )}
      {children}
    </div>
  );

  if (!accent) {
    return (
      <article
        data-message-id={id}
        className={cn(
          // The negative margin + padding pair keeps the flash tint from
          // shifting layout: the row always owns the strip it may highlight.
          "-mx-2 flex flex-col gap-1.5 rounded-[10px] px-2 py-1 transition-colors duration-700",
          mine ? "items-end" : "items-start",
          flash && `${FLASH_TINT} duration-150`
        )}
      >
        {pill}
        {body}
      </article>
    );
  }

  return (
    <article
      data-message-id={id}
      /* ⚠ THE KEY IS ON THE DOM AS DATA, FOR THE TESTS AND FOR A HOST'S SCOPED RESTYLE —
         never read back by this tree (`attribution-pill.tsx`'s `data-attribution-pill`
         precedent). ABSENT on the neutral face, which is what makes "has a colour" queryable
         separately from "is an agent's post". */
      data-agent-color={accent.key ?? undefined}
      className={cn(
        // ⚠ THE SAME STRIP A BARE ROW OCCUPIES — the `-mx-2 … px-2 py-1` pair and the flash
        // tint are unchanged, so the transcript does not step in and out as authors alternate.
        "-mx-2 flex items-stretch rounded-[10px] px-2 py-1 transition-colors duration-700",
        // ⚠ **THE BAR IS ALWAYS ON THE OUTER EDGE, AND THIS ONE CLASS IS THE WHOLE RULE**
        // (Samuel: *"For messages that are right aligned, this bar should sit to the right,
        // for messages left aligned, bar should be on the left"*). It is expressed as a
        // REVERSAL rather than as two orderings so the bar stays the article's FIRST child
        // in the DOM either way — a screen reader meets the row's content, not a decoration,
        // and there is exactly one place the side can be got wrong.
        mine ? "flex-row-reverse" : "flex-row",
        flash && `${FLASH_TINT} duration-150`
      )}
    >
      <span aria-hidden className={ACCENT_BAR} style={{ backgroundColor: accent.paint }} />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-1.5",
          mine ? "items-end" : "items-start",
          GUTTER[edge]
        )}
      >
        {pill && (
          <span
            className={cn(ACCENT_RING, ACCENT_RING_SHAPE[edge], GUTTER_PULL[edge])}
            /* ⚠ THE ONE VALUE TAILWIND CANNOT CARRY FOR A RUNTIME KEY — see
               {@link ACCENT_RING}. */
            style={{ ["--tw-ring-color" as string]: accent.paint }}
          >
            {pill}
          </span>
        )}
        {body}
      </div>
    </article>
  );
}
