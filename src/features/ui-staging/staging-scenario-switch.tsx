"use client";

/**
 * STAGING-ONLY CONTROL (no desktop counterpart): a small floating "States" pill over the stage's
 * bottom-right corner that flips the facts the desktop reads from boot / the selected channel —
 * which channel is selected, the caller's role in it, whether the home space exists — so every
 * branch of the staged face (empty states, hidden create buttons, unavailable sections) is
 * reachable by clicking. Lives OUTSIDE the app window; never ported.
 *
 * Shared by `/knowledge` and `/identities` (moved here from `knowledge-staging/` 2026-10-22).
 */

import { useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";

export interface ScenarioOption<V extends string> {
  value: V;
  label: string;
}

export interface ScenarioGroup<V extends string = string> {
  key: string;
  label: string;
  value: V;
  options: ReadonlyArray<ScenarioOption<V>>;
  onChange: (value: V) => void;
}

export function StagingScenarioSwitch({
  groups,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous option unions
  groups: ReadonlyArray<ScenarioGroup<any>>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-[34px] right-[34px] z-[60] flex flex-col items-end gap-2">
      {open && (
        <div className="w-[248px] rounded-xl border border-border-default bg-bg-elevated p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-caption font-semibold text-text-primary">Staging states</span>
            <button
              type="button"
              aria-label="Close staging states"
              onClick={() => setOpen(false)}
              className="text-text-muted hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-2.5">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1">
                <span className="text-micro font-medium uppercase tracking-wide text-text-muted">
                  {group.label}
                </span>
                <div className="flex flex-wrap gap-1">
                  {group.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => group.onChange(option.value)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-caption transition-colors",
                        option.value === group.value
                          ? "border-text-primary bg-text-primary text-bg-elevated"
                          : "border-border-default text-text-secondary hover:bg-bg-inset"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full bg-text-primary px-3 py-1.5 text-caption font-medium text-bg-elevated shadow-md"
      >
        <SlidersHorizontal size={13} aria-hidden="true" />
        States
      </button>
    </div>
  );
}
