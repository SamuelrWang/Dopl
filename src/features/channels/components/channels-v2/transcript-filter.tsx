"use client";

/**
 * Channels v2 — **WHOSE POSTS THE TRANSCRIPT SHOWS** (Samuel, 2026-09-13;
 * docs/specs/agent-colors.md, checklist item 6).
 *
 * His words: *"On the top, next to the left of the toggle bar for collapsing the
 * right-side panel, I want us to add a dropdown … filtering by messages: All … Just
 * users, which would include desktop agents as well: all of the messages that don't
 * have a colored box around them … Individual agents"*.
 *
 * ── ⚠ "PEOPLE" IS THE COMPLEMENT OF THE BOX, AND IT IS NOT RE-SPELLED HERE ─────────
 *
 * Samuel defined the option by the PAINT rather than by the data, so this file asks
 * `agent-box-rule.ts › agentBoxOf` — the same call `message-box-agent.tsx`'s caller
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
 * ⚠ **THE ONE-LINE FIX IS TO WIDEN THE KIT, NOT TO FORK IT**: an optional
 * `icon?: ReactNode` on `SelectMenuOption` (passed straight to `MenuItem`'s own) and
 * {@link TranscriptFilterSelect} collapses into a `SelectMenu` call with
 * `variant="text"`. It was not done in this change because that file is a shared kit
 * module being edited by another surface of this same wave.
 * ⚠ **THE TRIGGER THEREFORE STATES ITS FACE**, and it is `TRIGGER_FACE.text`'s
 * vocabulary deliberately (label + chevron, no pill, `--menu-item-hover-bg` on hover —
 * Samuel, 2026-09-06 and 2026-09-13) rather than a new one. It is a COPY under protest,
 * and the sentence above is how it stops being one.
 */

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { MenuItem, Popover } from "@/shared/ui/popover-menu";
import { agentColorVar } from "../../lib/agent-colors";
import { agentBoxOf } from "./agent-box-rule";
import { attributionName } from "./attribution-pill";
import type { AgentColorKey } from "../../types";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";

/**
 * THE SELECTION: All, People, or ONE agent.
 *
 * ⚠ **A SHAPED UNION AND NOT A STRING**, which closes two questions at once. (1) An
 * agent id could never be read as a keyword — it is eight characters of `[a-z0-9]`
 * (`lib/agent-post-stamp.ts › AGENT_ID_RE`), so a `"people"` collision is impossible
 * TODAY and a `kind` field makes it impossible by construction rather than by luck.
 * (2) A string form would have to interpolate an id, and 🔒 `agent-id-visibility.test.ts`
 * sweeps this directory for exactly that shape — a ban worth honouring even where the
 * string is a state key rather than chrome, because the sweep cannot tell the two apart
 * and the day it could is the day the rule has an exception.
 */
export type TranscriptFilter =
  | { kind: "all" }
  | { kind: "people" }
  | { kind: "agent"; agentId: string };

/** ⚠ ONE REFERENCE EACH, not a fresh literal per render: the selection is a `useMemo`
 *  dependency of the pane's filtered rows (`message-pane.tsx › visibleRows`), and a new
 *  object every render would re-filter the whole transcript forever. */
export const TRANSCRIPT_FILTER_ALL: TranscriptFilter = { kind: "all" };
const TRANSCRIPT_FILTER_PEOPLE: TranscriptFilter = { kind: "people" };

/** ONE agent's entry in the dropdown — the id it filters by, the face it wears, and
 *  the colour it is wearing RIGHT NOW. ⚠ The colour is READ, never stored: it returns
 *  to the channel's bank when the session ends (`view-model.ts › AgentIdentity.color`). */
export interface TranscriptFilterAgent {
  agentId: string;
  label: string;
  /** `null` renders the GRAY dot — ended, never assigned, or outside the key set. */
  color: AgentColorKey | null;
}

/** One agent's selection. ⚠ A constructor rather than an inline literal at each call
 *  site, so the shape is stated once. */
export function agentTranscriptFilter(agentId: string): TranscriptFilter {
  return { kind: "agent", agentId };
}

/** Two selections name the same thing. ⚠ NOT `===`: {@link agentTranscriptFilter}
 *  mints a fresh object per call, so identity would report "changed" on a re-pick of
 *  the option already active. */
function sameFilter(a: TranscriptFilter, b: TranscriptFilter): boolean {
  if (a.kind === "agent") return b.kind === "agent" && a.agentId === b.agentId;
  return a.kind === b.kind;
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
 * post's own pill cannot disagree about what an agent is called — including the `#<id>`
 * fallback for an agent this machine has no name for (a peer's, in a web tree).
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
 * ⚠ `"all"` RETURNS THE SAME ARRAY, NOT A COPY: `rows` is a `useMemo` value upstream
 * (`derivations.ts`) and the transcript's pin and paging memoize on its identity, so a
 * fresh array on the default selection would re-run all of that on every render.
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
  if (filter.kind === "all") return rows;
  // ⚠ **PEOPLE IS `null` AND THAT IS THE WHOLE PREDICATE** — the complement of the box,
  // asked as one comparison against `agent-box-rule.ts`'s own answer rather than as a
  // second rule about authors.
  const wanted = filter.kind === "agent" ? filter.agentId : null;
  return rows.filter((row) => transcriptRowAgentId(row, index) === wanted);
}

/**
 * **THE SELECTION THAT CAN ACTUALLY BE HONOURED**, which is not always the stored one.
 *
 * ⚠ **AN AGENT CAN LEAVE THE LOADED TRANSCRIPT WHILE ITS SELECTION STANDS** — the
 * transcript is a WINDOW (`lib/transcript-line-budget.ts`), so a refetch can page that
 * agent's last post out from under the choice. Filtering on a name the dropdown no
 * longer offers shows an EMPTY transcript under a trigger reading someone else's label,
 * which is the pane lying about why it is blank. Falling back to `"all"` is the only
 * answer a reader can act on.
 * ⚠ **AND IT DOES NOT WRITE THE FALLBACK BACK INTO STATE.** The stored value is the
 * reader's CHOICE and the window widens again (`use-load-older.ts` prepends pages), so
 * scrolling up restores their filter instead of having silently discarded it.
 */
export function resolveTranscriptFilter(
  filter: TranscriptFilter,
  agents: readonly TranscriptFilterAgent[]
): TranscriptFilter {
  if (filter.kind !== "agent") return filter;
  return agents.some((agent) => agent.agentId === filter.agentId)
    ? filter
    : TRANSCRIPT_FILTER_ALL;
}

/** Label + control, nothing else (INVARIANTS §5's minimal-copy ruling): no descriptions
 *  under the options, since "People" explains itself and an agent's name is its own
 *  description. */
const ALL_LABEL = "All";
const PEOPLE_LABEL = "People";
/** The trigger's accessible name. ⚠ It says MESSAGES, not "agents": two of the three
 *  options are not an agent. */
const FILTER_LABEL = "Filter messages";

/**
 * THE DOT. ⚠ **AN INLINE `style` FOR BOTH FACES, INCLUDING THE NEUTRAL ONE.** The
 * coloured dot has no choice — `lib/agent-colors.ts › agentColorVar` yields a
 * `var(--agent-color-NN)` chosen by DATA, and a Tailwind class cannot be built from a
 * runtime key (the argument is that file's docblock, and `message-box-agent.tsx`
 * repeats it) — so painting the gray one through `bg-border-strong` instead would be
 * two mechanisms for one 8px circle. `--border-strong` is the SAME token
 * `message-box-agent.tsx › NEUTRAL` gives an ended agent's frame, which is the point:
 * the dot in this menu and the box in the transcript must read as one state.
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
 * THE CONTROL, placed by `message-pane-header.tsx` immediately LEFT of the info-pane
 * collapse toggle (the ruling, in those words). It owns the popover and NOTHING else:
 * the selection lives in `message-pane.tsx`, which is also what applies it.
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
  const selected =
    value.kind === "agent"
      ? agents.find((agent) => agent.agentId === value.agentId)
      : undefined;

  function toggle() {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ x: rect.left, y: rect.bottom + 4 });
  }

  function pick(next: TranscriptFilter) {
    return () => {
      setAnchor(null);
      if (!sameFilter(next, value)) onChange(next);
    };
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
        {selected && <AgentDot color={selected.color} />}
        <span className="min-w-0 truncate">
          {selected
            ? selected.label
            : value.kind === "people"
              ? PEOPLE_LABEL
              : ALL_LABEL}
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
        <MenuItem
          showCheck
          active={value.kind === "all"}
          onSelect={pick(TRANSCRIPT_FILTER_ALL)}
        >
          {ALL_LABEL}
        </MenuItem>
        <MenuItem
          showCheck
          active={value.kind === "people"}
          onSelect={pick(TRANSCRIPT_FILTER_PEOPLE)}
        >
          {PEOPLE_LABEL}
        </MenuItem>
        {agents.map((agent) => {
          const next = agentTranscriptFilter(agent.agentId);
          return (
            <MenuItem
              key={agent.agentId}
              showCheck
              active={sameFilter(next, value)}
              icon={<AgentDot color={agent.color} />}
              onSelect={pick(next)}
            >
              {agent.label}
            </MenuItem>
          );
        })}
      </Popover>
    </>
  );
}
