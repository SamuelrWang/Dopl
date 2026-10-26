"use client";

/**
 * STAGING-ONLY floating control (outside the app window) that forces the states a
 * live session reaches only by accident, so every screen of the ontology face can
 * be reached by clicking. Not part of the desktop UI — never port.
 */

import { useState } from "react";
import { useStagingOntologyStore, type StagingScenario } from "./store/staging-ontology-store";

const SCENARIOS: ReadonlyArray<{ key: StagingScenario; label: string }> = [
  { key: "board", label: "Board (normal)" },
  { key: "empty", label: "No ontologies yet" },
  { key: "not-onboarded", label: "Home space not set up" },
  { key: "pane-loading", label: "Pane loading (bare)" },
  { key: "list-error", label: "List load error" },
  { key: "board-loading", label: "Board skeleton" },
  { key: "board-error", label: "Board load error" },
  { key: "pinned-gone", label: "Ontology no longer here" },
  { key: "cap-near", label: "Object cap: near" },
  { key: "cap-over", label: "Object cap: over" },
];

export function StagingScenarioPanel() {
  const { scenario, setScenario } = useStagingOntologyStore();
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{ position: "fixed", right: 34, bottom: 34, zIndex: 60 }}
      className="flex flex-col items-end gap-2"
    >
      {open && (
        <div className="flex w-56 flex-col gap-0.5 rounded-xl border border-border-default bg-white p-1.5 shadow-lg">
          <p className="px-2 pb-1 pt-0.5 text-micro font-semibold uppercase text-text-muted">
            Staging state
          </p>
          {SCENARIOS.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setScenario(s.key)}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-left text-small text-text-secondary hover:bg-surface-raised-1"
              data-active={scenario === s.key ? "true" : undefined}
            >
              {s.label}
              {scenario === s.key && <span className="text-text-primary">●</span>}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-full bg-surface-cta px-3.5 py-2 text-small font-medium text-text-on-cta shadow-lg"
      >
        {open ? "Close" : "States"}
      </button>
    </div>
  );
}
