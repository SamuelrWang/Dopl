"use client";

/**
 * Channels — the colour row in the launch-agent dialog: sixteen circles, keys held by the
 * channel's live agents unselectable. Paint is `agentColorVar` in an inline `style` (runtime key).
 */

import { useCallback, useMemo, useRef } from "react";
import { cn } from "@/shared/lib/utils";
import { FormSection } from "@/shared/ui/form-dialog";
import { AGENT_COLOR_KEYS, agentColorVar, freeAgentColors } from "../lib/agent-colors";
import type { AgentColorKey } from "../types";

/** Module-level so default props keep a stable identity and `free` is not recomputed per render. */
export const EMPTY_TAKEN: ReadonlySet<AgentColorKey> = new Set();
export const EMPTY_HOLDERS: ReadonlyMap<AgentColorKey, string> = new Map();

const CIRCLE = "h-5 w-5 shrink-0 rounded-full";

/** Tooltip name for a holder this surface cannot name (blank name or missing `takenBy` entry). */
const UNNAMED_HOLDER = "another agent";

/** The offset is what makes a same-hue ring visible; its colour is the dialog's ground. */
const RING = "ring-2 ring-offset-2 ring-offset-bg-elevated";

/** Keys this channel's live agents hold, and who holds each. Colourless rows take nothing; the
 *  first row per key names it. */
export function agentColorsTaken(
  sessions: ReadonlyArray<{
    /** Absent reads as LIVE (offering a key that 409s is cheaper than handing out a held one). */
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
    // `displayName` is caller-resolved (`agents-model.ts › agentDisplayName`); else the handle.
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
  /** Pick or dialog's first-free default (`launch-agent-dialog.tsx › effectiveColor`). */
  value: AgentColorKey | null;
  onChange: (next: AgentColorKey) => void;
  /** Keys held by live agents. Advisory: the server's unique index is the authority (409 with the
   *  free set), so empty means "nothing known to be taken". */
  taken?: ReadonlySet<AgentColorKey>;
  /** Key → holder name, for the `title` only; a missing entry never unlocks a circle. */
  takenBy?: ReadonlyMap<AgentColorKey, string>;
}) {
  const free = useMemo(() => freeAgentColors(taken), [taken]);
  const circles = useRef(new Map<AgentColorKey, HTMLButtonElement | null>());

  // Arrow keys move along the free keys and wrap. Buttons with `role="radio"`, not native radios:
  // native arrow keys check `aria-disabled` radios, and `disabled` suppresses the `title`.
  const step = useCallback(
    (delta: 1 | -1) => {
      if (free.length === 0) return;
      const at = value ? free.indexOf(value) : -1;
      // A current key outside the free path enters at either end.
      const base = at >= 0 ? at : delta === 1 ? -1 : 0;
      const next = free[(base + delta + free.length) % free.length];
      onChange(next);
      circles.current.get(next)?.focus();
    },
    [free, value, onChange]
  );

  // Roving tabIndex; a full bank still keeps a tab stop (first key) so its `title` is reachable.
  const tabStop =
    value && free.includes(value) ? value : (free[0] ?? AGENT_COLOR_KEYS[0]);

  return (
    <FormSection label="Colour">
      {/* The visible "Colour" is a <span>, so the group needs its own accessible name. */}
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
              aria-disabled={held || undefined}
              aria-label={key}
              title={held ? `In use by ${takenBy.get(key) ?? UNNAMED_HOLDER}` : undefined}
              data-agent-color={key}
              tabIndex={key === tabStop ? 0 : -1}
              onClick={() => {
                // `aria-disabled` is only a label; this guard is the fence.
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
                held ? "cursor-not-allowed opacity-35" : "cursor-pointer",
                checked && RING
              )}
              style={{
                backgroundColor: paint,
                // A runtime key's ring colour rides Tailwind's own ring variable.
                ...(checked ? { ["--tw-ring-color" as string]: paint } : {}),
              }}
            />
          );
        })}
      </div>
    </FormSection>
  );
}
