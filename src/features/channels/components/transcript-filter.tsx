"use client";

/**
 * Channels — **WHOSE POSTS THE TRANSCRIPT SHOWS** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md, checklist item 6).
 *
 * His words: *"On the top, next to the left of the toggle bar for collapsing the
 * right-side panel, I want us to add a dropdown … filtering by messages: All … Just
 * users, which would include desktop agents as well: all of the messages that don't
 * have a colored box around them … Individual agents"*.
 *
 * ── ⚠ MULTI-SELECT SINCE 2026-09-16, AND "All" IS NO LONGER AN OPTION ─────────────
 *
 * Samuel, on this control: *"single-select today — make CHECKBOX multi-select"* and
 * *"'All' option redundant vs per-item rows"*. Both are answered by ONE decision:
 *
 * 🔒 **AN EMPTY SELECTION IS "All". "All" IS NOT A VALUE.** The filter is a SET
 * ({@link TranscriptFilter}: the People bucket, plus zero or more agent ids), and the
 * unfiltered transcript is that set being empty. The row still reading "All" at the top
 * of the menu is therefore a CLEAR — it selects nothing and shows everything — and it
 * can never disagree with the rows under it, which is exactly the redundancy Samuel
 * named. The alternative (keep "All" as a fourth, mutually exclusive value) has to
 * answer "what does checking All *and* Scout mean", and there is no honest answer.
 * ⚠ **THE CHECK ON THE "All" ROW IS DERIVED, NEVER STORED**: it is on precisely when
 * nothing else is, so it reads as a state and acts as a verb without being a member of
 * the set. ⚠ **AND SELECTING EVERY ROW BY HAND IS NOT NORMALISED BACK TO EMPTY** — it
 * filters to the same transcript by construction (People plus every agent is the whole
 * partition, 🔒 `transcript-filter.test.tsx › § People`), and rewriting the reader's
 * ticks under them would be the control editing their choice.
 *
 * ── ⚠ "PEOPLE" IS THE COMPLEMENT OF THE ACCENT, AND IT IS NOT RE-SPELLED HERE ──────
 *
 * Samuel defined the option by the PAINT rather than by the data, so this file asks
 * `agent-box-rule.ts › agentBoxOf` — the same call `transcript.tsx › Message`
 * makes — and never its own version of "is this an agent's post". That file's own
 * docblock carries the argument in full: two spellings would mean a row that renders
 * boxed and filters as a person, and each side's tests would pass because each side
 * would be self-consistent. {@link transcriptRowAgentId} is the single adapter, and
 * {@link filterTranscriptRows} is one comparison against its answer — People is
 * literally `=== null`, never a second predicate.
 *
 * ⚠ **AN ENDED AGENT IS STILL AN AGENT HERE.** `agentBoxOf` answers `{ color: null }`
 * for a session whose key went back to the channel's bank, which is a NEUTRAL BOX and
 * not "no box" — so those posts stay under that agent's entry (with a gray dot) and
 * are absent from People. Collapsing the two `null`s is the one mutation this file's
 * suite exists to catch.
 *
 * ── ⚠ WHY THIS IS NOT A `SelectMenu` CALL, WHICH IS WHAT THE SPEC ASKED FOR ────────
 *
 * `shared/ui/select-menu.tsx › SelectMenuOption` types `label` as a **string**, and
 * every option here needs a COLOUR DOT beside the name (*"colour dot + name; ended
 * ones with a gray dot"*) — a node cannot cross that boundary. So this composes the
 * same two kit primitives `SelectMenu` itself composes, `Popover` + `MenuItem`, and
 * `MenuItem` already has an `icon` slot for exactly this (fifteen callers do the same
 * — `ontology/components/pick-menu.tsx`, `knowledge/components/tree-context-menu.tsx`).
 * ⚠ **AND SINCE THE MULTI-SELECT CHANGE IT IS NOT A `SelectMenu` FOR A SECOND REASON**:
 * that kit closes on pick and reports ONE option, which is the wrong contract for a menu
 * whose whole point is ticking several rows in one opening.
 * ⚠ **THE TRIGGER THEREFORE STATES ITS FACE**, and it is `TRIGGER_FACE.text`'s
 * vocabulary deliberately (label + chevron, no pill, `--menu-item-hover-bg` on hover —
 * Samuel, 2026-09-06 and 2026-09-13) rather than a new one. It is a COPY under protest,
 * and widening the kit is what un-copies it.
 */

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuDivider, MenuItem, Popover } from "@/shared/ui/popover-menu";
import { agentColorVar } from "../lib/agent-colors";
import { agentBoxOf } from "./agent-box-rule";
import { attributionName } from "./attribution-pill";
import type { AgentColorKey } from "../types";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";

/**
 * THE SELECTION: a SET — the People bucket and any number of agents, together.
 *
 * ⚠ **A SHAPED RECORD AND NOT A LIST OF STRINGS**, which closes the same two questions
 * the old union closed. (1) An agent id lives in its own FIELD, so it could never be
 * read as a keyword — no `"people"` collision is expressible. (2) No string form has to
 * interpolate an id, and 🔒 `agent-id-visibility.test.ts` sweeps this directory for
 * exactly that shape.
 * ⚠ **EMPTY IS "All"** — see the file docblock. {@link transcriptFilterIsAll} is the one
 * place that is spelled, so no caller re-derives it.
 */
export interface TranscriptFilter {
  /** The unboxed posts: humans and Desktop agents (`transcriptRowAgentId === null`). */
  readonly people: boolean;
  /** ⚠ FIRST-POST ORDER IS NOT PRESERVED HERE and is not needed — this is a membership
   *  test ({@link filterTranscriptRows}); the MENU's order comes from the rows. */
  readonly agentIds: readonly string[];
}

/** ⚠ ONE REFERENCE, not a fresh literal per render: the selection is a `useMemo`
 *  dependency of the pane's filtered rows (`message-pane.tsx › visibleRows`), and a new
 *  object every render would re-filter the whole transcript forever. Every path that
 *  lands back on "nothing selected" returns THIS object. */
export const TRANSCRIPT_FILTER_ALL: TranscriptFilter = {
  people: false,
  agentIds: [],
};

/** People alone. ⚠ A constructor rather than an inline literal at each call site. */
export const TRANSCRIPT_FILTER_PEOPLE: TranscriptFilter = {
  people: true,
  agentIds: [],
};

/** ONE agent's entry in the dropdown — the id it filters by, the face it wears, and
 *  the colour it is wearing RIGHT NOW. ⚠ The colour is READ, never stored: it returns
 *  to the channel's bank when the session ends (`view-model.ts › AgentIdentity.color`). */
export interface TranscriptFilterAgent {
  agentId: string;
  label: string;
  /** `null` renders the GRAY dot — ended, never assigned, or outside the key set. */
  color: AgentColorKey | null;
}

/** One agent selected and nothing else. */
export function agentTranscriptFilter(agentId: string): TranscriptFilter {
  return { people: false, agentIds: [agentId] };
}

/** **NOTHING SELECTED, WHICH IS THE UNFILTERED TRANSCRIPT** — the file docblock's
 *  decision, spelled once so no caller re-derives it. */
export function transcriptFilterIsAll(filter: TranscriptFilter): boolean {
  return !filter.people && filter.agentIds.length === 0;
}

/** How many rows are ticked — the trigger's label needs the COUNT, not the members. */
export function transcriptFilterCount(filter: TranscriptFilter): number {
  return (filter.people ? 1 : 0) + filter.agentIds.length;
}

/** ⚠ RETURNS THE SHARED `ALL` CONSTANT when the last tick comes off, for the identity
 *  reason on {@link TRANSCRIPT_FILTER_ALL}. */
function narrow(people: boolean, agentIds: readonly string[]): TranscriptFilter {
  return !people && agentIds.length === 0
    ? TRANSCRIPT_FILTER_ALL
    : { people, agentIds };
}

/** Tick or untick People. Pure — the pane owns the state. */
export function toggleTranscriptPeople(filter: TranscriptFilter): TranscriptFilter {
  return narrow(!filter.people, filter.agentIds);
}

/** Tick or untick ONE agent, leaving every other tick alone. */
export function toggleTranscriptAgent(
  filter: TranscriptFilter,
  agentId: string
): TranscriptFilter {
  const on = filter.agentIds.includes(agentId);
  return narrow(
    filter.people,
    on
      ? filter.agentIds.filter((id) => id !== agentId)
      : [...filter.agentIds, agentId]
  );
}

/**
 * **THE AGENT WHOSE BOX THIS ROW WEARS, OR `null` FOR AN UNBOXED ROW.**
 *
 * ⚠ **EVERY NON-MESSAGE ROW IS UNBOXED, AND THAT IS READ OFF THE RENDERER RATHER THAN
 * GUESSED.** `transcript.tsx`'s dispatch sends `system`, `receipt`, `thread-card`,
 * `artifact` and `escalation` rows to their own cards BEFORE the `Message` branch that
 * carries the frame, so none of them can wear a colour — which makes them People's by
 * Samuel's own definition, and it is why a thread card and a decision card "follow the
 * same author rule" without needing a rule of their own.
 * ⚠ **AND THEY COULD NOT BE ATTRIBUTED EVEN IF THEY WORE ONE**: `view-model-rows.ts ›
 * ThreadCardRow` and `view-model-escalation.ts › EscalationRow` carry `author` and
 * `authorLabel` and NO `agent` / `agentId`, so an agent-posted escalation is not a
 * thing this surface can name. Filed as such rather than approximated — a card assigned
 * to the wrong agent is worse than a card that only appears under All and People.
 */
export function transcriptRowAgentId(
  row: TranscriptRow,
  index: AuthorIndex
): string | null {
  if (row.kind !== "message") return null;
  return agentBoxOf(row, index) === null ? null : row.agentId;
}

/**
 * **THE OPTIONS, DERIVED FROM THE LOADED ROWS — never from the session index.**
 *
 * ⚠ **THE RULING IS *"one entry per agent that has posted in the loaded transcript"***,
 * so `index.agents` is asked for a NAME and a COLOUR and never for the LIST. That map
 * is the machine's live projection (own + peer sessions), which means a room where
 * nine agents are idle and one has spoken would otherwise offer ten options, nine of
 * which filter to an empty transcript. Reading the rows cannot produce an option that
 * matches nothing.
 *
 * ⚠ **FIRST-POST ORDER, NOT THE INDEX'S AND NOT ALPHABETICAL.** The reader is looking
 * at the transcript; the order they already scrolled past is the one they can predict.
 * ⚠ **THE FACE IS `attribution-pill.tsx › attributionName`**, so the dropdown and the
 * post's own pill cannot disagree about what an agent is called — including the fallback
 * face for an agent this machine has no name for (a peer's, in a web tree).
 */
export function transcriptFilterAgents(
  rows: readonly TranscriptRow[],
  index: AuthorIndex
): readonly TranscriptFilterAgent[] {
  const out: TranscriptFilterAgent[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // ⚠ THE KIND TEST IS REPEATED HERE ONLY TO NARROW `row` for `authorLabel` below —
    // the PREDICATE is still {@link transcriptRowAgentId}'s and is asked on the next line.
    if (row.kind !== "message") continue;
    const agentId = transcriptRowAgentId(row, index);
    if (agentId === null || seen.has(agentId)) continue;
    seen.add(agentId);
    const identity = index.agents.get(agentId);
    out.push({
      agentId,
      label: attributionName({
        agent: true,
        agentId,
        authorLabel: row.authorLabel,
        agentName: identity?.displayName ?? null,
      }),
      color: identity?.color ?? null,
    });
  }
  return out;
}

/**
 * **THE FILTER ITSELF — one comparison, so People cannot drift from the box.**
 *
 * ⚠ AN EMPTY SELECTION RETURNS THE SAME ARRAY, NOT A COPY: `rows` is a `useMemo` value
 * upstream (`derivations.ts`) and the transcript's pin and paging memoize on its
 * identity, so a fresh array on the default selection would re-run all of that on every
 * render.
 * ⚠ **A ROW PASSES IF ANY TICK CLAIMS IT** — union, never intersection: a row is one
 * author's, so an "and" across two ticked rows is empty by construction.
 * ⚠ **MUTABLE IN AND MUTABLE OUT, WHICH IS NOT THIS FILE'S PREFERENCE**: the answer goes
 * straight into `transcript.tsx › Transcript`'s `rows: TranscriptRow[]`, and a `readonly`
 * return would be un-assignable there. Narrowing that prop is the correct fix and is one
 * edit in a file this change does not own.
 */
export function filterTranscriptRows(
  rows: TranscriptRow[],
  index: AuthorIndex,
  filter: TranscriptFilter
): TranscriptRow[] {
  if (transcriptFilterIsAll(filter)) return rows;
  return rows.filter((row) => {
    // ⚠ **PEOPLE IS `null` AND THAT IS THE WHOLE PREDICATE** — the complement of the box,
    // asked as one comparison against `agent-box-rule.ts`'s own answer rather than as a
    // second rule about authors.
    const agentId = transcriptRowAgentId(row, index);
    return agentId === null ? filter.people : filter.agentIds.includes(agentId);
  });
}

/**
 * **THE SELECTION THAT CAN ACTUALLY BE HONOURED**, which is not always the stored one.
 *
 * ⚠ **AN AGENT CAN LEAVE THE LOADED TRANSCRIPT WHILE ITS SELECTION STANDS** — the
 * transcript is a WINDOW (`lib/transcript-line-budget.ts`), so a refetch can page that
 * agent's last post out from under the choice. Filtering on a name the dropdown no
 * longer offers shows an EMPTY transcript under a trigger reading someone else's label,
 * which is the pane lying about why it is blank.
 * ⚠ **ONLY THE DEAD TICKS ARE DROPPED, NOT THE WHOLE SELECTION** — that is what
 * multi-select changes here: People and every agent still in the window survive a
 * neighbour paging out, and only when NOTHING survives does this fall all the way back
 * to the shared `All`.
 * ⚠ **AND IT DOES NOT WRITE THE FALLBACK BACK INTO STATE.** The stored value is the
 * reader's CHOICE and the window widens again (`use-load-older.ts` prepends pages), so
 * scrolling up restores their filter instead of having silently discarded it. ⚠ WHICH
 * IS ALSO WHY THE CALLER MEMOISES THIS: a prune mints a new object, and re-running it
 * every render would re-filter the transcript every render.
 */
export function resolveTranscriptFilter(
  filter: TranscriptFilter,
  agents: readonly TranscriptFilterAgent[]
): TranscriptFilter {
  if (filter.agentIds.length === 0) return filter;
  const live = filter.agentIds.filter((id) =>
    agents.some((agent) => agent.agentId === id)
  );
  // ⚠ IDENTITY IS THE POINT: nothing pruned, nothing new.
  if (live.length === filter.agentIds.length) return filter;
  return narrow(filter.people, live);
}

/** Label + control, nothing else (INVARIANTS §5's minimal-copy ruling): no descriptions
 *  under the options, since "People" explains itself and an agent's name is its own
 *  description. */
const ALL_LABEL = "All";
const PEOPLE_LABEL = "People";
/** The trigger's accessible name. ⚠ It says MESSAGES, not "agents": most of what it
 *  filters is not an agent. */
const FILTER_LABEL = "Filter messages";
/** The trigger's face when several rows are ticked. ⚠ A COUNT rather than a joined list:
 *  the header has one truncating line, and "Scout, Rover, Peop…" says less than "3". */
function triggerCountLabel(n: number) {
  return `${n} selected`;
}

/**
 * THE DOT. ⚠ **AN INLINE `style` FOR BOTH FACES, INCLUDING THE NEUTRAL ONE.** The
 * coloured dot has no choice — `lib/agent-colors.ts › agentColorVar` yields a
 * `var(--agent-color-NN)` chosen by DATA, and a Tailwind class cannot be built from a
 * runtime key (the argument is that file's docblock, and `agent-box-rule.ts ›
 * agentPostAccent` repeats it) — so painting the gray one through `bg-border-strong`
 * instead would be two mechanisms for one 8px circle. `--border-strong` is the SAME token
 * `agent-box-rule.ts › AGENT_ACCENT_NEUTRAL` gives an ended agent's ring and bar, which is
 * the point: the dot in this menu and the accent in the transcript must read as one state.
 */
const DOT = "h-2 w-2 shrink-0 rounded-full";

function AgentDot({ color }: { color: AgentColorKey | null }) {
  return (
    <span
      aria-hidden
      data-agent-color={color ?? undefined}
      className={DOT}
      style={{
        backgroundColor: color ? agentColorVar(color) : "var(--border-strong)",
      }}
    />
  );
}

/**
 * **THE ROW'S LEADING COLUMN — AND IT IS THE SAME WIDTH ON EVERY ROW** (Samuel,
 * 2026-09-16: *"agent entries start at different x-offsets; align every row to one
 * consistent column"*).
 *
 * 🔒 **THE MISALIGNMENT WAS STRUCTURAL, NOT A MARGIN.** "All" and "People" were
 * `MenuItem`s with a check column and no `icon`; the agents' rows had the check column
 * AND a dot, so `MenuItem`'s `gap-2` flex put their labels one dot-plus-gap further
 * right. Nudging the two keywords over with padding would have "fixed" it until the day
 * the dot changed size.
 * ⚠ **SO THE FIX IS ONE NODE IN ONE SLOT**: every row hands `MenuItem` this same
 * checkbox-then-dot cluster, and a row with no agent (All, People) passes an EMPTY dot
 * of the dot's exact size rather than nothing. One column, one origin, by construction —
 * there is no branch left that could make two rows differ.
 * ⚠ **`showCheck` IS GONE WITH IT**: the kit's tick column said "this one option is
 * current", which is a single-select sentence, and keeping it beside a checkbox would
 * have been two marks for one state (and a THIRD x-offset).
 */
function RowMark({ checked, dot }: { checked: boolean; dot: AgentColorKey | null | false }) {
  return (
    // ⚠ `data-row-mark` IS FOR THE TEST THAT HOLDS THE ALIGNMENT, and it is the cheapest
    // honest hook for it: 🔒 `transcript-filter.test.tsx › § one column` asserts every row
    // has exactly one of these with the same two slots, which is the property itself
    // rather than a screenshot of it.
    <span data-row-mark className="flex items-center gap-2">
      {/* ⚠ THE BOX IS `create-team-dialog.tsx`'s, TOKEN FOR TOKEN — the tree's existing
          checkbox face, so a second one is not minted here. `aria-hidden` because the
          ROW carries the state: `MenuItem`'s `checked` makes it a `menuitemcheckbox`
          with `aria-checked`, and a second checkbox inside it would be announced twice. */}
      <span
        aria-hidden
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border transition-colors",
          checked
            ? "bg-accent-primary border-accent-primary text-accent-on"
            : "border-border-strong text-transparent"
        )}
      >
        <Check size={10} strokeWidth={3} />
      </span>
      {dot === false ? (
        // ⚠ THE SPACER, and it is the dot's OWN class so the two can never drift apart.
        <span aria-hidden className={DOT} />
      ) : (
        <AgentDot color={dot} />
      )}
    </span>
  );
}

/**
 * THE CONTROL, placed by `message-pane-header.tsx` immediately LEFT of the info-pane
 * collapse toggle (the ruling, in those words). It owns the popover and NOTHING else:
 * the selection lives in `message-pane.tsx`, which is also what applies it.
 *
 * ⚠ **IT DOES NOT CLOSE ON A PICK.** Ticking is the interaction now, and a menu that
 * shut after one tick would make selecting three agents three round trips through the
 * trigger. It closes on the backdrop, on Escape (`Popover` owns both) and on the trigger.
 */
export function TranscriptFilterSelect({
  value,
  agents,
  onChange,
}: {
  value: TranscriptFilter;
  /** {@link transcriptFilterAgents}' answer — the caller derives it once and filters
   *  with it, so the menu and the rows are the same derivation. */
  agents: readonly TranscriptFilterAgent[];
  onChange: (next: TranscriptFilter) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // ⚠ COORDINATE MODE, for `select-menu.tsx`'s reason restated: this trigger sits in a
  // header above an overflow-clipping pane, where a trigger-anchored panel renders as a
  // clipped sliver.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const isAll = transcriptFilterIsAll(value);
  const count = transcriptFilterCount(value);
  /** The ONE ticked agent, when that is the whole selection — the only case the trigger
   *  can wear a dot and a name for. */
  const lone =
    count === 1 && !value.people
      ? agents.find((agent) => agent.agentId === value.agentIds[0])
      : undefined;

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={FILTER_LABEL}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1.5",
          // ⚠ THE COPIED FACE — `shared/ui/select-menu.tsx › TRIGGER_FACE.text`. See the
          // file docblock for why it is copied and what un-copies it.
          "-mx-1.5 rounded-md px-1.5 py-0 text-body font-normal text-text-primary",
          "transition-colors hover:bg-menu-item-hover-bg"
        )}
      >
        {lone && <AgentDot color={lone.color} />}
        <span className="min-w-0 truncate">
          {isAll
            ? ALL_LABEL
            : lone
              ? lone.label
              : count === 1
                ? PEOPLE_LABEL
                : triggerCountLabel(count)}
        </span>
        {/* ⚠ THE CHEVRON IS THE ONLY HINT OF A MENU on a trigger with no pill, so it
            may never be dropped (the kit's own note on that face). */}
        <ChevronDown size={11} className="shrink-0" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="min-w-[180px] max-w-[280px]"
      >
        {/* **"All" IS A CLEAR, NOT A MEMBER** (file docblock). Its tick is derived —
            on exactly when nothing else is — and picking it while it is already on is a
            no-op rather than a state write nothing can see. */}
        <MenuItem
          checked={isAll}
          icon={<RowMark checked={isAll} dot={false} />}
          onSelect={() => {
            if (!isAll) onChange(TRANSCRIPT_FILTER_ALL);
          }}
        >
          {ALL_LABEL}
        </MenuItem>
        {/* ⚠ THE RULE ABOVE THE SET IT CLEARS — the divider is the whole of what says
            "All" is a different kind of row from the ticks beneath it. */}
        <MenuDivider />
        <MenuItem
          checked={value.people}
          icon={<RowMark checked={value.people} dot={false} />}
          onSelect={() => onChange(toggleTranscriptPeople(value))}
        >
          {PEOPLE_LABEL}
        </MenuItem>
        {agents.map((agent) => {
          const checked = value.agentIds.includes(agent.agentId);
          return (
            <MenuItem
              key={agent.agentId}
              checked={checked}
              icon={<RowMark checked={checked} dot={agent.color} />}
              onSelect={() => onChange(toggleTranscriptAgent(value, agent.agentId))}
            >
              {agent.label}
            </MenuItem>
          );
        })}
      </Popover>
    </>
  );
}
