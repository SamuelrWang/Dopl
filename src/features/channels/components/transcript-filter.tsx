"use client";

/** Channels — whose posts the transcript shows. "People" is the complement of the agent box
 *  (`agent-box-rule.ts › agentBoxOf`), never a second predicate. `Popover` + `MenuItem`, not
 *  `SelectMenu`: options need a dot node, and the menu stays open for multi-select. */

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

/** The People bucket plus any agent ids; empty is "All". A record rather than strings, so an
 *  agent id can never collide with a keyword. */
export interface TranscriptFilter {
  /** The unboxed posts: humans and Desktop agents (`transcriptRowAgentId === null`). */
  readonly people: boolean;
  /** A membership set — the menu's order comes from the rows. */
  readonly agentIds: readonly string[];
}

/** Nothing selected. One shared reference: the selection is a memo dependency
 *  (`message-pane.tsx › visibleRows`), so every path back to "All" returns this object. */
export const TRANSCRIPT_FILTER_ALL: TranscriptFilter = {
  people: false,
  agentIds: [],
};

/** People alone. */
export const TRANSCRIPT_FILTER_PEOPLE: TranscriptFilter = {
  people: true,
  agentIds: [],
};

/** One agent's dropdown entry; `color` is read live (`view-model.ts › AgentRosterEntry`). */
export interface TranscriptFilterAgent {
  agentId: string;
  label: string;
  /** `null` renders the gray dot — ended, never assigned, or outside the key set. */
  color: AgentColorKey | null;
}

/** One agent selected and nothing else. */
export function agentTranscriptFilter(agentId: string): TranscriptFilter {
  return { people: false, agentIds: [agentId] };
}

/** Nothing selected — the unfiltered transcript. */
export function transcriptFilterIsAll(filter: TranscriptFilter): boolean {
  return !filter.people && filter.agentIds.length === 0;
}

/** How many rows are ticked. */
export function transcriptFilterCount(filter: TranscriptFilter): number {
  return (filter.people ? 1 : 0) + filter.agentIds.length;
}

/** Empty is "All": returns the shared {@link TRANSCRIPT_FILTER_ALL} when the last tick comes
 *  off, for identity stability. Ticking every row by hand is not normalised back to empty. */
function narrow(people: boolean, agentIds: readonly string[]): TranscriptFilter {
  return !people && agentIds.length === 0
    ? TRANSCRIPT_FILTER_ALL
    : { people, agentIds };
}

/** Tick or untick People. Pure — the pane owns the state. */
export function toggleTranscriptPeople(filter: TranscriptFilter): TranscriptFilter {
  return narrow(!filter.people, filter.agentIds);
}

/** Tick or untick one agent, leaving every other tick alone. */
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
 * The transcript cross-fade's key (`fade-swap.tsx`): names the selection only, never the rows,
 * so a realtime push does not fade. Agent ids are sorted so one set has one spelling; the
 * channel id is part of the key because filters are stored per channel.
 */
export function transcriptFilterViewKey(
  channelId: string,
  filter: TranscriptFilter
): string {
  return `${channelId}:${filter.people ? "p" : "-"}:${[...filter.agentIds]
    .sort()
    .join(",")}`;
}

/** The agent whose box this row wears, or null (People — every non-message row too). An ended
 *  agent (`{ color: null }`, a neutral box) is still an agent, never People. */
export function transcriptRowAgentId(
  row: TranscriptRow,
  index: AuthorIndex
): string | null {
  if (row.kind !== "message") return null;
  return agentBoxOf(row, index) === null ? null : row.agentId;
}

/** One option per agent that posted in the loaded rows (never the session index, which would
 *  offer empty filters), in first-post order; named as the pill names it (`attributionName`). */
export function transcriptFilterAgents(
  rows: readonly TranscriptRow[],
  index: AuthorIndex
): readonly TranscriptFilterAgent[] {
  const out: TranscriptFilterAgent[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // Narrows `row` for `authorLabel`; the predicate is still `transcriptRowAgentId`.
    if (row.kind !== "message") continue;
    const agentId = transcriptRowAgentId(row, index);
    if (agentId === null || seen.has(agentId)) continue;
    seen.add(agentId);
    const entry = index.agents.get(agentId);
    out.push({
      agentId,
      label: attributionName({
        agent: true,
        agentId,
        authorLabel: row.authorLabel,
        agentName: entry?.displayName ?? null,
      }),
      color: entry?.color ?? null,
    });
  }
  return out;
}

/** A row passes if any tick claims it (union — a row has one author). "All" returns `rows`
 *  itself, whose identity is memoised upstream. */
export function filterTranscriptRows(
  rows: TranscriptRow[],
  index: AuthorIndex,
  filter: TranscriptFilter
): TranscriptRow[] {
  if (transcriptFilterIsAll(filter)) return rows;
  return rows.filter((row) => {
    const agentId = transcriptRowAgentId(row, index);
    return agentId === null ? filter.people : filter.agentIds.includes(agentId);
  });
}

/** The selection minus agents paged out of the loaded window (else a blank transcript under a
 *  stale label). Never written back — the window can widen again. */
export function resolveTranscriptFilter(
  filter: TranscriptFilter,
  agents: readonly TranscriptFilterAgent[]
): TranscriptFilter {
  if (filter.agentIds.length === 0) return filter;
  const live = filter.agentIds.filter((id) =>
    agents.some((agent) => agent.agentId === id)
  );
  // Nothing pruned: keep identity.
  if (live.length === filter.agentIds.length) return filter;
  return narrow(filter.people, live);
}

const ALL_LABEL = "All";
const PEOPLE_LABEL = "People";
const FILTER_LABEL = "Filter messages";
function triggerCountLabel(n: number) {
  return `${n} selected`;
}

/** Both dot faces use an inline `style` (a data-chosen `var()` cannot be a class); the gray is
 *  `--border-strong`, as `agent-box-rule.ts › AGENT_ACCENT_NEUTRAL`, so dot and accent agree. */
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

/** Every row's leading column — checkbox, then dot or a dot-sized spacer — so labels align. */
function RowMark({ checked, dot }: { checked: boolean; dot: AgentColorKey | null | false }) {
  return (
    // `data-row-mark`: the hook `transcript-filter-menu.test.tsx` uses to assert one column.
    <span data-row-mark className="flex items-center gap-2">
      {/* `aria-hidden`: `MenuItem`'s `checked` already announces the state. */}
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
        // Spacer with the dot's own class, so the two cannot drift.
        <span aria-hidden className={DOT} />
      ) : (
        <AgentDot color={dot} />
      )}
    </span>
  );
}

/** The filter menu (the selection lives in `message-pane.tsx`); it stays open across ticks. */
export function TranscriptFilterSelect({
  value,
  agents,
  onChange,
}: {
  value: TranscriptFilter;
  /** {@link transcriptFilterAgents}' answer — the same derivation the caller filters with. */
  agents: readonly TranscriptFilterAgent[];
  onChange: (next: TranscriptFilter) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Coordinate mode: a trigger-anchored panel would clip inside the overflow-clipping pane.
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  const isAll = transcriptFilterIsAll(value);
  const count = transcriptFilterCount(value);
  /** The one ticked agent, when that is the whole selection. */
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
          // Copy of `shared/ui/select-menu.tsx › TRIGGER_FACE.text`
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
        {/* The only menu hint on a pill-less trigger — never drop it. */}
        <ChevronDown size={11} className="shrink-0" />
      </button>
      <Popover
        open={anchor !== null}
        at={anchor ?? undefined}
        onClose={() => setAnchor(null)}
        className="min-w-[180px] max-w-[280px]"
      >
        {/* "All" clears rather than being a member; its tick is derived. */}
        <MenuItem
          checked={isAll}
          icon={<RowMark checked={isAll} dot={false} />}
          onSelect={() => {
            if (!isAll) onChange(TRANSCRIPT_FILTER_ALL);
          }}
        >
          {ALL_LABEL}
        </MenuItem>
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
