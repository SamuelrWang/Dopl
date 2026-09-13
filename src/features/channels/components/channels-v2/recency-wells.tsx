"use client";

/**
 * THE FOUR GRAY RECENCY WELLS — **Recent / Last 7 days / Last 30 days /
 * Earlier**, each one collapsible, each holding whatever white cards or rows the
 * caller hands it, filed by ONE timestamp per item.
 *
 * 🔒 **SAMUEL, 2026-09-13, over the Agents tab:** *"On the overview page we see
 * that gray background thing. I like that gray background right behind the white
 * pane. … Each one will have a header that says Recent. Inside that little area
 * we're going to have all the agents that were active in the last 24 hours …
 * Below that would be another one … last seven days … and then under that would
 * be like last thirty days … And then one more that says like earlier … I want
 * these gray boxes to be collapsible. … the title of the text on the left. The
 * right side, add like an arrow, like a down arrow and like a right arrow … down
 * arrow if it's been opened up, and … a right arrow if it is collapsed. … the
 * header … font size and font styling, it should be the same as … the credit
 * spend."*
 *
 * 🔒 **AND OVER THE THREADS TAB THE SAME DAY:** *"for the threads page/tab, I
 * want you to add the same gray backgrounds that we added to the Agents tab.
 * Basically, Recent, last 7 days, etc. This should be measured on activity
 * (basically, last message sent into the thread)."* **THE SECOND SURFACE IS WHY
 * THIS MODULE EXISTS.** It was `agents-wells.tsx` in full until that ruling; the
 * machinery is here and that file is now a thin consumer, so the two surfaces
 * cannot drift in geometry, in motion, or in what a missing stamp means. Each
 * consumer keeps only (a) the expression that dates ITS rows and (b) its own
 * `localStorage` key.
 *
 * ⚠ **A BUCKET IS ABOUT TIME, NEVER ABOUT STATE.** Nothing here reads a status,
 * a liveness or a mode, and nothing here may start to — an ended agent and a
 * quiet thread sit in whichever well their last activity falls in, which is the
 * whole of Samuel's *"if it's an ended agent but they were active last thirty
 * days … that should be in … the respective gray boxes"*. State is already said
 * on the card, and saying it twice, once as a heading, is how the two come to
 * disagree.
 *
 * ⚠ **THE WELL IS THE /home OVERVIEW'S, REACHED BY IMPORT** —
 * `shared/ui/panel-well.ts › PANEL_WELL`, which is `SECTION_PANEL_SHELL` +
 * `bg-home-panel` and NO hairline. The cards inside stay exactly the cards they
 * were, at exactly the gap they had (`PANEL_ROWS`): this ruling added a GROUND
 * under a column, it did not restyle the column.
 *
 * ⚠ **AN EMPTY WELL IS NOT RENDERED, AND SAMUEL DID NOT RULE ON IT.** Four
 * headings over three empty boxes would make "nothing older than a month" and
 * "rows you have not scrolled to" the same picture, and each consuming tab
 * already has one sentence for the genuinely-empty case. Flagged rather than
 * assumed.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
// ⚠ CROSS-FEATURE, AND DELIBERATELY THE SMALLER OF TWO EVILS. `docs/INVARIANTS.md`
// §1 forbids it and F-275 records that this tree has never obeyed the rule;
// `agents-tab.tsx` has imported `agent-templates/components/template-picker` since
// 2026-08-22. `TEMPLATE_NAME_TEXT` was EXPORTED on 2026-09-13 precisely so a second
// surface could read the type Samuel names by pointing at it, and this heading is
// the third reader (for both tabs at once, since the extraction).
import { TEMPLATE_NAME_TEXT } from "@/features/agent-templates/components/template-section";
import { cn } from "@/shared/lib/utils";
import { NAKED_ICON, NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { PANEL_ROWS, PANEL_WELL } from "@/shared/ui/panel-well";

const DAY_MS = 86_400_000;

/** The four wells, in the order Samuel dictated them. ⚠ ORDER IS THE DATA — the
 *  render maps this array, so there is no second list to keep in step. */
export const RECENCY_WELLS = [
  { id: "recent", label: "Recent", maxAgeMs: DAY_MS },
  { id: "week", label: "Last 7 days", maxAgeMs: 7 * DAY_MS },
  { id: "month", label: "Last 30 days", maxAgeMs: 30 * DAY_MS },
  // ⚠ THE LAST WELL HAS NO CEILING, which is what makes the buckets exhaustive:
  // every item lands in exactly one, so none can be dropped by arithmetic.
  { id: "earlier", label: "Earlier", maxAgeMs: Number.POSITIVE_INFINITY },
] as const;

export type RecencyWellId = (typeof RECENCY_WELLS)[number]["id"];

/**
 * WHICH WELL A STAMP FALLS IN.
 *
 * ⚠ **UNKNOWN LANDS IN `recent`, AND THE DIRECTION IS THE POINT.** `recent` is the
 * one well open by default, so an item this build cannot date stays VISIBLE; the
 * alternative buries a live agent — or a thread whose activity this read did not
 * derive — inside a collapsed **Earlier** on the strength of a field that is
 * simply absent. An absence must never make a row harder to find (INVARIANTS §11
 * — UNKNOWN is not EMPTY).
 * ⚠ **A FUTURE STAMP IS ALSO `recent`** — clock skew between a machine and this
 * renderer is ordinary, and a negative age is not evidence of anything.
 *
 * ⚠ **THE CLOCK'S DEFAULT LIVES HERE, ON THE PURE FUNCTION** — the shape
 * `agents-model.ts › peerRowStale` already holds, and it is not cosmetic: a
 * `now = Date.now()` default on the COMPONENT is an impure call during render
 * (`react-hooks/purity`), while a test that wants to state an age passes one.
 */
export function wellFor(at: number | null, now: number = Date.now()): RecencyWellId {
  if (at === null) return "recent";
  const age = now - at;
  for (const well of RECENCY_WELLS) {
    if (age < well.maxAgeMs) return well.id;
  }
  return "earlier";
}

/** One item, with the stamp that files it. ⚠ The NODE is built by the caller: this
 *  module groups rows and owns no row shape. */
export interface RecencyWellItem {
  key: string;
  at: number | null;
  node: ReactNode;
}

type OpenMap = Record<RecencyWellId, boolean>;

/** ⚠ **RECENT OPEN, THE OTHER THREE COLLAPSED** — Samuel's default, stated once. */
const WELLS_DEFAULT: OpenMap = {
  recent: true,
  week: false,
  month: false,
  earlier: false,
};

/**
 * THIS DEVICE'S LAST CHOICE FOR ONE SURFACE'S KEY, OR THE DEFAULTS.
 *
 * ⚠ **THE KEY IS THE CALLER'S, AND THE TWO SURFACES DO NOT SHARE ONE** —
 * `dopl.agents.wells` and `dopl.threads.wells`. Collapsing **Earlier** on the
 * Agents tab is not a statement about the Threads tab, and one key would make it
 * one.
 * ⚠ **AN UNKNOWN KEY IN THE STORED OBJECT IS IGNORED, NOT TRUSTED** — a fifth well
 * in a later build must not be able to arrive pre-collapsed from a stale write, and
 * a non-boolean value is a corrupt one.
 * ⚠ **EVERY ACCESS IS IN A `try`** and every failure is the defaults: storage
 * throws outright in a locked-down browser, and a collapsible section is not worth
 * a blank panel.
 */
function storedWells(storageKey: string): OpenMap {
  if (typeof window === "undefined") return WELLS_DEFAULT;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return WELLS_DEFAULT;
  }
  if (!raw) return WELLS_DEFAULT;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<string, unknown>>;
    const next = { ...WELLS_DEFAULT };
    for (const well of RECENCY_WELLS) {
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
 * this device last chose under `storageKey`.
 *
 * ⚠ **PER DEVICE, NOT PER ACCOUNT, AND `localStorage` IS THE HONEST STORE FOR
 * THAT.** The Agents tab is an OPERATOR surface over one machine's own session
 * feed (§5) and a collapsed well on the Threads tab is a reading posture, not a
 * fact about the channel — the server stores nothing about either, so a
 * server-side preference would be the only cross-machine claim on the panel.
 * ⚠ **READ IN A LAZY INITIALISER, NOT IN AN EFFECT, AND NO WELL EVER RENDERS ON A
 * SERVER.** `setState` inside an effect body is a cascading render this tree's lint
 * forbids outright (`react-hooks/set-state-in-effect`), so the usual "paint the
 * defaults, then correct them" shape is not available — and it is not needed,
 * because **neither surface has any item to file during a server render**:
 * `agents-tab.tsx` returns its desktop-only sentence whenever `sessions === null`
 * (which is what SSR always sees) and the Threads tab's list arrives from
 * `hooks/use-channel-threads.ts`, a client fetch that is empty until it resolves.
 * An empty list renders no well at all, so there is no `aria-expanded` for a
 * hydration pass to disagree about. The initialiser still guards `typeof window`
 * so the hook is honest on its own.
 * ⚠ The read itself, its `try` and its key filtering are {@link storedWells}.
 */
export function useRecencyWells(storageKey: string): {
  isOpen: (id: RecencyWellId) => boolean;
  toggle: (id: RecencyWellId) => void;
} {
  const [open, setOpen] = useState<OpenMap>(() => storedWells(storageKey));

  const toggle = useCallback(
    (id: RecencyWellId) => {
      setOpen((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // storage unavailable — the choice still holds for this session
        }
        return next;
      });
    },
    [storageKey]
  );

  const isOpen = useCallback((id: RecencyWellId) => open[id], [open]);
  return { isOpen, toggle };
}

/**
 * HOW LONG A WELL TAKES TO OPEN OR SHUT. ⚠ **KEEP IN STEP WITH `.collapse-grid`'s
 * transition** (globals.css + the desktop `kit.css` copy) — it is the app's one
 * panel duration, the same 200ms `.channel-info-slide` and `.menu-card` use.
 */
export const WELL_COLLAPSE_MS = 200;

/**
 * WHETHER THIS WELL'S CONTENT MUST BE RENDERED — open, or one transition past close.
 *
 * ⚠ **THE UNMOUNT RULING SURVIVES THE ANIMATION, AND THAT IS WHY THIS HOOK
 * EXISTS.** *"Collapsed means the cards are UNMOUNTED, not hidden"* is still the
 * rule (INVARIANTS §5) — nothing on an agent card is worth mounting behind a
 * closed well, and `agent-delete.tsx`'s hover affordances have no business
 * existing where no one can see them. But a closing box with nothing inside it
 * has no content to clip, so it would snap shut instead of shrinking. The content
 * therefore outlives `open` by exactly one transition.
 *
 * ⚠ **THE SAME SHAPE `use-info-slide.ts › useInfoSlide` HOLDS, deliberately not a
 * shared hook.** That one is named for the info column and owns `INFO_SLIDE_MS`;
 * lifting a two-state latch to `shared/` to save nine lines would put a
 * presentation timer where neither consumer can see its own duration. ⚠ The
 * `||` below means this can never hold a well OPEN — only briefly populated.
 * ⚠ **REDUCED MOTION UNMOUNTS AT ONCE**, because the kit turns the transition off
 * under that query and nothing may wait for a transition that will not run. The
 * OPEN direction schedules a 0ms timer it does not need, for the reason
 * `useInfoSlide` records: `react-hooks/set-state-in-effect` rejects a synchronous
 * `setState` in an effect body outright.
 */
function useWellContent(open: boolean): boolean {
  const [trailing, setTrailing] = useState(open);
  useEffect(() => {
    if (trailing === open) return;
    const instant =
      open ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const timer = setTimeout(
      () => setTrailing(open),
      instant ? 0 : WELL_COLLAPSE_MS
    );
    return () => clearTimeout(timer);
  }, [open, trailing]);
  return open || trailing;
}

/**
 * ONE WELL: a header row that toggles, and its content when it is open.
 *
 * 🔒 **IT ANIMATES (Samuel, 2026-09-13):** *"I want the drop-downs collapsing and
 * expanding to be a smooth animation. Even when the right arrow turns to the down
 * arrow, it should be a spinning right. Right now it's just a direct kind of
 * toggle, almost, but it should be a smooth animation, like the gray box
 * increases in size, stuff like that."* Two halves, and both are motion on an
 * existing element rather than a new shape:
 *
 *  - **THE BOX GROWS** — `.collapse-grid` (globals.css + `kit.css`), a
 *    `grid-template-rows: 0fr → 1fr` transition over `overflow: hidden`, so the
 *    well's own height follows its content with no measured pixel anywhere. The
 *    content stays mounted for the length of it ({@link useWellContent}).
 *  - **THE CHEVRON SPINS** — **ONE glyph**, `ChevronRight`, rotated `0°` → `90°`
 *    on a `transition-transform`. ⚠ **NOT TWO ICONS SWAPPED**: a
 *    `ChevronDown`/`ChevronRight` swap is a different element every time, so
 *    there is nothing for the browser to interpolate and *"a direct kind of
 *    toggle"* is exactly what it renders. `rotate-90` is clockwise, which is the
 *    *"spinning right"*. ⚠ **The two icons ARE GONE from this file** — importing
 *    `ChevronDown` again is how the swap comes back.
 *
 * ⚠ **`prefers-reduced-motion` KEEPS THE STATE AND DROPS THE MOTION**, both
 * halves: the kit's query turns `.collapse-grid`'s transition off, and the
 * chevron carries `motion-reduce:transition-none`. `aria-expanded`, the rotation
 * and the mount are unchanged either way — the box still opens, instantly.
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
 * ⚠ **COLLAPSED MEANS THE CONTENT IS NOT RENDERED**, not hidden — ⚠ **ONE
 * TRANSITION LATE SINCE 2026-09-13** — {@link useWellContent} owns the delay and
 * says why the ruling is unchanged by it.
 */
export function RecencyWell({
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
  const mounted = useWellContent(open);
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
          <ChevronRight
            size={NAKED_ICON}
            data-well-chevron=""
            className={cn(
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
              open ? "rotate-90" : "rotate-0"
            )}
          />
        </span>
      </button>
      {/* ⚠ THE WRAPPER IS THE ANIMATION AND IT IS ALWAYS RENDERED — a box that
          only exists while open has no closed state to grow FROM. `data-open`
          drives `.collapse-grid`; the column inside is the same `PANEL_ROWS` it
          always was, now as the grid's single item.

          ⚠ THE `-mt-2` / `pt-2` PAIR MOVES `PANEL_WELL`'s OWN `gap-2` INSIDE THE
          ANIMATED BOX, and it is not decoration. This wrapper is now a permanent
          flex child, so the well's gap would apply to a zero-height box and leave
          a collapsed well 8px taller than it was, with a dead band under its
          header. Cancelling the gap on the wrapper and re-stating it as the
          COLUMN's top padding makes those 8px part of what grows. */}
      <div
        className="collapse-grid -mt-2"
        data-open={open}
        aria-hidden={!open}
      >
        <div className={cn(PANEL_ROWS, "pt-2")}>{mounted ? children : null}</div>
      </div>
    </section>
  );
}

/**
 * THE FOUR WELLS OVER ONE ORDERED LIST OF ITEMS.
 *
 * ⚠ **THE CALLER'S ORDER SURVIVES INSIDE EVERY WELL.** The grouping is a single
 * forward pass into four arrays, so own-agents-first (§5), the agent feed's own
 * thread grouping (`agents-model.ts › agentsForChannel`) and **the Threads tab's
 * server order** (§5: never re-sorted here, because the read is CLIPPED against
 * it) each reach their box intact. Nothing here sorts.
 * ⚠ **`now` IS A PARAMETER WITH A DEFAULT**, so a test can state an age instead of
 * arranging for one; the render passes nothing.
 */
export function RecencyWells({
  items,
  storageKey,
  now,
}: {
  items: readonly RecencyWellItem[];
  /** This surface's `localStorage` key — see {@link useRecencyWells}. */
  storageKey: string;
  /** ⚠ NO `= Date.now()` DEFAULT HERE — that is an impure call during render
   *  (`react-hooks/purity`). The clock's default lives on {@link wellFor}, the
   *  pure function, exactly as `agents-model.ts › peerRowStale` holds its own. */
  now?: number;
}) {
  const { isOpen, toggle } = useRecencyWells(storageKey);
  const grouped = useMemo(() => {
    const out = new Map<RecencyWellId, RecencyWellItem[]>();
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
      {RECENCY_WELLS.map((well) => {
        const bucket = grouped.get(well.id);
        // ⚠ NOT RENDERED WHEN EMPTY — see the file docblock, which also records
        // that this is the one part of the ruling Samuel did not state.
        if (!bucket || bucket.length === 0) return null;
        return (
          <RecencyWell
            key={well.id}
            label={well.label}
            open={isOpen(well.id)}
            onToggle={() => toggle(well.id)}
          >
            {/* ⚠ A `Fragment` KEY, NOT A WRAPPER `div` — the rows are the direct
                children of `PANEL_ROWS` exactly as they were the direct children
                of the flat column, so this ruling adds no box inside the well. */}
            {bucket.map((item) => (
              <Fragment key={item.key}>{item.node}</Fragment>
            ))}
          </RecencyWell>
        );
      })}
    </div>
  );
}
