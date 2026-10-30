"use client";

/**
 * Add a device to the project: category, then model, then test it. Adding its model adds its
 * integration, so every model of that integration appears on the Devices page. Missing tests warn
 * and never block. A physical device a user owns is a different thing; it arrives through Connect.
 */
import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import { CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { FormSection } from "@/shared/ui/form-dialog";
import { pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { DialogActions, StandardDialog } from "@/shared/ui/standard-dialog";
import { StatusPill } from "@/shared/ui/status-pill";
import { DEMO_NOW } from "../_data/company";
import { CATEGORIES, INTEGRATIONS, type CategoryId, type Integration, type Model } from "../_data/catalog";
import { addIntegration, usePortal, type PortalState } from "../_components/portal-store";
import { FactChip, TierChip, ov } from "../_components/ui";

type TestState = "running" | "passed";
type Results = Partial<Record<CapabilityId, TestState>>;

/** The models a project can still add in a category, each with its integration. */
function availableIn(state: PortalState, category: CategoryId): { model: Model; integration: Integration }[] {
  return INTEGRATIONS.filter((i) => i.categoryId === category && !state.integrations[i.id]).flatMap((integration) => integration.models.map((model) => ({ model, integration })));
}

function QrWell({ seed }: { seed: string }) {
  // A deterministic, decorative pattern: the real page draws the pairing QR.
  const cells = Array.from({ length: 121 }, (_, i) => (seed.charCodeAt(i % seed.length) * (i + 7) * 2654435761) % 7 < 3);
  return (
    <span className="grid size-28 shrink-0 grid-cols-11 gap-px rounded-tile bg-bg-overlay p-2" aria-label="Pairing code" role="img">
      {cells.map((on, i) => (
        <i key={i} className={on ? "bg-text-primary" : "bg-transparent"} />
      ))}
    </span>
  );
}

function TestDevice({ model, integration, paired, onPaired }: { model: Model; integration: Integration; paired: string | null; onPaired: (name: string) => void }) {
  const [mode, setMode] = useState<"simulator" | "scan">("simulator");
  const simulated = `Simulated ${model.name}`;
  const bench = `Bench ${model.name}`;
  return (
    <FormSection label="Test on">
      <SegmentedControl
        variant="underline"
        ariaLabel="Test on"
        options={[
          { key: "simulator", label: "Simulator" },
          { key: "scan", label: "Real hardware" },
        ]}
        value={mode}
        onChange={setMode}
        className="border-b border-border-default"
      />
      {mode === "simulator" ? (
        <div className="card-well mt-2 flex items-center gap-3 px-3.5 py-3">
          <span className={cn(ov.rowTitle, "min-w-0 flex-1 truncate")}>{simulated}</span>
          <button type="button" className={pillButton(paired === simulated ? "outline" : "ink", "md", { raise: false })} onClick={() => onPaired(simulated)}>
            {paired === simulated ? "Running" : "Start"}
          </button>
        </div>
      ) : (
        <div className="card-well mt-2 flex items-center gap-4 px-3.5 py-3">
          <QrWell seed={`${integration.id}${model.id}`} />
          <span className="flex min-w-0 flex-col gap-2">
            <span className="font-mono text-title text-text-primary">K7Q2-94</span>
            <button type="button" className={cn(pillButton(paired === bench ? "outline" : "ink", "md", { raise: false }), "self-start")} onClick={() => onPaired(bench)}>
              {paired === bench ? "Paired" : "Confirm pairing"}
            </button>
          </span>
        </div>
      )}
    </FormSection>
  );
}

function CapabilityTests({ model, results, setResults }: { model: Model; results: Results; setResults: (fn: (r: Results) => Results) => void }) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const run = (id: CapabilityId, delay = 0) => {
    timers.current.push(setTimeout(() => setResults((r) => ({ ...r, [id]: "running" })), delay));
    timers.current.push(setTimeout(() => setResults((r) => ({ ...r, [id]: "passed" })), delay + 420));
  };
  const runAll = () => model.capabilities.filter((c) => results[c] !== "passed").forEach((c, i) => run(c, i * 340));
  const passed = model.capabilities.filter((c) => results[c] === "passed").length;
  return (
    <FormSection label="Capability tests" caption={`${passed} of ${model.capabilities.length} passed`}>
      <ul className={ov.rows}>
        {model.capabilities.map((c) => (
          <li key={c} className={ov.row}>
            <TierChip tier={CAPABILITY_RISK_TIER[c]} />
            <span className={ov.rowMain}>
              <span className={cn(ov.rowTitle, "font-mono text-small")}>{c}</span>
            </span>
            {results[c] === "passed" ? (
              <FactChip icon={<Check size={12} aria-hidden="true" />}>Passed</FactChip>
            ) : results[c] === "running" ? (
              <StatusPill>Running</StatusPill>
            ) : (
              <button type="button" className={pillButton("outline", "xs")} onClick={() => run(c)}>
                Run
              </button>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className={cn(pillButton("outline", "md"), "mt-2 self-start")} onClick={runAll}>
        Run all
      </button>
    </FormSection>
  );
}

export function AddDeviceDialog({ initialCategory, onClose }: { initialCategory: CategoryId; onClose: () => void }) {
  const { state, update } = usePortal();
  const [category, setCategory] = useState<CategoryId>(initialCategory);
  const available = availableIn(state, category);
  const [modelId, setModelId] = useState<string>(available[0]?.model.id ?? "");
  const [paired, setPaired] = useState<string | null>(null);
  const [results, setResults] = useState<Results>({});
  const chosen = available.find((a) => a.model.id === modelId) ?? null;

  const resetTests = () => {
    setPaired(null);
    setResults({});
  };
  const pickCategory = (next: CategoryId) => {
    setCategory(next);
    setModelId(availableIn(state, next)[0]?.model.id ?? "");
    resetTests();
  };
  const pickModel = (next: string) => {
    setModelId(next);
    resetTests();
  };

  const passed = chosen ? chosen.model.capabilities.filter((c) => results[c] === "passed").length : 0;
  const missing = chosen ? chosen.model.capabilities.length - passed : 0;

  const finish = (status: "testing" | "live") => {
    if (!chosen) return;
    const id = chosen.integration.id;
    update((s) => {
      const next = addIntegration(s, id, DEMO_NOW);
      return { ...next, integrations: { ...next.integrations, [id]: { ...next.integrations[id]!, status, testsPassed: passed } } };
    });
    onClose();
  };

  return (
    <StandardDialog open onClose={onClose} title="Add new device">
      <FormSection label="Category">
        <SelectMenu
          variant="outline"
          ariaLabel="Category"
          value={category}
          options={CATEGORIES.map((c) => ({ value: c.id, label: c.name }))}
          onChange={pickCategory}
          className="w-full justify-between"
        />
      </FormSection>
      <FormSection label="Model">
        <SelectMenu
          variant="outline"
          ariaLabel="Model"
          value={modelId}
          disabled={available.length === 0}
          options={
            available.length === 0
              ? [{ value: "", label: "None available" }]
              : available.map(({ model, integration }) => ({ value: model.id, label: model.name, description: integration.name }))
          }
          onChange={pickModel}
          className="w-full justify-between"
        />
      </FormSection>
      {chosen && (
        <>
          <TestDevice model={chosen.model} integration={chosen.integration} paired={paired} onPaired={setPaired} />
          <CapabilityTests model={chosen.model} results={results} setResults={setResults} />
          {missing > 0 && (
            <p className="flex items-center gap-1.5 text-caption text-warning">
              <CircleAlert size={13} aria-hidden="true" />
              {missing} tests have not passed
            </p>
          )}
        </>
      )}
      <DialogActions>
        <button type="button" disabled={!chosen} className={cn(pillButton("outline", "md"), "disabled:opacity-60")} onClick={() => finish("testing")}>
          Keep testing
        </button>
        <button type="button" disabled={!chosen} className={cn(pillButton("ink", "md", { raise: false }), "disabled:opacity-60")} onClick={() => finish("live")}>
          Go live
        </button>
      </DialogActions>
    </StandardDialog>
  );
}
