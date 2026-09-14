"use client";

/**
 * THE AGENT WINDOW'S CHROME — the mark, the TAB STRIP, and the window controls (2026-09-13).
 *
 * 🔒 **SAMUEL, over Wispr Flow's pop-out:** *"There are tabs, and the active tab is underlined.
 * It's a fixed size, and it does not get cut off. You see there's a little X button, so you can
 * see I can add a new tab, stuff like that. … We're moving the logo out to the top left."*
 *
 * ⚠ **IT WAS `agent-window.tsx › AgentWindowHeader` AND IT MOVED WHOLE.** The drag region, the
 * mark, the status badge and the expand/close pair are the SAME code, re-laid-out around the
 * strip — not rewritten. The file split is §1's cap: `agent-window.tsx` was at 470 lines and the
 * strip, the rail and the shell do not fit under it. `agent-window-chrome.test.tsx` already
 * carried this surface's pins and now reads THIS file.
 *
 * ⚠ **THE NAME AND THE THREAD LINE LEFT THE BAR WITH THE TABS.** A tab already says which agent
 * it is, so a second copy of the active agent's name beside the strip is the same fact twice; the
 * thread line moved into the inset panel's own head (`agent-window.tsx`). What stays here is what
 * belongs to the WINDOW rather than to an agent: the mark, the strip, the ACTIVE tab's status, and
 * the two window buttons.
 *
 * ⚠ **THE DRAG REGION IS STILL THE BAR'S AND THE CONTROLS STILL OPT OUT.** A frameless window has
 * nothing else to grab (`main/agent-window.js` takes `frame: false`), and a button inside a drag
 * region swallows its own click. The TABS opt out too — they are controls.
 */

import type { ReactNode } from "react";
import { Maximize2, Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import {
  canControlOwnWindow,
  closeOwnWindow,
  toggleOwnWindowMaximize,
} from "@/shared/lib/spa-bridge-window";
import { IconButton } from "./icon-button";
import {
  AGENT_NAME_TEXT,
  CHROME_ROW,
  FRAME_GAP,
  RAIL_COLLAPSED,
  RAIL_PAD,
  TAB_UNDERLINE,
  TILE,
  TILE_RADIUS,
} from "./agent-window-frame";

/**
 * ⚠ INLINE, NOT A CLASS. `-webkit-app-region` is not in `csstype`, so the cast is required; it is
 * also not a design token, so it belongs in neither `globals.css` nor the SPA's `tokens.css`
 * (`scripts/check-css-token-drift.ts` holds those two equal). Pinned as SOURCE in
 * `agent-window-chrome.test.tsx` — jsdom drops properties it does not know, so a render assertion
 * would pass while the real window sat frozen on screen.
 */
export const DRAG_REGION = { WebkitAppRegion: "drag" } as React.CSSProperties;
export const NO_DRAG_REGION = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

/** The window buttons' naked glyphs — `IconButton bare` re-inked and re-boxed to the Wispr scale:
 *  a 30px hit area (`--action-h-sm`'s number) around an 18px glyph, muted at rest. */
const WINDOW_GLYPH = "h-[30px] w-[30px] text-text-muted hover:text-text-primary";

/**
 * ONE TAB, AS THE STRIP NEEDS IT — the address main pushed, plus the name and status this side
 * resolves from its own feed (`agents-model.ts › agentDisplayName` / `› agentLiveness`).
 */
export interface AgentTabView {
  key: string;
  /** Already resolved — never a raw agent id (INVARIANTS §5). */
  name: string;
}

/**
 * 🔒 **FIXED WIDTH, TRUNCATED, NEVER CUT OFF** (*"It's a fixed size, and it does not get cut
 * off"*). `w-[180px]` with `shrink-0`, the name on `truncate`: the tab's BOX never changes with
 * its label, and a long name ends in an ellipsis inside its own tab rather than pushing the strip.
 * ⚠ The strip itself scrolls horizontally (`overflow-x-auto`) rather than squeezing tabs — four is
 * the ceiling main enforces (`MAX_AGENT_TABS`), so the scroller is a floor-guard for a narrow
 * window and not the normal case.
 */
const TAB_WIDTH = "w-[180px] shrink-0";

/**
 * THE ACTIVE TAB'S MARK IS AN UNDERLINE, at the POPUP FIELD's thickness — `agent-window-frame.ts ›
 * TAB_UNDERLINE` carries Samuel's *"it should be that thickness"* and the cross-file check that
 * holds it there. ⚠ NOT a raised chip and not a fill: this row sits on the window's gray chrome,
 * where an elevated face would read as a second kind of control beside the mark.
 *
 * 🔒 **THE PADDING IS THE RAIL'S** (*"I like the left side's smaller padding"*) — `px-2`, the same
 * step the rail's rows take, so a tab and a rail row are the same object in two places rather than
 * two controls that happen to name the same agent.
 * 🔒 **AND SO IS THE TYPE** — `AGENT_NAME_TEXT`, one constant for both (see it for the ruling that
 * rejected the 14px face). The INK stays here because it is the tab's STATE.
 */
const TAB_BASE =
  "group relative flex h-[34px] items-center gap-1.5 rounded-[8px] px-2 transition-colors";
const TAB_ACTIVE = "text-text-primary";
const TAB_IDLE = "text-text-secondary hover:text-text-primary";

export function AgentWindowChrome({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onNewAgent,
  status,
  logoSrc,
  railWidth = RAIL_COLLAPSED,
}: {
  tabs: readonly AgentTabView[];
  activeKey: string;
  onSelect: (key: string) => void;
  /**
   * ⚠ MAIN CLOSES THE TAB AND THE WINDOW WITH THE LAST ONE — this only reports the click
   * (`spa-bridge-window.ts › closeOwnTab`).
   *
   * ⚠ **OPTIONAL SINCE 2026-09-14, AND ABSENT DRAWS NO × AT ALL** — the same
   * feature-detection rule {@link onNewAgent} follows and the window buttons follow: a main
   * without the tab ops (`spa-bridge-window.ts › canHostAgentTabs`) cannot close anything,
   * and a × that reports into a void looks exactly like a working one. **Absent, never
   * disabled** (INVARIANTS §11).
   */
  onClose?: (key: string) => void;
  /**
   * THE "+" — a new agent on the ACTIVE tab's channel.
   * ⚠ ABSENT MEANS NO "+" IS DRAWN, which is the same feature-detection rule the window buttons
   * follow: a control that cannot act must not be on screen (INVARIANTS §11).
   */
  onNewAgent?: () => void;
  /** The ACTIVE tab's badge — `AgentEndedPill` or `AgentLiveness`, built by the caller so this
   *  file owns no mapping from state to words. */
  status?: ReactNode;
  logoSrc?: string;
  /**
   * 🔒 **THE RAIL'S CURRENT WIDTH, SO THE STRIP CAN START WHERE THE PANEL DOES** (Samuel: *"The
   * things just don't align. Where you see the name of the agent at the top, the tab switcher
   * should start on the left side and be aligned with the start of the white panel."*).
   *
   * ⚠ **THE CHROME CANNOT DERIVE THIS AND MUST NOT TRY.** Collapsed-ness is the SHELL's state
   * (`agent-window-shell.tsx`), and the panel's left edge is `railWidth + FRAME_GAP` — so the one
   * honest way for two rows in different components to share an x is for the same class to reach
   * both. A default is supplied so a caller that predates this prop renders the collapsed
   * alignment rather than no alignment at all.
   */
  railWidth?: string;
}) {
  const canControlWindow = canControlOwnWindow();
  return (
    <header
      style={DRAG_REGION}
      className={cn("flex shrink-0 items-center pr-2.5", CHROME_ROW, FRAME_GAP)}
    >
      {/* 🔒 THE MARK SITS IN THE RAIL'S COLUMN, AT THE RAIL'S OWN x — a slot exactly the rail's
          width, with the rail's padding, so the logo and the tiles below it share one left edge
          (*"That kind of needs to be normalized"*). The slot GROWS with the rail, which is what
          keeps the strip beside it starting at the panel's edge in both states; the mark itself
          does not move, because `RAIL_PAD` is the same either way. */}
      <div className={cn("flex shrink-0 items-center", railWidth, RAIL_PAD)}>
        {logoSrc ? (
          // 🔒 THE SAME SQUARE AS THE SELECTED AGENT'S TILE (*"increase the size of the Dopl logo.
          // It should be the exact same size"*) — `TILE`, one constant, not a second 36.
          // ⚠ IT WAS 24px IN A 44px ROW, which is where *"increase the size"* came from. The mark
          // SCALES INSIDE the square (`object-contain`): the tile is the geometry, the artwork
          // fills it without being stretched to a shape it was not drawn at.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt=""
            className={cn("shrink-0 object-contain", TILE, TILE_RADIUS)}
          />
        ) : null}
      </div>
      <div
        style={NO_DRAG_REGION}
        role="tablist"
        aria-label="Open agents"
        className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
      >
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <div key={tab.key} className={cn(TAB_BASE, TAB_WIDTH, active ? TAB_ACTIVE : TAB_IDLE)}>
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(tab.key)}
                className={cn("min-w-0 flex-1 truncate text-left", AGENT_NAME_TEXT)}
              >
                {tab.name}
              </button>
              {/* ⚠ ON THE ACTIVE TAB ALWAYS, ON THE OTHERS ON HOVER (Samuel's *"a little X
                  button"*). It is `opacity`, never `hidden`: a control that appears on hover must
                  still hold its place, or every tab's label reflows under the pointer.
                  ⚠ AND NO × AT ALL WITHOUT AN `onClose` — see the prop. */}
              {onClose ? (
                <button
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  onClick={() => onClose(tab.key)}
                  className={cn(
                    "shrink-0 rounded-[6px] p-0.5 text-text-muted transition-opacity hover:text-text-primary",
                    active ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                  )}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              ) : null}
              {/* ⚠ `data-tab-underline` IS FOR THE PIN, and it is an attribute rather than a class
                  fragment on purpose: the rule's geometry is a constant now, and a test that
                  grepped its spelling would fail on every re-position of something it is not
                  about. */}
              {active ? (
                <span aria-hidden="true" data-tab-underline="" className={TAB_UNDERLINE} />
              ) : null}
            </div>
          );
        })}
        {onNewAgent ? (
          <button
            type="button"
            aria-label="New agent"
            onClick={onNewAgent}
            className="shrink-0 rounded-[8px] p-1.5 text-text-muted transition-colors hover:text-text-primary"
          >
            <Plus size={14} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* 🔒 THE RIGHT GROUP NEVER LEAVES THE WINDOW (*"the top right, all of those things just get
          pushed out. That needs to be fixed."*). `shrink-0` is what it always wore; what was
          missing is the `min-w-0` chain that lets the STRIP and the PANEL give way instead — see
          `agent-window-frame.ts › INSET_PANEL`. Two halves of one bug: without the second, this
          group is pushed past a root that clips. */}
      <span style={NO_DRAG_REGION} className="flex shrink-0 items-center gap-0.5">
        {status}
        {canControlWindow ? (
          <>
            <IconButton
              bare
              icon={Maximize2}
              size={18}
              label="Expand"
              className={WINDOW_GLYPH}
              onClick={() => void toggleOwnWindowMaximize()}
            />
            <IconButton
              bare
              icon={X}
              size={18}
              label="Close"
              className={WINDOW_GLYPH}
              onClick={() => void closeOwnWindow()}
            />
          </>
        ) : null}
      </span>
    </header>
  );
}
