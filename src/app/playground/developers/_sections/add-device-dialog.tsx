"use client";

/**
 * Add a device to the project, one decision per page: category, model, how to test, connect, run the
 * tests, review. Adding its model adds its integration. Missing tests warn and never block. A
 * physical device a user owns is a different thing; it arrives through Connect.
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import b from "../_design/base.module.css";
import { cx, ICON_100 } from "../_design/components";
import flow from "../_design/flow.module.css";
import tokens from "../_design/tokens.module.css";
import { useSimulatorSession } from "../_components/device-simulator";
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

export function AddDeviceDialog({ initialCategory, onClose }: { initialCategory: CategoryId | null; onClose: () => void }) {
  const { state, update } = usePortal();
  const startable = initialCategory !== null && availableIn(state, initialCategory).length > 0;
  const [step, setStep] = useState(startable ? 1 : 0);
  const [category, setCategory] = useState<Category | null>(startable ? CATEGORIES.find((c) => c.id === initialCategory)! : null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [method, setMethod] = useState<TestMethod | null>(null);
  const [paired, setPaired] = useState(false);
  const sim = useSimulatorSession();
  const [results, setResults] = useState<Results>({});

  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  const options = category ? availableIn(state, category.id) : [];
  const chosen = options.find((o) => o.model.id === modelId) ?? null;
  const passed = chosen ? chosen.model.capabilities.filter((c) => results[c] === "passed").length : 0;

  const resetTest = () => {
    setMethod(null);
    setPaired(false);
    sim.stop();
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
    if (next !== method) {
      setPaired(false);
      sim.stop();
    }
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
  const connected = method === "simulator" ? sim.running : paired;
  const testDevice = connected && chosen ? `${method === "simulator" ? "Simulated" : "Bench"} ${chosen.model.name}` : "None";

  return (
    <div className={cx(flow.layer, tokens.scope, tokens.u100)}>
      <button type="button" className={flow.scrim} aria-label="Dismiss" tabIndex={-1} onClick={onClose} />
      <div ref={dialog} className={flow.dialog} role="dialog" aria-modal="true" aria-label="Add new device" tabIndex={-1}>
        <button type="button" className={cx(b.reset, flow.close)} onClick={onClose} aria-label="Close">
          <X {...ICON_100} />
        </button>
        <header className={flow.head}>
          <span className={cx(b.smallMuted, b.num)}>
            Step {step + 1} of {STEP_TITLES.length}
          </span>
          <h2 className={b.title}>{STEP_TITLES[step]}</h2>
          <span className={flow.progress} aria-hidden="true">
            {STEP_TITLES.map((t, i) => (
              <i key={t} className={cx(flow.progressStep, i <= step && flow.progressOn)} />
            ))}
          </span>
        </header>
        <div className={flow.body}>
          {step === 0 && <CategoryStep categories={CATEGORIES} availableCount={(c) => availableIn(state, c.id).length} value={category?.id ?? null} onPick={pickCategory} />}
          {step === 1 && category && <ModelStep category={category} options={options} value={modelId} onPick={pickModel} />}
          {step === 2 && <MethodStep value={method} onPick={pickMethod} />}
          {step === 3 && chosen && method && <ConnectStep method={method} model={chosen.model} sim={sim} connected={paired} onConnect={() => setPaired(true)} />}
          {step === 4 && chosen && <TestsStep model={chosen.model} sim={sim} results={results} setResults={setResults} />}
          {step === 5 && chosen && category && <ReviewStep category={category} model={chosen.model} integration={chosen.integration} testDevice={testDevice} passed={passed} />}
        </div>
        <footer className={flow.foot}>
          {step > 0 && (
            <button type="button" className={cx(b.btn, b.ghost)} onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <span className={b.grow} />
          {step < LAST ? (
            <button type="button" disabled={!canContinue} className={cx(b.btn, canContinue ? b.ink : b.off)} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <>
              <button type="button" className={b.btn} onClick={() => finish("testing")}>
                Keep testing
              </button>
              <button type="button" className={cx(b.btn, b.ink)} onClick={() => finish("live")}>
                Go live
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
