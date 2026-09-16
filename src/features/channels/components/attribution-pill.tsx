"use client";

/**
 * Channels — WHO SAID THIS, AS ONE PILL. The header of every message group in
 * the transcript, channel view and thread view alike (Samuel, 2026-08-22, from
 * two reference screenshots).
 *
 * ⚠ IT REPLACED THE AVATAR-GUTTER HEADER AND THE GREY "Agent · <id>" CHIP, and
 * both halves of that are the ruling. The old row was an avatar in a `w-10`
 * gutter beside a baseline-aligned name + time, with a separate chip for agent
 * posts. What ships instead is the reference's own layout: a circular avatar on
 * the LEFT of a rounded capsule, and to its right TWO STACKED LINES — name on
 * top, and where the reference put a subtitle ("Sales Rep") this puts the
 * MESSAGE TIMESTAMP, in the transcript's existing time format. **THERE IS NO
 * CHIP ANY MORE**; the agent says so in its NAME LINE.
 *
 * ⚠ ONE PILL FOR BOTH KINDS OF AUTHOR, deliberately. A human pill is
 * avatar + name + time; an agent pill is avatar + `Agent #<id>` + time, on the
 * SAME face. The transcript is one system, and a second header idiom for agent
 * rows is how two surfaces come to word one exchange differently.
 *
 * ⚠ THE AVATAR IS STILL THE OPERATOR'S. An agent has no face of its own and is
 * not a third party: it hangs on its operator's side and wears its operator's
 * profile image (INVARIANTS §5 — side comes from `author_user_id`). The NAME is
 * where the agent-ness is stated, and that is a display claim off `authorKind`,
 * which is caller-assertable and may never move a row.
 *
 * ⚠ NOTHING HERE IS AUTHENTICATION. `agent`, `agentId` and `authorLabel` are all
 * derived in `view-model-rows.ts › toMessageRow`; this component renders what it
 * is handed and owns no rule beyond the wording below.
 *
 * ⚠ AN AGENT'S PILL IS A BUTTON, A HUMAN'S IS NOT (Samuel, 2026-08-28, over a channel
 * transcript screenshot: *"the sender pill should open that agent's view"*). Handed
 * `onOpenAgent`, an AGENT-authored pill renders as a real `<button>` that opens the agent
 * pane for THAT instance; a human pill is a `<span>` exactly as it always was, and so is an
 * agent pill on a host that hands no callback. **THE FACE IS IDENTICAL EITHER WAY** — one
 * `className`, one `data-attribution-pill`, one `data-agent-id` — because /home repaints
 * these on that attribute (`pages/home/home.module.css`) and a second face would be a second
 * pill. What the button adds is the app's own pressable MOTION (`.btn-light`'s
 * ±1px) and a pointer, never a second recipe.
 *
 * ⚠ THE GATE IS THE CALLER'S, NOT THIS FILE'S. Whether the pane can open at all is a fact
 * about the HOST, and `transcript.tsx › Message` answers it — see its note. This component
 * only asks "am I an agent row, and was I given a way to open".
 */

import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { agentFaceName } from "@/shared/lib/agent-name";
import { agentAccent } from "./bits";

/**
 * THE NAME LINE, in four cases and no more (Samuel, 2026-08-22; the RENAME case 2026-08-27).
 *
 * | row                            | reads                    |
 * |--------------------------------|--------------------------|
 * | human                          | the member's name        |
 * | agent, RENAMED by its operator | that name                |
 * | agent, `client_msg_id` stamped | `Agent #<id>`            |
 * | agent, unstamped               | `Agent`                  |
 *
 * ⚠ THE RENAME IS RESOLVED AT RENDER, AND THAT IS THE WHOLE OF THE 2026-08-27 FIX. A rename did
 * not reach the chat area at all — not because a cache was stale but because this function never
 * asked: it hardcoded `Agent #<id>` while `agents-model.ts › agentDisplayName` (the CARDS' rule)
 * had preferred the operator's own name since 2026-08-25. Two renderers, one fact, and only one
 * of them knew. `agentName` comes from `AuthorIndex.agents`, re-derived whenever main pushes a
 * summary — so a rename lands on the next push with no refetch and no message rewritten.
 *
 * ⚠ NOTHING IS STAMPED INTO A MESSAGE ROW, and nothing may start being. The name is machine-local
 * and mutable; a copy in the payload would freeze it at send time and put the transcript back
 * where it was, one row at a time.
 *
 * ⚠ THE `#` IS LITERAL AND IT IS NOT A SEPARATOR. `Agent #hdi3lawb` is how
 * Samuel says the id out loud; the old chip's middot was decoration and read as
 * one to a screen reader, which is why the whole string is now ONE text node.
 *
 * ⚠ UNSTAMPED READS "Agent", NEVER A BLANK AND NEVER AN INVENTED ID. Three real
 * classes of agent post carry no per-instance stamp — a main older than the
 * stamp, an agent that supplied its own idempotency key, and every machine-level
 * courtesy post (`agent-<channelUUID>-<seq>`, which the anchored pattern in
 * `agents-model.ts › parseAgentPostStamp` deliberately refuses). All three mean
 * CANNOT SAY, and the honest rendering of that is the bare noun (INVARIANTS §11).
 *
 * ⚠ THE HUMAN LABEL IS UNTOUCHED, including "You" for the viewer — that is
 * `view-model-rows.ts › labelFor`'s rule and this must not restate it.
 *
 * Pure and exported so the wording is testable without a DOM.
 */
export function attributionName({
  agent,
  agentId,
  authorLabel,
  agentName = null,
}: {
  agent: boolean;
  agentId: string | null;
  authorLabel: string;
  /** What the operator calls this agent RIGHT NOW, or null. ⚠ Resolved at render — never a field
   *  on the message row. Since 2026-08-31 it may also arrive from the SERVER's peer projection
   *  (`channel_sessions.display_name`), which is what lets the OTHER member read it too. */
  agentName?: string | null;
}): string {
  if (!agent) return authorLabel;
  // ⚠ **`#<id>` IS GONE (Samuel, 2026-09-15: *"I want to make it so that the user really doesnt
  // see it"*).** This was the TRANSCRIPT half of the unnamed face — the surface an operator
  // reads most — and it was the one site `agent-id-visibility.test.ts` EXEMPTED from its own
  // interpolation ban, on the 2026-08-31 reading that `#<id>` was a name rather than an id.
  // That exemption is what let this stand while the sweep around it stayed green; it is
  // removed, and `shared/lib/agent-name.ts` is the one face all three readers share.
  // ⚠ **THE UNSTAMPED ROW IS UNCHANGED AND IS A DIFFERENT FACT.** `agentId` absent means the
  // post carries no per-agent stamp at all, so there is no agent to name — the bare noun is the
  // honest claim there, and `New Agent` would assert a session that was never identified.
  return agentId ? agentFaceName(agentName) : "Agent";
}

/**
 * THE AGENT-NESS, AS CHROME (Samuel, 2026-08-31): a small GREY chip carrying the word
 * "agent" — grey fill, NO border, no outline — beside the name. It replaces the word's old
 * seat INSIDE the name (`Agent #<id>`), so the name is just the id or the operator's rename.
 * ⚠ `bg-bg-inset` is the kit's flat grey ground and deliberately NOT `.bento` — a bento face
 * carries the elevated shadow, and this chip must read as a label, not a card.
 * ⚠ Lower-case "agent", one word, never pluralized — it is a type marker, not a title.
 */
export function AgentChip({ paint }: { paint?: string | null }) {
  /**
   * 🔒 **THE CHIP WEARS THE AGENT'S OWN IDENTITY COLOUR (Samuel, 2026-09-15):
   * background = that agent's assigned `agent-01…16` key, the word in white.**
   *
   * ⚠ **`paint` IS A `var()` REFERENCE THE CALLER RESOLVED, NEVER A KEY AND NEVER
   * A COLOUR.** `lib/agent-colors.ts › agentColorVar` is the only place the token
   * name is spelled and the sixteen `oklch()` values live in the two CSS palettes —
   * so no colour appears in this component, which is docs/DESIGN-SYSTEM.md's rule
   * honoured rather than bent. The inline `style` is forced and the reason is
   * written out in `agent-box-rule.ts`: the palette member is chosen by DATA, and
   * `bg-[var(--agent-color-${key})]` is a dynamic class the JIT never sees, so the
   * alternatives are sixteen literal classes or a safelist.
   * ⚠ **IT IS THE SAME `paint` THE ROW'S SIDE BAR AND RING ALREADY USE**
   * (`agentPostAccent`), so the chip cannot drift to a second hue for one agent —
   * and an ENDED agent's neutral `--border-strong` flows here too, which is the
   * ruling ("once the agent has ended, that color needs to" go back to the bank).
   *
   * ⚠ **ABSENT `paint` KEEPS THE GREY CHIP, BYTE FOR BYTE.** A "Desktop agent"
   * post belongs to no channel session, has no colour to wear, and must go on
   * reading exactly as it does today — the chip says THAT it is an agent, and the
   * colour says WHICH, so the second fact may be missing without disturbing the
   * first.
   * ⚠ **WHITE INK IS `--text-on-cta`, THE APP'S ONE ON-DARK TOKEN**, not
   * `text-white`: a literal white is a colour a restyle cannot follow, and this is
   * the same pair every filled pill in the tree already uses.
   */
  /**
   * 🔒 **THE WORD IS CENTRED IN THE PILL, WHICH IT WAS NOT (Samuel, 2026-09-15:
   * *"the text 'agent' in the pill in the badge isnt vertically centered"*).**
   *
   * ⚠ **CAUSE: THIS WAS A PLAIN INLINE `<span>`, SO THE WORD SAT ON A BASELINE
   * RATHER THAN IN A BOX.** `py-px` + `leading-tight` built the pill's height out
   * of a LINE BOX, and a line box distributes half-leading around a font's
   * ASYMMETRIC ascent/descent — with a descender in "agent" the ink lands visibly
   * high. No padding tweak fixes that honestly; it has to stop being inline.
   * ⚠ **THE FIX IS THIS FILE'S NEIGHBOURS' OWN IDIOM, NOT A NEW RECIPE**:
   * `bits.tsx › CountBadge` is `inline-flex h-[16px] items-center justify-center`
   * and `channel-row-marks.tsx › MentionBadge` is `flex h-[18px] items-center`.
   * An explicit height plus `items-center` centres the text BOX, which is the one
   * arrangement that is correct at every font size.
   * ⚠ **`leading-none` GOES WITH IT**: with the flex box owning the height, a
   * line-height over 1 only re-introduces the half-leading this is removing.
   * ⚠ **16px KEEPS THE PILL THE SIZE IT ALREADY WAS** (`text-micro` at
   * `leading-tight` + 2px of padding measured ≈15.75px), so nothing on the name
   * line reflows.
   */
  const shape =
    "inline-flex h-[16px] shrink-0 items-center justify-center rounded-full px-1.5 text-micro leading-none";
  if (!paint) {
    return <span className={cn(shape, "bg-bg-inset text-text-muted")}>agent</span>;
  }
  return (
    <span style={{ backgroundColor: paint }} className={cn(shape, "text-text-on-cta")}>
      agent
    </span>
  );
}

/**
 * The capsule itself.
 *
 * ⚠ THE FACE IS THE KIT'S `.bento` AT A CAPSULE RADIUS — the subtle elevated
 * card the reference shows, composed rather than hand-rolled (docs/DESIGN-SYSTEM:
 * no local shadow or border recipes). `rounded-full` is a UTILITY and `.bento`
 * lives in `@layer components`, so the utility layer outranks its 14px radius;
 * that is the same cascade `.raised-tab`'s documented fill-override note relies
 * on, not a trick unique to this file.
 *
 * ⚠ THE PER-AGENT ACCENT SURVIVES, ON THE BORDER (Samuel's judgment call, taken
 * here). `bits.tsx › agentAccent` returns a border/fill/ink triple built for a
 * CHIP, and its fill would fight the card face while its ink would recolour the
 * one line the reader is trying to read. The two trailing neutralisers put the
 * fill and the ink back — `cn` is `tailwind-merge`, later wins within a group —
 * so exactly the BORDER COLOUR survives. That keeps the accent's whole job (two
 * of an operator's agents in one thread are glanceably different) without a
 * second palette to drift, and `agent-attribution.test.tsx` pins both halves:
 * the accent's border class present, the elevated fill NOT tinted.
 *
 * ⚠ `wrap-anywhere` ON THE NAME, for the reason the body carries it: a roster
 * name with no spaces in it must not size this pill past the pane
 * (`transcript-body.test.tsx` pins the class by name — `break-words` leaves
 * min-content alone and would not fix it).
 */
export function AttributionPill({
  author,
  authorLabel,
  agent,
  agentId = null,
  agentName = null,
  agentPaint = null,
  radius,
  time,
  onOpenAgent,
}: {
  author: AvatarPerson;
  authorLabel: string;
  /** Display claim off `authorKind` — never a side, never an identity. */
  agent: boolean;
  /** WHICH agent, when the writer stamped it; `null` is "cannot say". */
  agentId?: string | null;
  /** Its CURRENT operator-given name, resolved at render from `AuthorIndex.agents`. */
  agentName?: string | null;
  /**
   * **THIS AGENT'S IDENTITY COLOUR AS A `var()` REFERENCE** — what {@link AgentChip}
   * paints its background with (Samuel, 2026-09-15).
   *
   * ⚠ **THE CALLER RESOLVES IT, EXACTLY AS IT RESOLVES {@link agentName}**, and for
   * the same reason: the colour is read at render off the live projection and is
   * NEVER on the message row, because the key goes back to the channel's bank when
   * the session ends (`view-model.ts › AgentIdentity.color`). This component takes
   * no index and must not learn to read one.
   * ⚠ **IT IS `agent-box-rule.ts › agentPostAccent`'S `paint`, THE SAME VALUE THE
   * ROW'S BAR AND RING WEAR** — one agent, one hue, resolved once by the caller.
   * `null` is the ordinary answer for a post with no channel session behind it and
   * keeps the grey chip.
   */
  agentPaint?: string | null;
  /**
   * 🔬 **THE CAPSULE'S CORNERS, WHEN THE CALLER NEEDS THEM SQUARED ON ONE SIDE**
   * (Samuel, 2026-09-15, verbatim): *"for the badge, on the left side it is still
   * rounded but on the right side (or basically wherever side it is that meets the
   * vertical line), I want it to actually be a sharp corner. That way it looks like
   * it's sitting flush with the vertical line."*
   *
   * ⚠ **THE RING WAS ALREADY SQUARE ON THAT SIDE AND THE PILL WAS NOT — THAT
   * MISMATCH IS THE REPORTED DEFECT.** `authored-row.tsx › ACCENT_RING_SHAPE` has
   * squared the ring's bar-side edge since 2026-09-14, but the capsule inside it kept
   * `rounded-full`, so the ring ran straight past a corner that curved away from it.
   * The crescent between the two is what Samuel describes as *"two empty gaps with
   * these triangles in between"*.
   * ⚠ **OMITTED MEANS THE CAPSULE, UNCHANGED.** A person's row and any unaccented
   * row have no bar to sit against, so they keep `rounded-full` — this is not a new
   * default, it is an override an accented row asks for.
   * ⚠ IT IS A RADIUS AND NOTHING ELSE. Not a `className` escape hatch: widening it
   * would let a host restyle the one face `/home` and the channels page share.
   */
  radius?: string;
  /** Already formatted by the transcript's own `formatTime`. */
  time: string;
  /**
   * Open THIS agent's pane. ⚠ ABSENT MAKES THE PILL INERT, which is the whole gate: a host
   * with no agent pane beside it (the pop-out window, the guest web lane) hands none, and a
   * pill that cannot open anything must not look like it can — the same absent-not-disabled
   * rule the launch controls follow. Ignored on a HUMAN row and on an UNSTAMPED agent row:
   * "cannot say which agent" has no pane to open.
   */
  onOpenAgent?: () => void;
}) {
  const label = attributionName({ agent, agentId, authorLabel, agentName });
  const openable = agent && agentId !== null && onOpenAgent !== undefined;
  /* ⚠ ONE CLASS STRING FOR BOTH ELEMENTS. The face may not fork — see the docblock. */
  const face = cn(
    // 🔬 **THE RADIUS IS THE CALLER'S WHEN IT HAS AN OPINION — SAMUEL'S FLUSH-CORNER
    // EXPERIMENT (2026-09-15).** Default `rounded-full` is the capsule this has always
    // been; an ACCENTED row hands the bar-side square instead, so the badge sits flush
    // against the vertical line. ⚠ **IT REPLACES THE CLASS RATHER THAN LAYERING OVER
    // IT**, deliberately: `rounded-full` plus a later `rounded-r-none` leaves BOTH in the
    // output — `tailwind-merge` treats corner-side groups as narrower than `rounded` and
    // does not drop the parent — so which one wins would come down to the order Tailwind
    // happened to emit two equal-specificity utilities in. One slot, one answer.
    radius ?? "rounded-full",
    "bento inline-flex max-w-full items-center gap-2 py-1 pl-1 pr-3.5",
    agentId && agentAccent(agentId),
    // ⚠ NEUTRALISERS LAST, and only these two — see the docblock.
    "bg-bg-elevated text-text-primary",
    // ⚠ THE PRESSABLE HALF, AND ONLY ON THE BUTTON. `text-left` and `cursor-pointer`
    // undo the two `<button>` defaults that would otherwise change this capsule.
    //
    // 🔒 **THE 1px LIFT USED TO LIVE HERE AND IT HAD TO LEAVE (Samuel, 2026-09-15:
    // the border "detaches" from the badge on hover).** The app's raised affordance
    // was stated as `hover:-translate-y-px` ON THIS ELEMENT — but on an agent row
    // this element is WRAPPED, and the wrapper is what paints the accent ring
    // (`authored-row.tsx › ACCENT_RING`). A transform moves the element it is on and
    // nothing else, so hovering lifted the capsule out from under its own border and
    // opened a 1px gap. **The motion now sits on the ring-bearing wrapper**, which is
    // the only element that can move the pill AND its border as one shape.
    //
    // ⚠ **NOTHING IS STRANDED BY THAT MOVE, AND THE REASON IS AN INVARIANT RATHER
    // THAN A COINCIDENCE**: `openable` is `agent && agentId !== null && onOpenAgent`,
    // and `agent-box-rule.ts › agentBoxOf` accents a row on `agent && agentId !== null`
    // — a strict superset. So every pill that can be pressed is already inside a
    // wrapper, and there is no openable-but-unwrapped case to keep a second copy of
    // the motion for. **Do not add one back here**: two transforms on nested elements
    // is a 2px lift, which is the other way this bug can be written.
    openable && "cursor-pointer text-left"
  );
  const body = (
    <>
      <Avatar person={author} size="sm" />
      <span className="flex min-w-0 flex-col">
        {/* ⚠ THE CHIP SITS BESIDE THE NAME, on agent rows only (2026-08-31): the name line
            stopped carrying the word "agent", and this is where the fact moved. `items-center`
            keeps the chip on the name's own line; the flex row wraps if a long rename must. */}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="wrap-anywhere text-body font-semibold leading-tight">{label}</span>
          {agent && <AgentChip paint={agentPaint} />}
        </span>
        <span className="text-micro leading-tight text-text-muted">{time}</span>
      </span>
    </>
  );

  /* A STABLE HOOK FOR SCOPED RESTYLING, not a style of its own. /home wears a raised face on
     these pills (`pages/home/home.module.css`) and the workspace channels page must not — a
     host cannot reach this element any other way, and selecting on `.bento` would catch every
     card in the subtree. Carries no meaning; safe to ignore. ⚠ BOTH ELEMENTS CARRY IT. */
  if (openable) {
    return (
      <button
        type="button"
        data-agent-id={agentId ?? undefined}
        data-attribution-pill=""
        /* ⚠ THE NAME, NOT THE RAW ID. `label` is already the display name — the rename when
           there is one, `#<id>` otherwise — so this obeys the global invariant that a
           raw agent id never renders on its own. */
        aria-label={`Open agent ${label}`}
        onClick={onOpenAgent}
        className={face}
      >
        {body}
      </button>
    );
  }
  return (
    <span data-agent-id={agentId ?? undefined} data-attribution-pill="" className={face}>
      {body}
    </span>
  );
}
