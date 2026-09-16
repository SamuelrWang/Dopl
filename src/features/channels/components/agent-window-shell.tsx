"use client";

/**
 * THE AGENT WINDOW'S SHELL — chrome over a rail beside an INSET white panel (2026-09-13).
 *
 * 🔒 **SAMUEL, verbatim:** *"notice that it's a white panel that's inset now on a darker
 * background. … everything that's currently in the popout agent window needs to be moved. That
 * window currently needs to be condensed to the right and under a little bit so that we can add
 * that gray background. It should be the same color that we have on our current site."*
 *
 * 🔒 **THIS SUPERSEDES THE 2026-08-27 "THE POP-OUT IS THE PANEL, EDGE TO EDGE" RULING.** That one
 * said a pop-out has no frame to be a level of and must paint `--panel-surface` to its own edges;
 * Samuel has now ruled the opposite for THIS window, and named the ground: the site gray, which is
 * `--home-panel` (`docs/DESIGN-SYSTEM.md`'s frame model, level 1). So the window is now
 * **frame(gray) → inset card(white)**, the same alternation every other surface in the app wears.
 * The pins moved with it — `pages/agent-window/frame.test.ts` and
 * `components/app-shell/frame-palette.test.ts` — rather than being deleted, because the NEW shape
 * needs holding exactly as the old one did.
 *
 * ⚠ **THE WINDOW SIZE IS UNTOUCHED** (*"Don't change the current window size"*): 510×560 stays in
 * `main/agent-window.js`. The inset is `gap-3` of gray, not a bigger window.
 *
 * ⚠ **THE TABS' STATE IS THE HOST PAGE'S, NOT THIS COMPONENT'S** — main owns the SET and the page
 * owns which one is shown (`pages/agent-window/index.tsx`). This file is layout: it renders the
 * chrome, the rail and whatever content the host hands it, and it is router-free like every file in
 * this tree.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/shared/lib/utils";
// ⚠ THE ONE MEMBERSHIP TEST FOR A COLOUR KEY. The feed's `color` is a plain `string` on the wire
// (`src/shared/` may not import `features/channels`, and a closed union there would let a newer
// desktop's seventeenth key typecheck past the gate), so this file narrows rather than casts.
import { agentColorOrNull } from "../lib/agent-colors";
import { AgentWindowChrome, type AgentTabView } from "./agent-window-chrome";
import { AgentWindowRail } from "./agent-window-rail";
import {
  FRAME_GAP,
  INSET_PANEL,
  RAIL_COLLAPSED,
  RAIL_EXPANDED,
  RAIL_PAD,
  RAIL_PAD_COLLAPSED,
} from "./agent-window-frame";
import type { DesktopSessionSummary } from "@/shared/lib/spa-bridge";
import type { AgentColorKey } from "../types";

/** ⚠ RE-EXPORTED, NOT RESTATED — the face moved into `agent-window-frame.ts` (which is also where
 *  the `min-w-0` argument now lives, because the chrome and this file are two halves of it) and
 *  `pages/agent-window/frame.test.ts` still reads the shell for the ground. */
export { INSET_PANEL };

/**
 * 🔒 **THE RAIL'S COLOUR DOT, FROM THIS MACHINE'S OWN FEED** (2026-09-14 ruling;
 * docs/specs/agent-colors.md item 8).
 *
 * ⚠ **THE PROP EXISTED AND NOTHING PASSED IT**, so the pop-out rail drew no dot at all — half
 * the ruling shipped as a declared prop over an empty screen. This window reads no channel
 * projection BY DESIGN (`agent-window-launch.tsx › NO_ROSTER` carries that argument: no roster
 * request and no presence poll), so the own feed is the only source it has — and it is a good
 * one. `spa-bridge-shapes.ts › DesktopSessionSummary.color` is the key this machine ASKED for
 * and has held since (`main/session-summary.js › liveSummary` reports it), which EQUALS the
 * server's assignment in every case except a push substitution — and a substituted key is
 * re-pushed into this same feed, so the rail agrees with the transcript after one push.
 *
 * ⚠ **NARROWED, NEVER CAST** — an unrecognised key must read as "no colour" rather than reach a
 * `var(--agent-color-…)` that resolves to nothing and paints an invisible dot.
 * ⚠ **MODULE SCOPE, NOT AN INLINE ARROW**: one identity for every render, so the rail's rows do
 * not see a new resolver on each of the feed's ~5-per-second telemetry pushes.
 */
function colorFromOwnFeed(session: DesktopSessionSummary): AgentColorKey | null {
  return agentColorOrNull(session.color);
}

export function AgentWindowShell({
  tabs,
  activeKey,
  onSelect,
  onCloseTab,
  onNewAgent,
  logoSrc,
  sessions,
  onOpenSession,
  keyFor,
  children,
}: {
  tabs: readonly AgentTabView[];
  activeKey: string;
  onSelect: (key: string) => void;
  /** ⚠ **OPTIONAL SINCE 2026-09-14, LIKE {@link onNewAgent}** — a main without the tab ops
   *  (`spa-bridge-window.ts › canHostAgentTabs`) cannot close a tab, and the chrome then draws
   *  NO ×: absent, never disabled (INVARIANTS §11). */
  onCloseTab?: (key: string) => void;
  onNewAgent?: () => void;
  // ⚠ **THERE IS NO `status` SLOT SINCE 2026-09-15** — both badges moved onto the agent view's
  // thread line (`agent-window.tsx › AgentWorkingOn`) and the prop was DELETED rather than left
  // empty (delete-don't-disarm). A `//` note, not a docblock: it belongs to no prop below it.
  logoSrc?: string;
  sessions: readonly DesktopSessionSummary[] | null;
  onOpenSession: (session: DesktopSessionSummary) => void;
  keyFor: (session: DesktopSessionSummary) => string;
  /** The ACTIVE tab's agent view — one mounted at a time. */
  children: ReactNode;
}) {
  // ⚠ COLLAPSED BY DEFAULT, AND SESSION-LOCAL. The window is 510px wide, so even the 140px rail
  // Samuel capped the expansion at (`agent-window-frame.ts › RAIL_EXPANDED`) costs the agent's own
  // panel a quarter of its width on first paint — and the panel is what the window's 510 is a
  // MEASUREMENT of (`main/agent-window.js`'s width derivation). Nothing is persisted — there is no ruling asking
  // for a remembered rail, and a window that opens differently for the same operator each time is
  // a worse default than one that always opens the same way.
  const [collapsed, setCollapsed] = useState(true);
  const railWidth = collapsed ? RAIL_COLLAPSED : RAIL_EXPANDED;
  // 🔒 THE PAD TRAVELS WITH THE WIDTH (2026-09-15). The collapsed rail's padding is asymmetric so
  // the icon reads centred in the gutter between the window's edge and the panel's
  // (`agent-window-frame.ts › RAIL_PAD_COLLAPSED`), and the Dopl mark sits in that same column —
  // so the chrome has to be TOLD, for the same reason it is told the width rather than deriving
  // collapsed-ness.
  const railPad = collapsed ? RAIL_PAD_COLLAPSED : RAIL_PAD;
  return (
    // 🔒 THE GRAY GROUND — `bg-home-panel`, the site's own panel gray, by token.
    //
    // 🔒 **`min-w-0` IS THE ROOT OF *"the right side just gets completely cut off"* (Samuel,
    // 2026-09-13).** This column is a flex ITEM of `app-shell.module.css › .windowSurface`, and a
    // flex item's automatic minimum size is its CONTENT's min-content width — so without this the
    // column could not be narrower than the posture row inside it, and `.root` (`overflow: hidden`)
    // simply CLIPPED whatever did not fit. Expanding the rail widened that min-content floor, which
    // is why the symptom appeared on expand: the panel and the chrome's right-hand controls were
    // pushed off the window rather than shrinking. The panel was already `min-w-0 flex-1`; a chain
    // with one link missing shrinks nothing.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-home-panel antialiased">
      <AgentWindowChrome
        tabs={tabs}
        activeKey={activeKey}
        onSelect={onSelect}
        onClose={onCloseTab}
        onNewAgent={onNewAgent}
        logoSrc={logoSrc}
        // 🔒 THE ALIGNMENT: the strip starts at `railWidth + FRAME_GAP`, which IS the panel's left
        // edge, and the mark sits in the rail's own column above the toggle.
        railWidth={railWidth}
        railPad={railPad}
      />
      {/* ⚠ THE INSET IS THE GAP, and it is `gap-3` on three sides plus the chrome above: the panel
          is "condensed to the right and under a little bit" exactly as asked, with the rail
          occupying the gray to its left. */}
      <div className={cn("flex min-h-0 min-w-0 flex-1 pb-3 pr-3", FRAME_GAP)}>
        <AgentWindowRail
          sessions={sessions}
          activeKey={activeKey}
          collapsed={collapsed}
          onToggle={() => setCollapsed((on) => !on)}
          onOpen={onOpenSession}
          keyFor={keyFor}
          colorFor={colorFromOwnFeed}
        />
        <section className={INSET_PANEL} aria-label="Agent">
          {children}
        </section>
      </div>
    </div>
  );
}
