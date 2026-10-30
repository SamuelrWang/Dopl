"use client";

/**
 * Add a device to the project, one decision per page: category, model, how to test, connect, run the
 * tests, review. Adding its model adds its integration. Missing tests warn and never block. A
 * physical device a user owns is a different thing; it arrives through Connect.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { ModalShell } from "@/shared/layout/settings-modal/modal-shell";
import modalStyles from "@/shared/layout/settings-modal/settings-modal.module.css";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { DEMO_NOW } from "../_data/company";
import { CATEGORIES, INTEGRATIONS, type Category, type CategoryId, type Integration, type Model } from "../_data/catalog";
import { addIntegration, usePortal, type PortalState } from "../_components/portal-store";
import { CategoryStep, ConnectStep, MethodStep, ModelStep, ReviewStep, TestsStep, type Results, type TestMethod } from "./add-device-steps";

const STEP_TITLES = ["Choose a category", "Choose a device", "Choose how to test", "Connect your test device", "Run capability tests", "Review"];
const LAST = STEP_TITLES.length - 1;

/** The models a project can still add in a category, each with its integration. */
function availableIn(state: PortalState, category: CategoryId): { model: Model; integration: Integration }[] {
  return INTEGRATIONS.filter((i) => i.categoryId === category && !state.integrations[i.id]).flatMap((integration) => integration.models.map((model) => ({ model, integration })));
}

export function AddDeviceDialog({ initialCategory, onClose }: { initialCategory: CategoryId; onClose: () => void }) {
  const { state, update } = usePortal();
  const startable = availableIn(state, initialCategory).length > 0;
  const [step, setStep] = useState(startable ? 1 : 0);
  const [category, setCategory] = useState<Category | null>(startable ? CATEGORIES.find((c) => c.id === initialCategory)! : null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [method, setMethod] = useState<TestMethod | null>(null);
  const [connected, setConnected] = useState(false);
  const [results, setResults] = useState<Results>({});

  const options = category ? availableIn(state, category.id) : [];
  const chosen = options.find((o) => o.model.id === modelId) ?? null;
  const passed = chosen ? chosen.model.capabilities.filter((c) => results[c] === "passed").length : 0;

  const resetTest = () => {
    setMethod(null);
    setConnected(false);
    setResults({});
  };
  const pickCategory = (next: Category) => {
    if (next.id !== category?.id) {
      setModelId(null);
      resetTest();
    }
    setCategory(next);
  };
  const pickModel = (id: string) => {
    if (id !== modelId) resetTest();
    setModelId(id);
  };
  const pickMethod = (next: TestMethod) => {
    if (next !== method) setConnected(false);
    setMethod(next);
  };

  const canContinue = [category !== null, chosen !== null, method !== null, true, true][step] ?? true;
  const finish = (status: "testing" | "live") => {
    if (!chosen) return;
    const id = chosen.integration.id;
    update((s) => {
      const next = addIntegration(s, id, DEMO_NOW);
      return { ...next, integrations: { ...next.integrations, [id]: { ...next.integrations[id]!, status, testsPassed: passed } } };
    });
    onClose();
  };
  const testDevice = connected && chosen ? `${method === "simulator" ? "Simulated" : "Bench"} ${chosen.model.name}` : "None";

  return (
    <ModalShell open onClose={onClose} label="Add new device" size="narrow">
      <button type="button" className={modalStyles.close} onClick={onClose} aria-label="Close">
        <X size={18} />
      </button>
      <div className="flex h-[min(76vh,560px)] flex-col">
        <header className="flex flex-col gap-3 px-6 pt-6">
          <span className="text-caption tabular-nums text-text-muted">
            Step {step + 1} of {STEP_TITLES.length}
          </span>
          <h2 className="text-title font-medium text-text-primary">{STEP_TITLES[step]}</h2>
          <span className="flex gap-1" aria-hidden="true">
            {STEP_TITLES.map((t, i) => (
              <i key={t} className={cn("h-0.75 flex-1 rounded-full", i <= step ? "bg-surface-cta" : "bg-surface-raised-3")} />
            ))}
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && <CategoryStep categories={CATEGORIES} availableCount={(c) => availableIn(state, c.id).length} value={category?.id ?? null} onPick={pickCategory} />}
          {step === 1 && category && <ModelStep kind={category.kind} options={options} value={modelId} onPick={pickModel} />}
          {step === 2 && <MethodStep value={method} onPick={pickMethod} />}
          {step === 3 && chosen && method && <ConnectStep method={method} model={chosen.model} connected={connected} onConnect={() => setConnected(true)} />}
          {step === 4 && chosen && <TestsStep model={chosen.model} results={results} setResults={setResults} />}
          {step === 5 && chosen && category && <ReviewStep kind={category.kind} model={chosen.model} integration={chosen.integration} testDevice={testDevice} passed={passed} />}
        </div>
        <footer className="flex items-center gap-2 border-t border-border-default px-6 py-3.5">
          {step > 0 && (
            <button type="button" className={pillButton("quiet", "md")} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className="flex-1" />
          {step < LAST ? (
            <button type="button" disabled={!canContinue} className={cn(pillButton("ink", "md", { raise: false }), "disabled:opacity-60")} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <>
              <button type="button" className={pillButton("outline", "md")} onClick={() => finish("testing")}>
                Keep testing
              </button>
              <button type="button" className={pillButton("ink", "md", { raise: false })} onClick={() => finish("live")}>
                Go live
              </button>
            </>
          )}
        </footer>
      </div>
    </ModalShell>
  );
}
