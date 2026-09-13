"use client";

/**
 * THE AGENTS TAB'S FOUR GRAY WELLS — **Recent / Last 7 days / Last 30 days /
 * Earlier**, each one collapsible, each holding the white agent cards that were
 * created or last active inside its span.
 *
 * 🔒 **SAMUEL, 2026-09-13, verbatim, over a flat column of agent cards:** *"On the
 * overview page we see that gray background thing. I like that gray background
 * right behind the white pane. I want us to apply that gray background on top of
 * that Agents page. Each one will have a header that says Recent. Inside that
 * little area we're going to have all the agents that were active in the last 24
 * hours or were just created in the last 24 hours. … They might be idle but they
 * just show up there. … Below that would be another one … last seven days … and
 * then under that would be like last thirty days … And then one more that says
 * like earlier … any agents that were active like over thirty days … a lot of
 * these would be ended agents. So basically if it's an ended agent but they were
 * active last thirty days … that should be in … the respective gray boxes. … I
 * want these gray boxes to be collapsible. … the title of the text on the left.
 * The right side, add like an arrow, like a down arrow and like a right arrow …
 * down arrow if it's been opened up, and … a right arrow if it is collapsed. … the
 * header … font size and font styling, it should be the same as … the credit
 * spend."*
 *
 * ⚠ **A BUCKET IS ABOUT TIME, NEVER ABOUT STATE.** Ended, idle, waiting and
 * working agents sit together in whichever well their last activity falls in —
 * that is the whole of *"if it's an ended agent but they were active last thirty
 * days … the respective gray boxes"*. Nothing here reads `state`, and nothing here
 * may start to: liveness is already said on the card (`agents-model.ts ›
 * agentLiveness`) and saying it twice, once as a heading, is how the two come to
 * disagree.
 *
 * ⚠ **THE WELL IS THE /home OVERVIEW'S, REACHED BY IMPORT** —
 * `shared/ui/panel-well.ts › PANEL_WELL`, which is `SECTION_PANEL_SHELL` +
 * `bg-home-panel` and NO hairline. The cards inside stay exactly the `.bento`
 * white cards they were (`bits.tsx › PANEL_CARD`) at exactly the gap they had
 * (`PANEL_ROWS`): this ruling added a GROUND under the column, it did not restyle
 * the column.
 *
 * ⚠ **AN EMPTY WELL IS NOT RENDERED, AND SAMUEL DID NOT RULE ON IT.** Four
 * headings over three empty boxes would make "no agents older than a month" and
 * "agents you have not scrolled to" the same picture, and the tab already has one
 * sentence for the genuinely-empty case. Flagged rather than assumed — the
 * alternative (an always-present header saying one quiet line, the
 * `template-section.tsx › TemplatePanel` rule) is one prop away.
 */

import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
// ⚠ CROSS-FEATURE, AND DELIBERATELY THE SMALLER OF TWO EVILS. `docs/INVARIANTS.md`
// §1 forbids it and F-275 records that this tree has never obeyed the rule;
// `agents-tab.tsx` has imported `agent-templates/components/template-picker` since
// 2026-08-22. `TEMPLATE_NAME_TEXT` was EXPORTED on 2026-09-13 precisely so a second
// surface could read the type Samuel names by pointing at it, and the third reader
// is this heading. Lifting it to `shared/` instead would mean editing
// `template-section.tsx` and `pages/home/overview-panels.tsx`, both of which are
// being edited concurrently.
import { TEMPLATE_NAME_TEXT } from "@/features/agent-templates/components/template-section";
import { cn } from "@/shared/lib/utils";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { PANEL_ROWS, PANEL_WELL } from "@/shared/ui/panel-well";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { ChannelPeerSession } from "../../hooks/use-channel-agent-sessions";

const DAY_MS = 86_400_000;

/** The four wells, in the order Samuel dictated them. ⚠ ORDER IS THE DATA — the
 *  render maps this array, so there is no second list to keep in step. */
export const AGENT_WELLS = [
  { id: "recent", label: "Recent", maxAgeMs: DAY_MS },
  { id: "week", label: "Last 7 days", maxAgeMs: 7 * DAY_MS },
  { id: "month", label: "Last 30 days", maxAgeMs: 30 * DAY_MS },
  // ⚠ THE LAST WELL HAS NO CEILING, which is what makes the buckets exhaustive:
  // every card lands in exactly one, so none can be dropped by arithmetic.
  { id: "earlier", label: "Earlier", maxAgeMs: Number.POSITIVE_INFINITY },
] as const;

export type AgentWellId = (typeof AGENT_WELLS)[number]["id"];

/**
 * WHEN THIS AGENT LAST MATTERED — `max(startedAt, lastActivityAt ?? endedAt)`,
 * epoch ms, or `null` when this build measured none of them.
 *
 * ⚠ **THESE ARE THE FIELDS THAT EXIST, MEASURED RATHER THAN ASSUMED.**
 * `spa-bridge-shapes.ts › DesktopSessionSummary` carries `startedAt` (*"when the
 * desktop created this session object"* — there is no `createdAt` on this wire),
 * `lastActivityAt` (*"epoch ms of the last engine state change"*) and `endedAt`.
 * `startedAt` IS the creation stamp Samuel's *"or were just created in the last 24
 * hours"* asks for, and the MAX is what makes that clause an OR rather than a
 * second pass.
 *
 * ⚠ **EVERY ONE OF THE THREE IS OPTIONAL AND NULLABLE, AND `null` IS NEVER ZERO**
 * (INVARIANTS §11) — an older main omits them, and `Math.max` over a coerced
 * `null` would date every such agent to 1970 and file it under **Earlier**, which
 * is a fabricated fact about when it ran. The reduce therefore skips non-finite
 * values and answers `null` when nothing survived.
 */
export function agentActivityAt(
  session: DesktopSessionSummary & { endedAt?: number | null }
): number | null {
  const stamps = [session.startedAt, session.lastActivityAt ?? session.endedAt];
  let best: number | null = null;
  for (const s of stamps) {
    if (typeof s !== "number" || !Number.isFinite(s)) continue;
    if (best === null || s > best) best = s;
  }
  return best;
}

/**
 * THE SAME QUESTION FOR A PEER ROW, AND IT HAS EXACTLY ONE STAMP TO ANSWER WITH.
 * `types-sessions.ts › ChannelSessionState` is the COARSE cross-machine projection
 * — no `startedAt`, no `lastActivityAt`, no `endedAt`, by design (those are
 * operator-only, §5) — so `updatedAt` is the whole of what a peer card knows.
 *
 * ⚠ **IT IS NOT A HEARTBEAT AND THIS IS NOT A LIVENESS READ.** `updated_at` moves
 * on a projection CHANGE (`agents-model.ts › peerRowStale` says so at length), and
 * using it to decide which gray box a card sits in is a much weaker claim than
 * using it to decide whether the card exists — which remains forbidden.
 * ⚠ **UNPARSEABLE READS AS UNKNOWN**, not as old: see {@link wellFor}.
 */
export function peerActivityAt(peer: Pick<ChannelPeerSession, "updatedAt">): number | null {
  const ts = peer.updatedAt ? new Date(peer.updatedAt).getTime() : NaN;
  return Number.isNaN(ts) ? null : ts;
}

/**
 * WHICH WELL A STAMP FALLS IN.
 *
 * ⚠ **UNKNOWN LANDS IN `recent`, AND THE DIRECTION IS THE POINT.** `recent` is the
 * one well open by default, so an agent this build cannot date stays VISIBLE; the
 * alternative buries a live agent inside a collapsed **Earlier** on the strength
 * of a field an older main simply does not send. An absence must never make a row
 * harder to find (INVARIANTS §11 — UNKNOWN is not EMPTY).
 * ⚠ **A FUTURE STAMP IS ALSO `recent`** — clock skew between a machine and this
 * renderer is ordinary, and a negative age is not evidence of anything.
 *
 * ⚠ **THE CLOCK'S DEFAULT LIVES HERE, ON THE PURE FUNCTION** — the shape
 * `agents-model.ts › peerRowStale` already holds, and it is not cosmetic: a
 * `now = Date.now()` default on the COMPONENT is an impure call during render
 * (`react-hooks/purity`), while a test that wants to state an age passes one.
 */
export function wellFor(at: number | null, now: number = Date.now()): AgentWellId {
  if (at === null) return "recent";
  const age = now - at;
  for (const well of AGENT_WELLS) {
    if (age < well.maxAgeMs) return well.id;
  }
  return "earlier";
}

/** One card, with the stamp that files it. ⚠ The NODE is built by the caller: this
 *  module groups cards and owns no card shape. */
export interface AgentWellItem {
  key: string;
  at: number | null;
  node: ReactNode;
}

export const AGENT_WELLS_STORAGE_KEY = "dopl.agents.wells";

type OpenMap = Record<AgentWellId, boolean>;

/** ⚠ **RECENT OPEN, THE OTHER THREE COLLAPSED** — Samuel's default, stated once. */
const WELLS_DEFAULT: OpenMap = {
  recent: true,
  week: false,
  month: false,
  earlier: false,
};

/**
 * THIS DEVICE'S LAST CHOICE, OR THE DEFAULTS.
 *
 * ⚠ **AN UNKNOWN KEY IN THE STORED OBJECT IS IGNORED, NOT TRUSTED** — a fifth well
 * in a later build must not be able to arrive pre-collapsed from a stale write, and
 * a non-boolean value is a corrupt one.
 * ⚠ **EVERY ACCESS IS IN A `try`** and every failure is the defaults: storage
 * throws outright in a locked-down browser, and a collapsible section is not worth
 * a blank panel.
 */
function storedWells(): OpenMap {
  if (typeof window === "undefined") return WELLS_DEFAULT;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(AGENT_WELLS_STORAGE_KEY);
  } catch {
    return WELLS_DEFAULT;
  }
  if (!raw) return WELLS_DEFAULT;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...WELLS_DEFAULT };
    for (const well of AGENT_WELLS) {
      const value = parsed?.[well.id];
      if (typeof value === "boolean") next[well.id] = value;
    }
    return next;
  } catch {
    // a corrupt write is the defaults, never a crash
    return WELLS_DEFAULT;
  }
}

/**
 * WHICH WELLS ARE OPEN — **Recent open, the other three collapsed**, then whatever
 * this device last chose.
 *
 * ⚠ **PER DEVICE, NOT PER ACCOUNT, AND `localStorage` IS THE HONEST STORE FOR
 * THAT.** The Agents tab is already an OPERATOR surface over one machine's own
 * session feed (§5) — the server stores nothing about it — so a server-side
 * preference would be the only cross-machine fact on a tab that has none.
 * ⚠ **READ IN A LAZY INITIALISER, NOT IN AN EFFECT, AND THE SSR QUESTION IS
 * ANSWERED BY THE TAB ITSELF.** `setState` inside an effect body is a cascading
 * render this tree's lint forbids outright (`react-hooks/set-state-in-effect`) —
 * so the usual "paint the defaults, then correct them" shape is not available. It
 * is also not needed: **no well ever renders on a server.** `agents-tab.tsx`
 * returns its desktop-only sentence whenever `sessions === null`, which is what a
 * server render always sees, and the peer branch renders wells only for a list
 * that is empty until a client fetch resolves. The initialiser still guards
 * `typeof window` so the hook is honest on its own.
 * ⚠ The read itself, its `try` and its key filtering are {@link storedWells}.
 */
export function useAgentWells(): {
  isOpen: (id: AgentWellId) => boolean;
  toggle: (id: AgentWellId) => void;
} {
  const [open, setOpen] = useState<OpenMap>(storedWells);

  const toggle = useCallback((id: AgentWellId) => {
    setOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        window.localStorage.setItem(AGENT_WELLS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage unavailable — the choice still holds for this session
      }
      return next;
    });
  }, []);

  const isOpen = useCallback((id: AgentWellId) => open[id], [open]);
  return { isOpen, toggle };
}

/**
 * ONE WELL: a header row that toggles, and the cards when it is open.
 *
 * ⚠ **THE WHOLE HEADER ROW IS THE BUTTON, and the chevron is a `<span>` inside
 * it.** Samuel asked for the arrow on the right of the title; a nested `<button>`
 * is invalid HTML and would give a screen reader two controls for one act. The
 * 30px hit area is `NAKED_ICON_BUTTON`'s padding, unchanged.
 * ⚠ **THE HEADING IS STILL AN `h3` INSIDE THE BUTTON**, so the well stays a
 * landmark a reader can reach by role AND supplies the button's accessible name —
 * one text node, two jobs, no `aria-label` to drift from the visible word.
 * ⚠ **`TEMPLATE_NAME_TEXT`, BY IMPORT** — the type the /home Overview's **Credit
 * spend** heading wears (`pages/home/overview-panels.tsx`), which is what Samuel
 * named. ⚠ **NOT `TEMPLATE_NAME_TEXT_LG`**: that 18px face has exactly one reader,
 * the **Usage** panel heading, and he rejected its spread to Credit spend by name
 * the same day (*"I only asked you to change the usage size to be bigger"*).
 * ⚠ **COLLAPSED MEANS THE CARDS ARE NOT RENDERED**, not hidden — nothing on an
 * agent card is worth mounting behind a closed well, and `agent-delete.tsx`'s
 * hover affordances have no business existing where no one can see them.
 */
export function AgentWell({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={PANEL_WELL}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-[30px] w-full min-w-0 cursor-pointer items-center justify-between gap-2 pl-1 text-left"
      >
        <h3 className={cn("min-w-0 truncate", TEMPLATE_NAME_TEXT)}>{label}</h3>
        <span aria-hidden className={NAKED_ICON_BUTTON}>
          {open ? <ChevronDown size={NAKED_ICON} /> : <ChevronRight size={NAKED_ICON} />}
        </span>
      </button>
      {open && <div className={PANEL_ROWS}>{children}</div>}
    </section>
  );
}

/**
 * THE FOUR WELLS OVER ONE ORDERED LIST OF CARDS.
 *
 * ⚠ **THE CALLER'S ORDER SURVIVES INSIDE EVERY WELL.** The grouping is a single
 * forward pass into four arrays, so own-agents-first (§5) and the feed's own
 * thread grouping (`agents-model.ts › agentsForChannel`) reach each box intact.
 * Nothing here sorts.
 * ⚠ **`now` IS A PARAMETER WITH A DEFAULT**, so a test can state an age instead of
 * arranging for one; the render passes nothing.
 */
export function AgentWells({
  items,
  now,
}: {
  items: readonly AgentWellItem[];
  /** ⚠ NO `= Date.now()` DEFAULT HERE — that is an impure call during render
   *  (`react-hooks/purity`). The clock's default lives on {@link wellFor}, the
   *  pure function, exactly as `agents-model.ts › peerRowStale` holds its own. */
  now?: number;
}) {
  const { isOpen, toggle } = useAgentWells();
  const grouped = useMemo(() => {
    const out = new Map<AgentWellId, AgentWellItem[]>();
    for (const item of items) {
      const id = wellFor(item.at, now);
      const bucket = out.get(id);
      if (bucket) bucket.push(item);
      else out.set(id, [item]);
    }
    return out;
  }, [items, now]);

  return (
    <div className="flex flex-col gap-2">
      {AGENT_WELLS.map((well) => {
        const bucket = grouped.get(well.id);
        // ⚠ NOT RENDERED WHEN EMPTY — see the file docblock, which also records
        // that this is the one part of the ruling Samuel did not state.
        if (!bucket || bucket.length === 0) return null;
        return (
          <AgentWell
            key={well.id}
            label={well.label}
            open={isOpen(well.id)}
            onToggle={() => toggle(well.id)}
          >
            {/* ⚠ A `Fragment` KEY, NOT A WRAPPER `div` — the cards are the direct
                children of `PANEL_ROWS` exactly as they were the direct children
                of the flat column, so this ruling adds no box inside the well. */}
            {bucket.map((item) => (
              <Fragment key={item.key}>{item.node}</Fragment>
            ))}
          </AgentWell>
        );
      })}
    </div>
  );
}
