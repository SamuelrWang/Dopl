"use client";

/**
 * THE PRIVATE DIRECT LANE'S TWO FACES — **another of the operator's agents said
 * this, and this is what their agent said back** (Samuel's ruling, 2026-08-31;
 * F-366's operator half).
 *
 * ⚠ WHAT IT REPLACES: nothing at all. Both frames fell through
 * `agent-stream-model.ts › frameLane`'s `note` fallback and rendered as anonymous
 * muted log lines — the honest degradation while the lane had no face, and a
 * stream in which a question from one machine's orchestrator and a status note
 * about an idle timer looked identical. **The operator has to be able to scan who
 * sent what to whom**, which is the whole of this file.
 *
 * ── THE DESIGN FAMILY, AND THE ONE THING IT MAY NOT BORROW ────────────────────
 *
 * ⚠ IT IS `agent-stream-sent-box.tsx`'s BOX: full stream width rather than a
 * chat bubble, radius 12, a banner over a body, the timestamp riding in the
 * banner's trailing tag. That geometry is what says "this is an EXCHANGE, not a
 * line of the log", and it is the same claim both boxes are making.
 *
 * ⚠ **AND IT MAY NOT WEAR THE DARK CTA BANNER, WHICH IS THE POINT OF THE PAIR.**
 * `--surface-cta` on the sent box means ONE thing on this surface: these words
 * left the machine and the counterparty has them (INVARIANTS §11). Nothing in
 * this lane did — a direction is 1:1 between two of the operator's OWN agents,
 * over a mailbox no peer can read or write (§11, the private direct lane) — so
 * the banner here is the inset ground the panel's quiet chrome already uses.
 * **Same box, different weight**: the box says "somebody said this to somebody",
 * the weight says whether anybody outside this machine can see it.
 *
 * ── ⚠ THE NAME SLOT IS EMPTY, AND IT IS EMPTY UPSTREAM — F-376 ────────────────
 *
 * Samuel's ruling asks for the counterparty BY NAME, through the one display-name
 * resolution (`agents-model.ts › agentDisplayName`; the raw id is never
 * user-visible, `agent-id-visibility.test.ts`). **There is no name to resolve and
 * no id to resolve it from, at any layer:**
 *
 *   - `channel_agent_directions` has `agent_id` — the ADDRESSEE — and no sender
 *     column (`supabase/migrations/20260903120000_channel_agent_directions.sql`);
 *   - `schema-direction.ts › DirectionCreateSchema` takes `{channel, agentId,
 *     threadId, body}`, so an MCP caller cannot name itself even if it wanted to;
 *   - `main/agent-direction-wire.js › directionFrom` is a literal whitelist over
 *     that row and has nothing to carry;
 *   - so `main/agent-directions.js › deliverTo` passes `directed: {id,
 *     workspaceId, operatorUserId}` and the narration frame is `{at, kind, lane,
 *     text}`.
 *
 * **So this is NOT a narration-payload gap and was not treated as one.** Adding a
 * key to the frame would require a sender identity to exist first — a column, a
 * schema field, a service stamp and a wire field, across two trees. Filed as
 * F-376 rather than forced.
 *
 * ⚠ THE COPY THEREFORE NAMES THE RELATION, WHICH IS THE PART THAT IS TRUE. "your
 * agent" is not a hedge: the lane is fenced on `operator_user_id = ctx.userId` in
 * every read and write (§11 — *a peer can neither be directed nor direct you*),
 * so the counterparty is always one of this operator's own. F-366 asks for
 * exactly this and no more — *"one short line saying the words came from another
 * of their agents, and nothing more"* — and the minimal-copy ruling forbids the
 * explainer that would otherwise want to sit under it.
 * ⚠ `agent` IS A LIVE `null` PATH, NOT DEAD WIRING. When a sender identity ships,
 * the model passes a resolved DISPLAY NAME and the label reads it; nothing else
 * in this file moves, and no caller may ever pass a raw agent id here.
 */

import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { cn } from "@/shared/lib/utils";
import { StreamProse } from "./agent-stream-prose";

/**
 * WHAT THE TWO BANNERS SAY. ⚠ Exported for the tests, on the sent box's rule:
 * "Directed by" and "Reply to" over the same geometry are opposite claims about
 * WHICH WAY the words travelled, and getting them the wrong way round is this
 * card's version of saying a private steer was posted.
 *
 * ⚠ THE NAMELESS FORM IS THE ORDINARY ONE TODAY (F-376) and is a complete
 * sentence rather than a gap: it says the relation, which is the fact the lane
 * guarantees.
 */
export const DIRECTED_ANON = "your agent";

export function directedLabel(agent: string | null | undefined): string {
  return `Directed by ${label(agent)}`;
}

export function directedReplyLabel(agent: string | null | undefined): string {
  return `Reply to ${label(agent)}`;
}

/** ⚠ TRIMMED, AND EMPTY FALLS BACK. A display name is operator prose and a
 *  whitespace-only one is an absent one — `agents-model.ts › agentDisplayName`
 *  takes the same view of its own input. */
function label(agent: string | null | undefined): string {
  const name = typeof agent === "string" ? agent.trim() : "";
  return name || DIRECTED_ANON;
}

/**
 * ONE SIDE OF A PRIVATE AGENT-TO-AGENT EXCHANGE.
 *
 * ⚠ THE BODY GOES THROUGH `StreamProse` LIKE EVERY OTHER MESSAGE FACE (R1,
 * 2026-08-31). A direction is prose one agent wrote for another to read, and a
 * reply is the answering turn's final text — both are message text and both were
 * printing their own markdown characters.
 */
export function DirectedBox({
  text,
  agent,
  outbound = false,
  at,
}: {
  text: string;
  /**
   * WHO THE COUNTERPARTY IS, **already resolved to a display name** — never an
   * agent id (`agent-id-visibility.test.ts`). `null` is the ordinary answer and
   * renders {@link DIRECTED_ANON}; see the header for why nothing upstream can
   * supply one yet.
   */
  agent?: string | null;
  /** `false` = the direction arrived here; `true` = this agent answered it. */
  outbound?: boolean;
  /** Epoch ms. `0` means the stamp was unreadable — the tag drops rather than
   *  printing an epoch date at somebody (the sent box's rule). */
  at?: number;
}) {
  const banner = outbound ? directedReplyLabel(agent) : directedLabel(agent);
  const stamp = at ? formatChannelTimestamp(new Date(at).toISOString()) : "";
  return (
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-[12px] border bg-card-surface-subtle",
        // ⚠ THE OUTBOUND SIDE IS THE QUIETER BORDER. Within one exchange the
        // INBOUND box is the one carrying a fact the operator did not already
        // have — somebody else's words arrived — and the answer is their own
        // agent speaking, which this column is otherwise full of.
        outbound ? "border-border-subtle" : "border-border-default"
      )}
    >
      <div className="flex items-center gap-1.5 bg-bg-inset px-2.5 py-[5px]">
        <span className="min-w-0 truncate text-micro font-medium text-text-secondary">
          {banner}
        </span>
        {stamp && (
          <span className="ml-auto shrink-0 text-micro text-text-muted">
            {stamp}
          </span>
        )}
      </div>
      <StreamProse text={text} className="px-3 py-[9px]" />
    </div>
  );
}
