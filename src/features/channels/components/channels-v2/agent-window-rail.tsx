"use client";

/**
 * THE AGENT WINDOW'S "Other agents" RAIL — collapsible, on the window's gray (2026-09-13).
 *
 * 🔒 **SAMUEL:** *"on the left, you see that there is this collapsible side panel … for this, I want
 * to display 'Other agents' … It should just be the name of the agent, and then under that, it
 * should show 'Idle', 'Thinking', or 'Not idle', like 'Waiting', stuff like that, instead of the
 * timestamp."*
 *
 * 🔒 **THE SECOND PASS, SAME DAY, IS GEOMETRY AND IT LIVES IN `agent-window-frame.ts`:** the
 * collapsed tile is a PERFECT SQUARE (*"It has a longer width than height. It needs to be a perfect
 * square"*), the expanded rail is 2.5× the collapsed one and no more (*"the sidebar is just too
 * large"*), and the row's type is the SAME constant the tab strip's label wears. Every one of those
 * is an equality with a surface this file does not import, which is why the numbers are not here.
 *
 * ⚠ **THE SOURCE IS THIS MACHINE'S OWN SESSION FEED, NOT `lib/live-agents.ts`** (Desktop Agent
 * approved the swap, 2026-09-13). That module answers *which agents can be @-tagged on ONE
 * channel* and carries only a name — no `state` and no address — so it can answer neither the
 * second line nor the click. `use-desktop-sessions.ts › useDesktopSessions` is every session on
 * this machine across every channel, which is exactly the rail's question, and
 * `agents-model.ts › agentLiveness` is the ONE mapping from state to that second line (the same one
 * the chrome's badge and the Agents tab's cards read).
 *
 * ⚠ **ENDED ROWS ARE HIDDEN** (*"Ended agents are not listed"*). The feed retains seven days of
 * them (`main/session-summary.js › reportList`), and a rail is a list of things to open.
 *
 * ⚠ **NEVER A TIMESTAMP.** The state IS the second line; that is the whole instruction, and
 * `formatRelativeTime` deliberately does not appear in this file.
 */

import { PanelLeft } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import { agentDisplayName, agentLiveness } from "./agents-model";
import {
  AGENT_NAME_TEXT,
  AGENT_STATE_TEXT,
  RAIL_COLLAPSED,
  RAIL_EXPANDED,
  RAIL_PAD,
  TILE,
  TILE_RADIUS,
} from "./agent-window-frame";

/** ⚠ RE-EXPORTED, NOT RESTATED. The two widths moved into `agent-window-frame.ts` when the chrome
 *  had to read one of them to align the tab strip; this keeps every existing importer (and the
 *  shell) pointing at one declaration. */
export { RAIL_COLLAPSED, RAIL_EXPANDED };

/**
 * 🔒 **THE EXPANDED ROW IS THE TAB'S PADDING AND THE TAB'S TYPE** — *"I like the left side's smaller
 * padding"*, applied in the direction he asked for it: the TAB adopted this row's `px-2`, and the
 * row keeps it.
 */
const ROW_BASE =
  "flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left transition-colors";

/**
 * 🔒 **THE COLLAPSED ROW IS THE TILE ITSELF — a perfect square, and the shaded area IS the row**
 * (*"the shaded area for the currently selected agent, it is not a perfect square"*).
 *
 * ⚠ **WHAT WAS WRONG WAS NOT THE GLYPH, IT WAS THE BOX.** The row was `w-full` with `px-2 py-1.5`
 * around a `h-6` mark inside a rail padded `pl-2.5 pr-1` — so the tinted area measured 42×36 and
 * was neither square nor centred. A square cannot be produced by padding arithmetic that differs
 * left from right; the row has to BE `TILE` and the rail's padding has to be symmetric
 * (`RAIL_PAD`), which is why both constants are shared with the chrome.
 */
const TILE_ROW = `flex shrink-0 items-center justify-center transition-colors ${TILE} ${TILE_RADIUS}`;

/** The selected agent's shading — one face for both shapes, so the square and the row cannot drift
 *  into two different "selected" looks. ⚠ EXPORTED for `agent-window-rail.test.tsx`, which has to
 *  assert WHICH ELEMENT wears it (collapsed, the tinted element must be the square one). */
export const ROW_SELECTED_FACE = "bg-surface-raised-2";

/**
 * ONE ROW PER RUNNING AGENT, in the feed's own order.
 *
 * ⚠ **THE CLICK IS AN ADDRESS, NOT A ROUTE** — it hands (channel, thread, agent) up, and the host
 * asks main to open or focus that tab (`main/agent-window.js › openAgentWindow`, which fronts an
 * existing tab rather than adding a second). The rail therefore never has to know whether the agent
 * it names is already open.
 */
export function AgentWindowRail({
  sessions,
  activeKey,
  collapsed,
  onToggle,
  onOpen,
  keyFor,
}: {
  /** ⚠ `null` is "could not ask" (a browser, or a main without the feed) — NOT "no agents".
   *  The rail renders its chrome and no rows rather than claiming an empty machine. */
  sessions: readonly DesktopSessionSummary[] | null;
  activeKey: string;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (session: DesktopSessionSummary) => void;
  /** The tab key for a session — main's `agentWindowKey`, passed in so this file holds no copy
   *  of that rule. */
  keyFor: (session: DesktopSessionSummary) => string;
}) {
  const rows = (sessions ?? []).filter((s) => s.state !== "ended");
  return (
    <nav
      aria-label="Other agents"
      className={cn(
        // ⚠ `overflow-y-auto` AND `overflow-x-hidden`: the expanded rail is 140px and a long name
        // TRUNCATES (see `RAIL_EXPANDED`) — it must not be able to scroll sideways instead, which
        // would be the rail quietly granting itself the width Samuel took away.
        "flex shrink-0 flex-col gap-1 overflow-y-auto overflow-x-hidden pb-3 transition-[width]",
        RAIL_PAD,
        collapsed ? RAIL_COLLAPSED : RAIL_EXPANDED
      )}
    >
      {/* ⚠ THE TOGGLE IS THE TOP ROW IN BOTH STATES and it is the same control: collapsed it is the
          `PanelLeft` glyph alone in a tile, expanded it wears the word **Collapse**. Two controls
          would be two hit areas for one act. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Expand agents" : "Collapse agents"}
        className={cn(
          "text-text-secondary hover:bg-surface-raised-2",
          collapsed ? TILE_ROW : cn(ROW_BASE, "text-caption")
        )}
      >
        <PanelLeft size={14} aria-hidden="true" className="shrink-0" />
        {collapsed ? null : <span className="truncate">Collapse</span>}
      </button>
      {collapsed ? null : (
        <h2 className="px-2 pt-1.5 text-label font-semibold uppercase tracking-wide text-text-secondary">
          Agents
        </h2>
      )}
      {rows.map((session) => {
        const key = keyFor(session);
        const name = agentDisplayName(session);
        const live = agentLiveness(session);
        const selected = key === activeKey;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onOpen(session)}
            aria-current={selected ? "true" : undefined}
            title={collapsed ? `${name} — ${live.label}` : undefined}
            className={cn(
              "hover:bg-surface-raised-2",
              collapsed ? TILE_ROW : ROW_BASE,
              selected && ROW_SELECTED_FACE
            )}
          >
            {collapsed ? (
              // ⚠ COLLAPSED IS ONE MARK PER AGENT — its INITIAL, with the name and the state on
              // the tooltip. ⚠ NOT a shrunken `AgentLiveness`: that component's tone faces are
              // module-private to `agent-bits.tsx` (rightly — one liveness recipe), and a rail
              // that re-inked a dot itself would be a second mapping from state to colour.
              // ⚠ THE SPAN NO LONGER SIZES ANYTHING — the ROW is the square now, so this is the
              // glyph alone. A `h-6 w-full` here was half of why the tint was not square.
              <span aria-hidden="true" className={cn(AGENT_NAME_TEXT, "text-text-secondary")}>
                {name.replace(/^#/, "").charAt(0).toUpperCase() || "?"}
              </span>
            ) : (
              <span className="flex min-w-0 flex-col">
                {/* 🔒 THE TAB LABEL'S OWN TYPE, one constant (`AGENT_NAME_TEXT`) — a tab and a rail
                    row name the same thing and must not be two faces of it. */}
                <span className={cn("truncate text-text-primary", AGENT_NAME_TEXT)}>{name}</span>
                {/* 🔒 THE STATE, NEVER A TIMESTAMP — `agentLiveness`'s own word. */}
                <span className={cn("truncate", AGENT_STATE_TEXT)}>{live.label}</span>
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
