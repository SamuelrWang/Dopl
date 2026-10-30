"use client";

/**
 * Add an integration, the project's side of the hierarchy: pick it, test each model on the simulator
 * or on hardware you pair, run the capability tests, go live. Missing tests warn and never block.
 * A physical device a user owns is a different thing; it arrives through the Connect page.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, CircleAlert } from "lucide-react";
import type { CapabilityId } from "@dopl/device-contracts";
import { CAPABILITY_RISK_TIER } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { DEMO_NOW } from "../_data/company";
import { CATEGORIES, integrationById, integrationsIn, type IntegrationId, type ModelId } from "../_data/catalog";
import { addIntegration, usePortal } from "../_components/portal-store";
import { BASE, Card, FactChip, Id, IntegrationStatusPill, PortalPage, TierChip, TypeMark, ov } from "../_components/ui";

const STEPS = ["Pick an integration", "Test a model", "Run capability tests", "Go live"];

function Stepper({ step, onStep, canJump }: { step: number; onStep: (n: number) => void; canJump: boolean }) {
  return (
    <ol className="white-card m-0 grid list-none grid-cols-4 p-0">
      {STEPS.map((label, i) => {
        const done = i < step;
        return (
          <li key={label} className={cn(i > 0 && "border-l border-border-default")}>
            <button
              type="button"
              disabled={!canJump && i > step}
              onClick={() => onStep(i)}
              className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left disabled:opacity-60"
            >
              <span className={ov.mark} data-shape="tile">
                {done ? <Check size={12} aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn("truncate text-body", i === step ? "font-medium text-text-primary" : "text-text-secondary")}>{label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function Pick({ value, onPick }: { value: IntegrationId | null; onPick: (id: IntegrationId) => void }) {
  const { state } = usePortal();
  return (
    <div className="flex flex-col gap-3.5">
      {CATEGORIES.map((category) => {
        const list = integrationsIn(category.id);
        return (
          <Card key={category.id} title={category.name} aside={<TypeMark kind={category.kind} size="s" />}>
            {list.length === 0 ? (
              <p className={ov.note}>No integration yet</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {list.map((i) => {
                  const added = state.integrations[i.id];
                  return (
                    <button
                      key={i.id}
                      type="button"
                      data-selected={value === i.id}
                      onClick={() => onPick(i.id)}
                      className="white-card select-card flex min-w-0 items-center gap-2.5 px-3 py-2.5 text-left"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-body font-medium text-text-primary">{i.name}</span>
                        <span className={ov.rowMeta}>{i.models.map((m) => m.name).join(", ")}</span>
                      </span>
                      {added ? <IntegrationStatusPill status={added.status} /> : i.comingSoon ? <StatusPill>Coming soon</StatusPill> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

function QrWell({ seed }: { seed: string }) {
  // A deterministic, decorative pattern: the real page draws the pairing QR.
  const cells = Array.from({ length: 121 }, (_, i) => (seed.charCodeAt(i % seed.length) * (i + 7) * 2654435761) % 7 < 3);
  return (
    <span className="grid size-36 grid-cols-11 gap-px rounded-tile bg-bg-overlay p-2" aria-label="Pairing code" role="img">
      {cells.map((on, i) => (
        <i key={i} className={on ? "bg-text-primary" : "bg-transparent"} />
      ))}
    </span>
  );
}

function TestModel({
  integrationId,
  model,
  onModel,
  paired,
  onPaired,
}: {
  integrationId: IntegrationId;
  model: ModelId;
  onModel: (m: ModelId) => void;
  paired: string | null;
  onPaired: (name: string) => void;
}) {
  const [mode, setMode] = useState<"simulator" | "scan">("simulator");
  const integration = integrationById(integrationId)!;
  const current = integration.models.find((m) => m.id === model)!;
  return (
    <Card
      title="Your test device"
      aside={
        <SelectMenu
          variant="outline"
          prefix="Model"
          ariaLabel="Model"
          value={model}
          options={integration.models.map((m) => ({ value: m.id, label: m.name }))}
          onChange={onModel}
        />
      }
    >
      <SegmentedControl
        variant="underline"
        ariaLabel="Test on"
        options={[
          { key: "simulator", label: "Test on simulator" },
          { key: "scan", label: "Scan to pair real hardware" },
        ]}
        value={mode}
        onChange={setMode}
        className="border-b border-border-default"
      />
      {mode === "simulator" ? (
        <div className="card-well flex items-center gap-3 px-3.5 py-3">
          <span className={ov.rowMain}>
            <span className={ov.rowTitle}>Simulated {current.name}</span>
            <span className={ov.rowMeta}>Publishes the {current.capabilities.length} capabilities of this model</span>
          </span>
          <button
            type="button"
            className={pillButton(paired ? "outline" : "ink", "md")}
            onClick={() => onPaired(`Simulated ${current.name}`)}
          >
            {paired === `Simulated ${current.name}` ? "Running" : "Start simulator"}
          </button>
        </div>
      ) : (
        <div className="card-well flex items-center gap-5 px-3.5 py-3.5">
          <QrWell seed={`${integrationId}${model}`} />
          <span className="flex min-w-0 flex-col gap-2">
            <span className={ov.rowTitle}>Scan with the {integration.name} companion app</span>
            <span className="font-mono text-title text-text-primary">K7Q2-94</span>
            <button type="button" className={cn(pillButton(paired ? "outline" : "ink", "md"), "self-start")} onClick={() => onPaired(`Bench ${current.name}`)}>
              {paired === `Bench ${current.name}` ? "Paired" : "Confirm pairing"}
            </button>
          </span>
        </div>
      )}
      {paired && (
        <span className="flex items-center gap-2">
          <StatusPill tone="live" dot bare>
            Online
          </StatusPill>
          <span className="text-caption text-text-secondary">{paired}</span>
          <Id>dev_test_7c21</Id>
        </span>
      )}
    </Card>
  );
}

type TestState = "idle" | "running" | "passed";

function Tests({ model, results, setResults }: { model: ModelId; results: Partial<Record<CapabilityId, TestState>>; setResults: (fn: (r: Partial<Record<CapabilityId, TestState>>) => Partial<Record<CapabilityId, TestState>>) => void }) {
  const { state } = usePortal();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const caps = Object.keys(state.capabilities[model] ?? {}) as CapabilityId[];
  const run = (id: CapabilityId, delay = 0) => {
    timers.current.push(setTimeout(() => setResults((r) => ({ ...r, [id]: "running" })), delay));
    timers.current.push(setTimeout(() => setResults((r) => ({ ...r, [id]: "passed" })), delay + 420));
  };
  const runAll = () => caps.filter((c) => results[c] !== "passed").forEach((c, i) => run(c, i * 340));
  const passed = caps.filter((c) => results[c] === "passed").length;
  return (
    <Card title="Capability tests" count={`${passed} of ${caps.length} passed`} aside={<button type="button" className={pillButton("ink", "sm")} onClick={runAll}>Run all</button>}>
      <ul className={ov.rows}>
        {caps.map((c) => (
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
    </Card>
  );
}

export function AddDeviceSection({ initial }: { initial?: string }) {
  const router = useRouter();
  const { state, update } = usePortal();
  const seedPick = initial && integrationById(initial) ? (initial as IntegrationId) : null;
  const [step, setStep] = useState(seedPick ? 1 : 0);
  const [pick, setPick] = useState<IntegrationId | null>(seedPick);
  const integration = pick ? integrationById(pick) : null;
  const [model, setModel] = useState<ModelId | null>(integration?.models[0]?.id ?? null);
  const [paired, setPaired] = useState<string | null>(null);
  const [results, setResults] = useState<Partial<Record<CapabilityId, TestState>>>({});

  // Arriving from a Coming soon row with `?integration=` skips the picker, which is what adds it.
  useEffect(() => {
    if (seedPick) update((s) => addIntegration(s, seedPick, DEMO_NOW));
  }, [seedPick, update]);

  const choose = (id: IntegrationId) => {
    const chosen = integrationById(id)!;
    setPick(id);
    setModel(chosen.models[0]?.id ?? null);
    setPaired(null);
    setResults({});
    update((s) => addIntegration(s, id, DEMO_NOW));
    setStep(1);
  };

  const caps = model ? (Object.keys(state.capabilities[model] ?? {}) as CapabilityId[]) : [];
  const passed = caps.filter((c) => results[c] === "passed").length;
  const missing = caps.length - passed;

  const finish = (status: "testing" | "live") => {
    if (!pick) return;
    update((s) => ({ ...s, integrations: { ...s.integrations, [pick]: { ...s.integrations[pick]!, status, testsPassed: passed } } }));
    router.push(`${BASE}/devices/${pick}`);
  };

  const footer = (
    <div className="flex items-center justify-end gap-2">
      {step > 0 && (
        <button type="button" className={pillButton("quiet", "md")} onClick={() => setStep(step - 1)}>
          Back
        </button>
      )}
      {step < 3 && step > 0 && (
        <button type="button" className={pillButton("ink", "md")} onClick={() => setStep(step + 1)}>
          Continue
        </button>
      )}
    </div>
  );

  return (
    <PortalPage crumbs={[{ label: "Devices", href: `${BASE}/devices` }, { label: "Add integration" }]} title={integration ? `Add ${integration.name}` : "Add integration"}>
      <Stepper step={step} onStep={setStep} canJump={pick !== null} />
      {step === 0 && <Pick value={pick} onPick={choose} />}
      {step === 1 && pick && model && <TestModel integrationId={pick} model={model} onModel={setModel} paired={paired} onPaired={setPaired} />}
      {step === 2 && model && <Tests model={model} results={results} setResults={setResults} />}
      {step === 3 && integration && (
        <Card title="Go live">
          <ul className={ov.rows}>
            <li className={ov.row}>
              <span className={ov.rowMain}>
                <span className={ov.rowTitle}>Integration</span>
              </span>
              <span className="text-caption text-text-secondary">{integration.name}</span>
            </li>
            <li className={ov.row}>
              <span className={ov.rowMain}>
                <span className={ov.rowTitle}>Test device</span>
              </span>
              <span className="text-caption text-text-secondary">{paired ?? "None used"}</span>
            </li>
            <li className={ov.row}>
              <span className={ov.rowMain}>
                <span className={ov.rowTitle}>Capability tests</span>
              </span>
              <span className="text-caption text-text-secondary">
                {passed} of {caps.length} passed
              </span>
            </li>
          </ul>
          {missing > 0 && (
            <p className="flex items-center gap-1.5 text-caption text-warning">
              <CircleAlert size={13} aria-hidden="true" />
              {missing} capability tests have not passed. You can still go live.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className={pillButton("outline", "md")} onClick={() => finish("testing")}>
              Keep testing
            </button>
            <button type="button" className={pillButton("ink", "md")} onClick={() => finish("live")}>
              Go live
            </button>
          </div>
        </Card>
      )}
      {footer}
    </PortalPage>
  );
}
