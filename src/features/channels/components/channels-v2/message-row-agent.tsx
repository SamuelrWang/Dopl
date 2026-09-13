"use client";

/**
 * WHAT AN AGENT'S POST LOOKS LIKE IN THE TRANSCRIPT — a flat row, not a card.
 *
 * 🔒 **SAMUEL, 2026-09-13, verbatim, over a channel transcript:** *"For the main
 * channel … it's actually really hard to understand which agent is posting what. …
 * Right now when an agent posts, there's a specialized kind of box UI where you
 * can see the agent's name, the message, and the timestamp. I want to change that
 * to a more modern UI."*
 *
 * ⚠ **THIS SUPERSEDES "ONE HEADER IDIOM FOR THE WHOLE TRANSCRIPT" (2026-08-22),
 * AND ONLY FOR AGENT ROWS.** That ruling put every author — human and agent alike
 * — under `attribution-pill.tsx › AttributionPill`, a `.bento` capsule holding
 * avatar + name over timestamp, on the reasoning that a second shape for agent
 * rows is how two surfaces come to word one exchange differently. Samuel has now
 * looked at the result and the capsule is what he is pointing at: a box per post
 * makes a run of agent output read as a stack of cards rather than as somebody
 * talking. **HUMAN ROWS ARE UNTOUCHED** — they keep the pill, byte for byte — and
 * so do the thread / milestone / escalation CARDS, which are cards on purpose.
 * `docs/INVARIANTS.md` §5 carries the supersession.
 *
 * ⚠ **THE SIDE DOES NOT MOVE, AND THAT IS NOT NEGOTIABLE (INVARIANTS §5).** An
 * agent hangs on its OPERATOR's side, from `author_user_id`, never in a third
 * column and never from `authorKind` — which is caller-assertable, so keying
 * layout off it would let a caller choose which half of somebody else's screen
 * their words land on. What changed is the row's FACE, not what decides it: the
 * 24px avatar slot leads on the side the row hangs on (`flex-row-reverse` for the
 * viewer's own), exactly as the column's `items-end` already expressed.
 *
 * ⚠ **THE NAME IS STILL `attribution-pill.tsx › attributionName`, BY IMPORT.** The
 * four cases — a rename, `#<id>`, the bare noun `Agent`, and a human's label — are
 * worded in ONE function and this row must never re-word them; that function is
 * also where the rename-resolved-at-render rule lives (§5, 2026-08-27). The pill
 * file keeps it because the human row still renders the pill.
 */

import { Bot } from "lucide-react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { cn } from "@/shared/lib/utils";
import { attributionName } from "./attribution-pill";
import { agentAccent } from "./bits";

/** The avatar slot, both states. 24px — Samuel's number, and `Avatar size="xs"`'s. */
const SLOT = "relative h-6 w-6 shrink-0";

/** The badge glyph and the mark glyph, one number each. */
const BADGE_ICON = 8;
const MARK_ICON = 13;

/**
 * THE AVATAR SLOT — **the operator's face with a small bot badge, or the agent
 * mark when there is no face to badge.**
 *
 * ⚠ **THE PHOTO CASE IS THE INVARIANT UNCHANGED**: an agent has no face of its own
 * and is not a third party, so it wears its operator's profile image (§5). The
 * badge is what says "an agent typed this" — a display claim off `authorKind`,
 * which is all `authorKind` may ever move.
 *
 * ⚠ **NO PHOTO MEANS THE MARK, NOT AN INITIAL, and that is the one deliberate
 * departure.** `Avatar`'s fallback is the operator's initial letter, which on an
 * agent row is a picture of a PERSON posting — the confusion Samuel opened with.
 * A `Bot` in the same 24px circle says what the row is at the same glance the
 * badge does for the photo case.
 */
function AgentFace({ author }: { author: AvatarPerson }) {
  if (!author.avatarUrl) {
    return (
      <span
        aria-hidden
        data-agent-mark=""
        className={cn(
          SLOT,
          "flex items-center justify-center rounded-full border border-border-default bg-bg-inset text-text-secondary"
        )}
      >
        <Bot size={MARK_ICON} />
      </span>
    );
  }
  return (
    <span className={SLOT}>
      <Avatar person={author} size="xs" />
      <span
        aria-hidden
        data-agent-badge=""
        className="absolute -bottom-px -right-px flex h-3 w-3 items-center justify-center rounded-full border border-bg-elevated bg-bg-inset text-text-secondary"
      >
        <Bot size={BADGE_ICON} />
      </span>
    </span>
  );
}

/**
 * ONE AGENT POST.
 *
 * ⚠ **A CONSECUTIVE RUN SHOWS THE HEADER ONCE (Slack's rule).** `continuation`
 * arrives already decided by `view-model-rows.ts › isContinuation`, which since
 * 2026-09-13 also breaks an agent run after five minutes of silence — so a reply
 * an hour later earns its own name and time instead of reading as the tail of the
 * morning's run. On a continuation the avatar slot is held EMPTY rather than
 * removed: the body has to stay on the same left edge as the row above it, and a
 * missing gutter is what used to misalign them.
 *
 * ⚠ **THE 2px LEFT RULE IS A LIVENESS SIGNAL AND IT IS ALWAYS RESERVED.** It is
 * drawn `border-transparent` when the agent is not live and coloured when it is,
 * so the transcript does not reflow by 2px the moment an agent ends. The COLOUR is
 * the agent's own tone (`bits.tsx › agentAccent`, a pure function of the id, so
 * two of an operator's agents in one thread are glanceably different), with the
 * chip's fill and ink neutralised after it — the same three-class arrangement the
 * pill used, and for the same reason: that triple was built for a chip, and its
 * fill would tint the transcript.
 *
 * ⚠ **`live` IS THE CALLER'S, AND THE FACT IT IS BUILT FROM IS COARSE.**
 * `view-model.ts › AgentIdentity` carries `ended` and nothing finer — the desktop
 * feed's state is reduced to that one flag on the way into `AuthorIndex.agents` —
 * so this rule means "this agent is still running", which is exactly the negative
 * Samuel stated (*none when ended*). A Thinking-vs-Waiting split is NOT on this
 * map and must not be faked from anything that is; the agent CARD is where the
 * detailed pill lives (`agents-model.ts › agentLiveness`).
 * ⚠ **AND AN UNKNOWN AGENT GETS NO RULE** (§11 — UNKNOWN is not a state): an
 * unstamped post, a peer's agent and every plain browser have nothing to be right
 * about, so they draw the transparent reservation and stop there.
 *
 * ⚠ **THE SENDER IS STILL THE WAY INTO THAT AGENT'S PANE (2026-08-28).** With the
 * capsule gone the NAME is the button, firing the same `onOpenAgent` the Agents
 * tab's card fires — there is no second pipe, and absent renders plain text rather
 * than a disabled control. **`data-agent-sender` marks it in both forms**, the way
 * `data-attribution-pill` marked the capsule's two, so a suite addresses ONE hook
 * and cannot miss the inert arm. ⚠ **IT DOES NOT CARRY `data-attribution-pill`**: that
 * attribute is /home's hook for repainting the capsule in a RAISED face
 * (`pages/home/home.module.css`), and putting it on a flat name would re-box the
 * very thing this ruling removed.
 */
export function AgentMessageRow({
  id,
  side,
  author,
  authorLabel,
  time,
  agentId = null,
  agentName = null,
  live = false,
  routedTo = null,
  routedTitle,
  continuation,
  flash,
  onOpenAgent,
  children,
}: {
  id: string;
  side: "me" | "peer";
  author: AvatarPerson;
  authorLabel: string;
  time: string;
  /** WHICH agent, when the writer stamped it; `null` is "cannot say". */
  agentId?: string | null;
  /** Its CURRENT operator-given name, resolved at render by the caller. */
  agentName?: string | null;
  /** This agent is still running — see the docblock for what that is derived from. */
  live?: boolean;
  /** The server's routing verdict, already faced by the caller (`authored-row.tsx`
   *  carries the full rule; this row draws the same line for the same reason). */
  routedTo?: string | null;
  routedTitle?: string;
  continuation: boolean;
  flash: boolean;
  /** ⚠ ALREADY GATED BY THE CALLER — `transcript.tsx › Message` owns the gate. */
  onOpenAgent?: () => void;
  children: React.ReactNode;
}) {
  const mine = side === "me";
  const label = attributionName({ agent: true, agentId, authorLabel, agentName });
  const openable = agentId !== null && onOpenAgent !== undefined;
  return (
    <article
      data-message-id={id}
      data-agent-row=""
      data-agent-id={agentId ?? undefined}
      data-agent-live={live || undefined}
      className={cn(
        // The negative margin + padding pair keeps the flash tint from shifting
        // layout, exactly as `authored-row.tsx` does — one row idiom, two faces.
        "-mx-2 flex gap-2 rounded-[10px] px-2 py-1 transition-colors duration-700",
        mine ? "flex-row-reverse" : "flex-row",
        // ⚠ RESERVED, THEN COLOURED — see the docblock. Neutralisers last: `cn` is
        // `tailwind-merge` and later wins within a group, so only the BORDER
        // colour of the agent's tone survives.
        "border-l-2 border-transparent",
        live && agentId && cn(agentAccent(agentId), "bg-transparent text-text-primary"),
        flash && "bg-link/10 duration-150"
      )}
    >
      {/* ⚠ THE SLOT IS ALWAYS THERE, EMPTY ON A CONTINUATION — see the docblock. */}
      {continuation ? <span aria-hidden className={SLOT} /> : <AgentFace author={author} />}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1", mine && "items-end")}>
        {!continuation && (
          <p className="flex min-w-0 max-w-full flex-wrap items-baseline gap-1.5">
            {openable ? (
              <button
                type="button"
                onClick={onOpenAgent}
                data-agent-sender=""
                /* ⚠ THE NAME, NOT THE RAW ID — `label` is already the display
                   name, so the global "a raw agent id never renders alone"
                   invariant holds here as it does on the pill. */
                aria-label={`Open agent ${label}`}
                className="wrap-anywhere cursor-pointer text-body font-medium text-text-primary hover:underline"
              >
                {label}
              </button>
            ) : (
              <span
                data-agent-sender=""
                className="wrap-anywhere text-body font-medium text-text-primary"
              >
                {label}
              </span>
            )}
            {/* The separator is decoration and says nothing — `aria-hidden`, the
                lesson the deleted chip's middot taught (§5). */}
            <span aria-hidden className="text-caption text-text-muted">
              ·
            </span>
            <span className="text-caption text-text-muted">{time}</span>
          </p>
        )}
        {routedTo !== null && (
          <p className="max-w-full truncate text-micro text-text-muted" title={routedTitle}>
            → {routedTo}
          </p>
        )}
        {children}
      </div>
    </article>
  );
}
