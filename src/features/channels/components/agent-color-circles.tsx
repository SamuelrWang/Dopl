"use client";

/**
 * Channels — **THE COLOUR ROW IN THE NEW-AGENT POPUP** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md item 7).
 *
 * His words: *"At the bottom, under Runtime, add multiple little circles that will act
 * as the color switcher … If that color already exists on the agent, that color should
 * be unselectable. That will be scoped to a channel, so if there are multiple users in
 * that channel, we need to make sure their agents should be pulled from the color. If
 * my agent is a specific shade of red, then the other user should not be able to launch
 * an agent with that specific color of red either."*
 *
 * ── ⚠ THE ROW IS A LABEL AND SIXTEEN CIRCLES, AND NOTHING ELSE ────────────────────
 *
 * No legend, no "colours already in use are dimmed" sentence, no count of what is left
 * — INVARIANTS §5's minimal-copy ruling, and the ONLY words on the row are the kit
 * label "Colour" (`shared/ui/form-dialog.tsx › FormSection`, so this row's label is
 * the same element and the same weight as Name / Identity / Model / Runtime, not a
 * second spelling of it). What a dimmed circle means is said by its `title`, on the one
 * circle it is true of, at the moment the operator reaches for it.
 *
 * ── ⚠ IT IS PURE, AND THE CHANNEL'S LIVE SESSIONS ARE THE DIALOG'S READ ───────────
 *
 * The taken set arrives as a PROP. `launch-agent-dialog.tsx` derives it from the live
 * sessions projection with {@link agentColorsTaken} — peer sessions and the operator's
 * own — because that projection is the one already on that surface for the @-picker,
 * and a component that fetched its own copy would answer a different question one push
 * later than the transcript's boxes do.
 *
 * ── ⚠ NO COLOUR VALUE APPEARS IN THIS FILE ────────────────────────────────────────
 *
 * `lib/agent-colors.ts › agentColorVar` is the only place a key becomes paint, and the
 * reference crosses into an inline `style` exactly as it does in
 * `agent-box-rule.ts › agentPostAccent` — read that file's own argument for why an inline style is
 * docs/DESIGN-SYSTEM.md honoured rather than bent: the palette member is chosen by
 * DATA, and a Tailwind class cannot be built from a runtime key.
 *
 * ⚠ **AND IT IS NOT `members/components/team-bits.tsx › ColorSwatchPicker`**, which is
 * the tree's other swatch row. Two reasons, either one sufficient: INVARIANTS §1
 * forbids `channels → members`, and that control takes HEX STRINGS and knows nothing
 * about a key being held by somebody else's agent. What this file does borrow from it
 * is the RING RECIPE (below), by reference in this comment rather than by import.
 */

import { useCallback, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { FormSection } from "@/shared/ui/form-dialog";
import { AGENT_COLOR_KEYS, agentColorVar, freeAgentColors } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";

/** ⚠ MODULE-SCOPE CONSTANTS, so an unwired caller's default prop is the SAME object on
 *  every render and the `useMemo` below does not recompute per keystroke in the dialog's
 *  name field. Same reason `launch-agent-dialog-runtime.ts` declares `EMPTY_RUNTIMES`. */
export const EMPTY_TAKEN: ReadonlySet<AgentColorKey> = new Set();
export const EMPTY_HOLDERS: ReadonlyMap<AgentColorKey, string> = new Map();

/**
 * **20px, WHICH IS THE RULING'S NUMBER** (*"multiple little circles"*, spec item 7).
 *
 * ⚠ SAID IN THE TREE'S FIXED-DOT IDIOM (`h-*` / `w-*` on the spacing scale — the
 * pill's `h-1.5 w-1.5` status dot, `bits.tsx`'s `h-4 w-4` glyph box,
 * `team-bits.tsx`'s `h-7 w-7` swatch), NOT as an arbitrary `h-[20px]`: this is a BOX
 * on the scale, and `h-5` is 20px there. docs/DESIGN-SYSTEM.md's ban is on raw px
 * FONT sizes and hand-rolled recipes; a box measured on the scale is neither.
 */
const CIRCLE = "h-5 w-5 shrink-0 rounded-full";

/** What the tooltip calls a holder this surface cannot name. ⚠ ONE DECLARATION for the two
 *  different absences that reach it — a live row carrying a blank name
 *  ({@link agentColorsTaken}) and a key in `taken` with no entry in `takenBy` at all — because
 *  a reader hovering two dimmed circles must not be told two different stories. */
const UNNAMED_HOLDER = "another agent";

/**
 * **THE SELECTED RING — OFFSET, AND IN THE CIRCLE'S OWN HUE.**
 *
 * ⚠ `ring-offset-2` IS WHAT MAKES IT VISIBLE AT ALL. A 2px ring in the same colour,
 * drawn flush against a 20px disc of that colour, is a 24px disc: the gap is the
 * signal, not the ring. The offset colour is the DIALOG's ground (`--bg-elevated`,
 * `settings-modal.module.css › .cardNarrow`) rather than `--modal-surface`, which is
 * the token `team-bits.tsx`'s copy of this recipe names and is NOT the ground this
 * control stands on.
 * ⚠ THE HUE IS THE CIRCLE'S, NOT THE INK. Sixteen hues against one black ring would
 * read as sixteen different amounts of selection; its own colour reads as the same
 * emphasis on every key.
 */
const RING = "ring-2 ring-offset-2 ring-offset-bg-elevated";

/**
 * **WHICH KEYS THIS CHANNEL'S LIVE AGENTS HOLD, AND WHO HOLDS EACH ONE.**
 *
 * ⚠ **`state !== "ended"` IS THE WHOLE LIVENESS TEST, AND IT IS SAMUEL'S SENTENCE:**
 * *"once the agent has ended, that color needs to be returned to the color bank to be
 * used again"*. `agents-model.ts › agentLiveness` maps the same wire value — `ended`
 * is its one non-live tone, and Thinking / Idle / Waiting are all live and all hold
 * their colour. A projection row that has not reported a state yet is treated as LIVE:
 * offering a key that is about to come back 409 is the cheap failure, and quietly
 * handing two agents one colour is the expensive one.
 *
 * ⚠ **A ROW WITH NO COLOUR TAKES NOTHING OUT OF THE BANK.** An older desktop reports
 * none, and a room whose sixteen keys are all out has live agents holding `null`
 * (`lib/agent-colors.ts › firstFreeAgentColor` returns `null` rather than refusing a
 * launch). Neither may narrow anybody else's choice.
 *
 * ⚠ **FIRST WRITER WINS PER KEY**, which matters only in the moment the server's
 * uniqueness index is about to be the authority anyway (two rows briefly carrying one
 * key across a launch/end race). The name in the tooltip is then the older session's —
 * a cosmetic difference, and picking the "right" one here would be this surface
 * arbitrating something the index decides.
 */
export function agentColorsTaken(
  sessions: ReadonlyArray<{
    /** ⚠ **OPTIONAL SINCE 2026-09-13, AND ABSENT READS AS LIVE** — which is what this block
     *  already said about a row that has not reported a state. It is what lets the COMPOSER's
     *  mount hand over `lib/live-agents.ts`'s peer ∪ own union, whose rows carry no `state`
     *  because that function has already dropped every ended one. Narrowing them into a fake
     *  `state` at the call site would be a second liveness rule. */
    state?: string | null;
    color?: AgentColorKey | null;
    agentId?: string | null;
    name?: string | null;
    displayName?: string | null;
  }>
): { taken: ReadonlySet<AgentColorKey>; takenBy: ReadonlyMap<AgentColorKey, string> } {
  const takenBy = new Map<AgentColorKey, string>();
  for (const session of sessions) {
    if (session.state === "ended" || !session.color) continue;
    if (takenBy.has(session.color)) continue;
    // ⚠ THE NAME IS RESOLVED BY THE CALLER'S OWN HELPER, NOT SPELLED HERE — the pills,
    // the wells and this tooltip must say the same thing about the same agent, and
    // `agents-model.ts › agentDisplayName` is where that fallback chain lives. This
    // function takes the ALREADY-RESOLVED string through `displayName` when the caller
    // has one and degrades to the handle, which every projection row carries.
    const label = (session.displayName || session.name || "").trim();
    takenBy.set(session.color, label || UNNAMED_HOLDER);
  }
  return { taken: new Set(takenBy.keys()), takenBy };
}

export function AgentColorCircles({
  value,
  onChange,
  taken = EMPTY_TAKEN,
  takenBy = EMPTY_HOLDERS,
}: {
  /**
   * THE OPERATOR'S PICK, or the FIRST-FREE key the dialog is showing on their behalf.
   *
   * ⚠ THIS COMPONENT DOES NOT COMPUTE THE DEFAULT and must not learn to. The dialog
   * derives it (`launch-agent-dialog.tsx › effectiveColor`) for the same reason the
   * Model row's default is derived there: the displayed default and the value that
   * goes on the wire are two different facts, and only the dialog knows both.
   */
  value: AgentColorKey | null;
  onChange: (next: AgentColorKey) => void;
  /**
   * EVERY KEY A LIVE AGENT IN THIS CHANNEL HOLDS — the FENCE.
   *
   * ⚠ **OPTIONAL, DEFAULTING TO EMPTY, BECAUSE AN UNWIRED CALLER MUST STILL RENDER A
   * WORKING ROW.** Empty means "nothing known to be taken", never "nothing is taken":
   * the server's partial unique index is the actual authority (spec item 1) and answers
   * 409 with the free set, so a row that has not been handed the projection offers
   * every key and is corrected at launch. The alternative — no row until the data
   * arrives — would hide the control on exactly the surfaces that have not been threaded
   * yet.
   */
  taken?: ReadonlySet<AgentColorKey>;
  /**
   * KEY → THE NAME OF THE AGENT HOLDING IT, for the `title` alone.
   *
   * ⚠ **TWO PROPS AND NOT ONE MAP, AND THE REASON IS WHICH ONE IS LOAD-BEARING.** The
   * SET disables; the MAP only labels. A key held by an agent this surface cannot name
   * (an older projection carries no `displayName`, a row arrives mid-push) must still be
   * unselectable — so a missing entry here degrades the sentence and never unlocks the
   * circle.
   */
  takenBy?: ReadonlyMap<AgentColorKey, string>;
}) {
  /** Bank order, taken keys removed — the keyboard's travel path AND the arrow keys'
   *  skip rule in one array (`lib/agent-colors.ts › freeAgentColors`). */
  const free = useMemo(() => freeAgentColors(taken), [taken]);
  const circles = useRef(new Map<AgentColorKey, HTMLButtonElement | null>());

  /**
   * ARROW KEYS MOVE THE SELECTION ALONG THE FREE KEYS AND WRAP.
   *
   * ⚠ **THIS IS WHY THE CIRCLES ARE BUTTONS WITH `role="radio"` RATHER THAN NATIVE
   * `<input type="radio">`.** A native radio group's arrow keys are the browser's, and
   * they will happily land on — and CHECK — a radio that is `aria-disabled`: the
   * attribute is a promise to assistive tech, not a behaviour. Only `disabled` stops
   * them, and a `disabled` button renders no `title` in Chrome, which is the one
   * sentence that says WHY the circle cannot be picked. So the fence lives in the
   * handlers, in ONE place, and both paths pass through it.
   * ⚠ A SELECTION THAT MOVES ALSO MOVES FOCUS — the roving `tabIndex` follows `value`,
   * so without this the focused circle would be the one the operator just left.
   */
  const step = useCallback(
    (delta: 1 | -1) => {
      if (free.length === 0) return;
      const at = value ? free.indexOf(value) : -1;
      // ⚠ AN UNSELECTABLE OR ABSENT CURRENT KEY ENTERS AT EITHER END: forward lands on
      // the first free key, backward on the last, which is what a group whose selection
      // is not in the travel path has to do to be reachable at all.
      const base = at >= 0 ? at : delta === 1 ? -1 : 0;
      const next = free[(base + delta + free.length) % free.length];
      onChange(next);
      circles.current.get(next)?.focus();
    },
    [free, value, onChange]
  );

  /**
   * Which circle Tab reaches — the selected one, else the first selectable one. ⚠ ONE
   * stop for the whole group (roving `tabIndex`), because sixteen tab stops in the
   * middle of a five-field form is what a radiogroup exists to avoid.
   *
   * ⚠ **A FULL BANK STILL HAS A TAB STOP, AND THE FALLBACK IS THE LAST TERM (2026-09-14).**
   * With all sixteen keys out, `free` is empty and `value` is `null` (`firstFreeAgentColor`
   * answers none), so every circle would have carried `tabIndex={-1}` and the row would have
   * been unreachable by keyboard ENTIRELY — no focus, and therefore no `title`, which is the
   * one sentence saying WHY nothing can be picked. Landing on a held circle whose Enter does
   * nothing is the honest version of a control that cannot act (the same reading
   * `aria-disabled` already gives assistive tech); an unreachable group is the silent one.
   */
  const tabStop =
    value && free.includes(value) ? value : (free[0] ?? AGENT_COLOR_KEYS[0]);

  return (
    <FormSection label="Colour">
      {/* ⚠ `aria-label` IS REQUIRED HERE FOR `PillChoice`'s OWN REASON: the visible
          "Colour" above the row is a `<span>` (a `<label>` wrapping sixteen radios
          would make the word itself pick the first one), so without this the group has
          no accessible name. */}
      <div role="radiogroup" aria-label="Agent colour" className="flex flex-wrap gap-2">
        {AGENT_COLOR_KEYS.map((key) => {
          const held = taken.has(key);
          const checked = key === value;
          const paint = agentColorVar(key);
          return (
            <button
              key={key}
              ref={(el) => {
                circles.current.set(key, el);
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              /* ⚠ `aria-disabled`, NEVER `disabled` (the ruling's own word). See
                 {@link step}: `disabled` would suppress the `title` that is the only
                 explanation this circle can give, and the fence has to be in the
                 handler for the keyboard path regardless. */
              aria-disabled={held || undefined}
              /* ⚠ THE KEY IS THE ACCESSIBLE NAME because it is the only name this
                 colour has. Sixteen invented words ("Crimson", "Teal") would be a
                 second authority on a palette whose values live in two CSS files and
                 get retuned there — the day a hue moves, the name would lie. */
              aria-label={key}
              /* ⚠ ONE SHORT SENTENCE, ON THE ONE CIRCLE IT IS TRUE OF (the ruling:
                 `title="In use by <agent name>"`). This is not the minimal-copy
                 exception the runtime warning is — nothing is rendered until the
                 operator hovers the thing it is about. */
              title={held ? `In use by ${takenBy.get(key) ?? UNNAMED_HOLDER}` : undefined}
              /* A stable hook for the suites and for a host's scoped restyle, never
                 read back by this tree — `attribution-pill.tsx`'s own precedent, and
                 the KEY rather than the paint for the same reason. */
              data-agent-color={key}
              tabIndex={key === tabStop ? 0 : -1}
              onClick={() => {
                // ⚠ THE GUARD IS THE FEATURE (Samuel: *"that color should be
                // unselectable"*). `aria-disabled` alone is a label; this is the fence.
                if (held) return;
                onChange(key);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  step(1);
                } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  step(-1);
                }
              }}
              className={cn(
                CIRCLE,
                // ⚠ 35% IS THE RULING'S NUMBER, and it is on the CIRCLE: dimming the
                // ring instead would dim a selection that cannot exist on a held key.
                held ? "cursor-not-allowed opacity-35" : "cursor-pointer",
                checked && RING
              )}
              style={{
                backgroundColor: paint,
                // ⚠ THE RING COLOUR IS THE ONE VALUE TAILWIND CANNOT CARRY FOR A
                // RUNTIME KEY, so it rides the same `var()` reference as the fill
                // through Tailwind's own ring variable — the recipe `team-bits.tsx`
                // uses, with a token in place of its hex.
                ...(checked ? { ["--tw-ring-color" as string]: paint } : {}),
              }}
            />
          );
        })}
      </div>
    </FormSection>
  );
}
