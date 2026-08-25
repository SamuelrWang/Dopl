"use client";

/**
 * Channels v2 — WHO SAID THIS, AS ONE PILL. The header of every message group in
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
 */

import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { agentAccent } from "./bits";

/**
 * THE NAME LINE, in three cases and no more (Samuel, 2026-08-22).
 *
 * | row                          | reads             |
 * |------------------------------|-------------------|
 * | human                        | the member's name |
 * | agent, `client_msg_id` stamped | `Agent #<id>`   |
 * | agent, unstamped             | `Agent`           |
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
}: {
  agent: boolean;
  agentId: string | null;
  authorLabel: string;
}): string {
  if (!agent) return authorLabel;
  return agentId ? `Agent #${agentId}` : "Agent";
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
  time,
}: {
  author: AvatarPerson;
  authorLabel: string;
  /** Display claim off `authorKind` — never a side, never an identity. */
  agent: boolean;
  /** WHICH agent, when the writer stamped it; `null` is "cannot say". */
  agentId?: string | null;
  /** Already formatted by the transcript's own `formatTime`. */
  time: string;
}) {
  return (
    <span
      data-agent-id={agentId ?? undefined}
      /* A STABLE HOOK FOR SCOPED RESTYLING, not a style of its own. /home wears
         a raised face on these pills (`pages/home/home.module.css`) and the
         workspace channels page must not — a host cannot reach this element any
         other way, and selecting on `.bento` would catch every card in the
         subtree. Carries no meaning; safe to ignore. */
      data-attribution-pill=""
      className={cn(
        "bento inline-flex max-w-full items-center gap-2 rounded-full py-1 pl-1 pr-3.5",
        agentId && agentAccent(agentId),
        // ⚠ NEUTRALISERS LAST, and only these two — see the docblock.
        "bg-bg-elevated text-text-primary"
      )}
    >
      <Avatar person={author} size="sm" />
      <span className="flex min-w-0 flex-col">
        <span className="wrap-anywhere text-body font-semibold leading-tight">
          {attributionName({ agent, agentId, authorLabel })}
        </span>
        <span className="text-micro leading-tight text-text-muted">{time}</span>
      </span>
    </span>
  );
}
