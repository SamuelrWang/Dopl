"use client";

/**
 * "AGENT #AB12 IS WORKING…" — MY OWN agents' activity rows above the composer
 * (Samuel, 2026-08-25).
 *
 * ⚠ IT IS THE OWN-SIDE TWIN OF `peer-activity.tsx`, and the two are deliberately
 * NOT one component. They answer the same question about different machines and
 * they fail in opposite directions:
 *   - A PEER row is a cross-machine claim over `channel_sessions`, whose rows
 *     outlive the process that wrote them — so it carries a freshness window and
 *     goes SILENT when a row ages out (a reader must never wait on a machine that
 *     is gone).
 *   - THIS row reads the LOCAL bridge feed, which is the live registry of this
 *     machine's own sessions. **Liveness is membership**: a session that ended is
 *     gone from the feed, not stale in it, so there is no clock to consult and a
 *     freshness window here would be inventing doubt about a fact we hold
 *     directly.
 * Merging them would force one of those two rules onto the other.
 *
 * ⚠ ONE ROW PER AGENT, STACKED — not "3 agents are working…" (Samuel's ruling).
 * The peer row collapses above one because it cannot say anything useful about
 * WHICH peer agent; this side can, because these are the operator's own agents
 * and they have names the operator chose. A count would throw away the one thing
 * that makes the row actionable.
 *
 * ⚠ "IS WORKING…" IS THE SAME WORD THE PEER ROW USES, on purpose. The local feed
 * carries a finer signal (`agents-model.ts › agentDetailLabel` over `detail` —
 * "thinking", a tool name, "posting") and the Agents tab and the agent panel both
 * render it. **A caption beside the composer is not where that belongs**: it
 * flickers once per tool call, and two vocabularies for "this agent is busy" on
 * one screen is the F-142 shape ("the web chip shows Idle while the desktop
 * works"). One word here, the detail one click away.
 */

import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { agentDisplayName, ownAgentsFor } from "./agents-model";
import { AGENT_PILL_FACE } from "./agent-bits";

/**
 * **THE CYCLING ELLIPSIS — "." → ".." → "..." → "" — INSIDE THE PILL, RIGHT AFTER
 * THE NAME WITH NO SPACE** (Samuel, 2026-10-10).
 *
 * ⚠ **THREE SPANS, AND EVERY ONE OF THEM STAYS IN LAYOUT ALL CYCLE.** The frames
 * are `opacity` (`globals.css › .working-dots`, mirrored in `kit.css`), so the box
 * is always three dots wide and the pill cannot resize as the count grows — the
 * jitter a `content` or `width` animation would cost. There is no width here to
 * keep in step with the font.
 * ⚠ **NOT `agent-stream-working.tsx`'S THREE DOTS, AND THE TWO MUST NOT BE MERGED.**
 * That row staggers ONE `animate-pulse` across three dots — a travelling wave, all
 * three always visible. This counts up and resets to blank. Same glyphs, different
 * fact, and stock Tailwind cannot express a cumulative cycle at all, which is the
 * whole reason a custom keyframe lands in both stylesheets here.
 * ⚠ **`aria-hidden`: THE PILL ALREADY CARRIES `role="status"` AND THE NAME.** Three
 * periods read aloud are noise, and the live region should announce an agent, not
 * its animation.
 */
function WorkingDots() {
  return (
    <span aria-hidden className="working-dots shrink-0">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

/**
 * **THE NAME CLIPS, IT DOES NOT ELIDE — BECAUSE {@link WorkingDots} FOLLOWS IT**
 * (Samuel, 2026-10-12: *"a long name truncates with a static `…`, and the working
 * animation adds three animated dots, so six dots show"*).
 *
 * ⚠ **IT IS `truncate` MINUS THE ELLIPSIS, SPELLED OUT, AND THAT IS DELIBERATE.**
 * `truncate` is three utilities in one (`overflow-hidden`, `text-ellipsis`,
 * `whitespace-nowrap`) and tailwind-merge puts `truncate` and `text-clip` in the SAME
 * group — so `cn("truncate", "text-clip")` deletes `truncate` outright and takes the
 * overflow clip and the nowrap with it, leaving a name that WRAPS the pill to two
 * lines. The only safe form is the one that never states `truncate` here at all.
 * ⚠ **`text-clip` IS NOT A NO-OP, it is the CSS default said out loud.** It is stated
 * so a later edit that reaches for `truncate` reads a conflict instead of silently
 * restoring the second ellipsis.
 * ⚠ **THE PILL IS STILL THE THING THAT ELIDES** — the strip's own `truncate`
 * ({@link AgentActivityRows}) drops a whole pill with a `…` when the row runs out of
 * room, which is the 2026-09-20 ruling and is untouched. What is gone is the ellipsis
 * INSIDE one pill, immediately before three animated dots.
 * ⚠ **NOT THE RULE FOR A PILL WITH NO DOTS.** `agent-bits.tsx › AgentPill` — the
 * Mentions inbox, the ended badge — keeps `truncate`: nothing follows the name there,
 * so its `…` is the only mark saying the name was cut and it must stay.
 */
const WORKING_NAME = "min-w-0 overflow-hidden whitespace-nowrap text-clip";

/**
 * MY agents mid-turn on the surface as it is currently scoped. Pure and exported
 * for the test.
 *
 * ⚠ `state === "working"` IS THE ACTIVE-TURN SIGNAL, and it is a real one rather
 * than the closest available approximation. The bridge feed's state is
 * `working | idle | ended` and `agents-model.ts › agentLiveness` already treats
 * `working` as mid-turn everywhere else on this surface; main moves a session
 * OUT of `working` when the turn settles (`session-reducer.js`), so the row
 * disappears on its own with no timer here. **An `idle` agent is listening, not
 * working**, and a row for it would be a permanent band over every channel that
 * has ever launched one.
 *
 * ⚠ THE SCOPE IS `ownAgentsFor`, NOT A FILTER WRITTEN HERE (2026-08-20's rule).
 * That helper is the ONE derivation of "my agents on this surface as scoped" —
 * the Agents tab's list and its badge both run it — and a second inline copy is
 * exactly the two-readers-one-truth defect F-142 records. Channel view shows
 * every agent in the channel; thread view narrows to the open thread, which is
 * what makes the row track the composer's own target.
 *
 * ⚠ `null` SESSIONS RENDER NOTHING, and that is not the same as an empty list.
 * `null` is "could not ask" — a plain browser, or a main without the feed
 * (INVARIANTS §11: UNKNOWN is not EMPTY). An indicator is a POSITIVE claim that
 * something is happening right now; a surface that cannot ask has no business
 * making it.
 */
export function ownAgentsWorking(
  sessions: readonly DesktopSessionSummary[] | null,
  channelId: string,
  openThreadId: string | null = null
): DesktopSessionSummary[] {
  if (!sessions) return [];
  return ownAgentsFor(sessions, channelId, openThreadId).filter(
    (agent) => agent.state === "working"
  );
}

/**
 * What one row says. ⚠ **THE NAME, AND NOTHING ELSE** (Samuel, 2026-09-20:
 * *"right now it says, [agent name] is working… remove the is working… just have
 * it be the flashing dot and the name of the agent"*).
 *
 * ⚠ **THE MARK ALREADY SAID IT, AND SAYING IT TWICE IS WHAT COST THE ROOM.** The
 * animation is the "working" signal — the pulsing dot then, {@link WorkingDots}'s
 * cycling ellipsis since 2026-10-10; the words repeated it once per agent, which is
 * the same one-fact-twice rule `AgentEndedPill` follows against a dot beside a
 * pill reading "Ended". With the strip now inline at the end of the recipient
 * line, three agents' worth of *"… is working…"* is also the difference between
 * fitting and eliding.
 * ⚠ **STILL PURE AND STILL EXPORTED**: `agentDisplayName` prefers the operator's
 * own rename, so a renamed agent must read by its new name the moment the feed
 * carries it.
 */
export function agentActivityText(agent: DesktopSessionSummary): string {
  return agentDisplayName(agent);
}

/**
 * **THE WORKING STRIP — one line, newest agent first, at the END OF THE
 * RECIPIENT LINE** (Samuel, 2026-09-20).
 *
 * 🔒 **IT WAS A STACK OF ROWS UNDER A HAIRLINE AND ALL THREE OF THOSE ARE GONE**:
 * *"no more line created, and instead of having it above the most recent, put
 * agents working to the right … instead of a green dot, have the dot be the
 * colour of that agent … if it runs off the page, just have it do `…`, no
 * scrolling necessary … for a new agent working, have it at the front"*.
 *
 * 🔒 **THE DOT IS GONE AND THE NAME WEARS THE COLOUR — ONE PILL PER AGENT**
 * (Samuel, 2026-10-10: *"no dot. Agent name inside a pill; pill background = the
 * agent's dot color"*). The colour source did not move an inch: it is the same
 * `agent-01…16` key off the same live set, resolved by the same host into the same
 * `var()`. What changed is WHERE it lands — a 6px mark beside a name became the
 * name's own ground, which is one object to read instead of two.
 *
 * ⚠ **THE COLOUR IS STILL IDENTITY, NEVER STATE, AND ONLY HERE.** The `agent-01…16`
 * key says WHICH agent — the fact a reader cannot get any other way once the words
 * are gone. **The Agents tab's dot stays `bg-success`**: that surface lists idle,
 * working and ended together, so there the dot is the only thing carrying state.
 * Two marks, two jobs, stated here because they differ on purpose.
 * ⚠ **THE PULSE MOVED INTO THE WORDS, IT WAS NOT DROPPED.** {@link WorkingDots}'s
 * cycling ellipsis is now the live signal — the half of the green dot that was
 * never redundant — and a pill that could not move would read as a label rather
 * than an agent mid-turn. A pill does not pulse: the fill is the identity, and
 * flashing the ground under a name is both the harder thing to read and the thing
 * that makes the hue hard to name.
 *
 * ⚠ **NEWEST FIRST IS A REVERSE, AND THE FEED'S ORDER IS WHY THAT IS EXACT.**
 * `main/session-summary.js › reportList` walks `deps.sessions.values()` — a `Map`,
 * so iteration is INSERTION order and the oldest live session is first. Reversing
 * it is therefore launch order newest-first, not an approximation of one; there is
 * no timestamp on this feed to sort by and inventing one would be a second
 * ordering to keep in step.
 * ⚠ **`…` IS `truncate`, AND THERE IS DELIBERATELY NO SCROLLER.** A strip that
 * scrolls is a control; this is a caption, and the operator who needs the full
 * list has the Agents tab.
 */
export function AgentActivityRows({
  agents,
  colors = null,
}: {
  /** Already scoped by {@link ownAgentsWorking} — this component does not decide. */
  agents: readonly DesktopSessionSummary[];
  /**
   * **EACH AGENT'S PAINT, ALREADY RESOLVED** — `agentId` → a `var()` reference,
   * worn as the pill's FILL since 2026-10-10.
   *
   * ⚠ **RESOLVED BY THE CALLER, exactly as `authored-row.tsx › AuthoredRowAccent`
   * is.** `lib/agent-colors.ts › agentColorVar` stays the one place the token name
   * is spelled and no colour appears in this component. **That contract is why this
   * file wears `agent-bits.tsx › AGENT_PILL_FACE` rather than calling `AgentPill`**,
   * whose `color` prop is a KEY — flipping the host to hand down keys would trade a
   * ruled contract for a shorter import.
   * ⚠ A missing entry — an agent the live set has not published a colour for — gets
   * the face's own `bg-surface-cta`, i.e. the black pill every other uncoloured agent
   * in the app already wears. No inline style at all, rather than a chosen fallback.
   */
  colors?: ReadonlyMap<string, string> | null;
}) {
  if (agents.length === 0) return null;
  // ⚠ A COPY, NOT `.reverse()` ON THE ARGUMENT — the caller's array is the feed's
  // own derivation and several surfaces read it this render.
  const newestFirst = [...agents].reverse();
  return (
    <span className="flex min-w-0 items-center gap-2 truncate">
      {newestFirst.map((agent) => {
        const paint = agent.agentId ? (colors?.get(agent.agentId) ?? null) : null;
        return (
          <span
            // ⚠ KEYED ON THE BLENDED SLOT, not `agentId` alone — `agents-model.ts ›
            // agentKey` is `(channel, thread, agent)`, and since multiplayer one
            // operator can run several agents whose ids collide across threads.
            key={`${agent.channelId}:${agent.threadId}:${agent.agentId ?? agent.sessionId}`}
            role="status"
            // ⚠ **ONE ELEMENT NOW, NOT A ROW WRAPPING A DOT AND A NAME**: the pill IS
            // the row, so `role="status"` rides the thing a reader sees.
            // ⚠ `shrink` OVERRIDES THE FACE'S `shrink-0` (`cn` is tailwind-merge, later
            // wins) — three pills on the recipient line must ELIDE, and a pill that
            // refuses to shrink gets clipped by the parent's `truncate` with no `…`.
            // `rounded-full` / `h-[18px]`: the working chip is a full pill, unlike the badge face.
            className={cn(AGENT_PILL_FACE, "flex h-[18px] min-w-0 shrink items-center rounded-full py-0")}
            // ⚠ **THE AGENT'S COLOUR IS THE PILL'S FILL NOW, NOT A DOT BESIDE IT**
            // (Samuel, 2026-10-10). The dot said WHICH agent in 6px of hue next to
            // text that then had to be read separately; the pill says it with the
            // name sitting on it, which is one object instead of two.
            // ⚠ **THE INK DOES NOT MOVE, AND THAT IS MEASURED, NOT ASSUMED.** All
            // sixteen keys are one lightness (`agent-color-values.ts`: L 0.44, C 0.11,
            // hue only), so white (`--text-on-cta`) clears WCAG AA on every one of
            // them with half again the margin — 6.99:1 at the worst hue (H=200),
            // 8.26:1 at the best, i.e. AAA to within a rounding error — and the palette is
            // declared once in `:root` with no light/dark split, so there is no second
            // theme to check and no conditional ink to keep in step.
            // `agent-color-contrast.test.ts` pins both halves of that.
            style={paint ? { backgroundColor: paint } : undefined}
          >
            {/* ⚠ **THE UNCOLOURED FACE IS THE PILL'S OWN `bg-surface-cta`, AND THE OLD
                `bg-border-strong` COULD NOT COME WITH IT.** That was a DOT's neutral —
                a 12%-black hairline tint — and as a pill FILL it puts white text on
                near-white. {@link AgentPill} already rules this exact case for a live
                agent in a room whose sixteen keys are out: *"both are ordinary, both
                get the CTA face"*. So no `paint` means no inline style at all. */}
            {/* ⚠ {@link WORKING_NAME}, NOT `truncate` — the dots below are the pill's
                only dots. */}
            <span className={WORKING_NAME}>{agentActivityText(agent)}</span>
            <WorkingDots />
          </span>
        );
      })}
    </span>
  );
}
