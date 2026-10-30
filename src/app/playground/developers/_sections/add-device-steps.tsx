"use client";

/** The add-device popup's pages. Each is one decision; the shell owns state, progress and footer. */
import { useEffect, useRef, type ReactNode } from "react";
import { Check, CircleAlert, MonitorPlay, QrCode } from "lucide-react";
import { CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { functionsOf, type Category, type Integration, type Model } from "../_data/catalog";
import { DeviceScreen, SimulatorControls, type SimMessage, type SimulatorSession } from "../_components/device-simulator";
import { FactChip, TierChip, TypeMark, ov } from "../_components/ui";

export type TestMethod = "simulator" | "hardware";
export type TestState = "running" | "passed";
export type Results = Partial<Record<CapabilityId, TestState>>;

/** One selectable tile. Hugs the grid cell; the kit's selected edge plus a check say it is chosen. */
function Tile({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      data-selected={selected}
      disabled={disabled}
      onClick={onClick}
      className="white-card select-card relative flex min-w-0 flex-col items-start gap-2.5 p-3.5 text-left disabled:opacity-50"
    >
      {selected && <Check size={15} strokeWidth={2.4} aria-hidden="true" className="absolute right-3 top-3 text-text-primary" />}
      {children}
    </button>
  );
}

export function CategoryStep({ categories, availableCount, value, onPick }: { categories: readonly Category[]; availableCount: (c: Category) => number; value: string | null; onPick: (c: Category) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2.5">
      {categories.map((c) => {
        const count = availableCount(c);
        return (
          <Tile key={c.id} selected={value === c.id} disabled={count === 0} onClick={() => onPick(c)}>
            <TypeMark kind={c.kind} size="l" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium text-text-primary">{c.name}</span>
              <span className={ov.rowMeta}>{count === 0 ? "None available" : `${count} available`}</span>
            </span>
          </Tile>
        );
      })}
    </div>
  );
}

export function ModelStep({ kind, options, value, onPick }: { kind: string; options: { model: Model; integration: Integration }[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {options.map(({ model, integration }) => (
        <Tile key={model.id} selected={value === model.id} onClick={() => onPick(model.id)}>
          <span className="flex w-full min-w-0 items-center gap-2.5 pr-5">
            <TypeMark kind={kind} size="l" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium text-text-primary">{model.name}</span>
              <span className={ov.rowMeta}>{integration.name}</span>
            </span>
          </span>
          <span className="flex flex-wrap gap-1">
            {functionsOf(model)
              .slice(0, 3)
              .map((f) => (
                <FactChip key={f}>{f}</FactChip>
              ))}
          </span>
          {integration.comingSoon && <StatusPill>Coming soon</StatusPill>}
        </Tile>
      ))}
    </div>
  );
}

export function MethodStep({ value, onPick }: { value: TestMethod | null; onPick: (m: TestMethod) => void }) {
  const tile = (method: TestMethod, Icon: typeof QrCode, title: string, sub: string) => (
    <Tile selected={value === method} onClick={() => onPick(method)}>
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-raised-1 text-text-secondary">
        <Icon size={20} strokeWidth={1.7} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-body font-medium text-text-primary">{title}</span>
        <span className={ov.rowMeta}>{sub}</span>
      </span>
    </Tile>
  );
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {tile("simulator", MonitorPlay, "Simulator", "No hardware")}
      {tile("hardware", QrCode, "Real hardware", "Scan to pair")}
    </div>
  );
}

function QrWell({ seed }: { seed: string }) {
  // A deterministic, decorative pattern: the real page draws the pairing QR.
  const cells = Array.from({ length: 121 }, (_, i) => (seed.charCodeAt(i % seed.length) * (i + 7) * 2654435761) % 7 < 3);
  return (
    <span className="grid size-36 shrink-0 grid-cols-11 gap-px rounded-tile bg-bg-overlay p-2" aria-label="Pairing code" role="img">
      {cells.map((on, i) => (
        <i key={i} className={on ? "bg-text-primary" : "bg-transparent"} />
      ))}
    </span>
  );
}

export function ConnectStep({ method, model, sim, connected, onConnect }: { method: TestMethod; model: Model; sim: SimulatorSession; connected: boolean; onConnect: () => void }) {
  const status = connected ? (
    <StatusPill tone="live" dot bare>
      Online
    </StatusPill>
  ) : (
    <StatusPill>Not connected</StatusPill>
  );
  if (method === "hardware") {
    return (
      <div className="card-well flex items-center gap-5 p-4">
        <QrWell seed={model.id} />
        <span className="flex min-w-0 flex-col items-start gap-2.5">
          {status}
          <span className="font-mono text-title text-text-primary">K7Q2-94</span>
          <button type="button" className={pillButton(connected ? "outline" : "ink", "md", { raise: false })} onClick={onConnect}>
            {connected ? "Paired" : "Confirm pairing"}
          </button>
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <DeviceScreen surface={model.surface} lines={sim.screen?.lines ?? []} options={sim.screen?.options} placeholder={sim.running ? "Waiting for a message" : `Simulated ${model.name}`} onTap={sim.tap} />
      <SimulatorControls session={sim} model={model} />
    </div>
  );
}

/** What each capability test puts on the simulator; reads and captures only log. */
function testMessage(c: CapabilityId): SimMessage | null {
  if (c === "ask.choice" || c === "ask.confirm") return { capability: c, lines: ["Test: deploy to production?"], options: ["Yes", "No"] };
  if (c.startsWith("present.") || c === "ask.text") return { capability: c, lines: [`Test: ${c}`] };
  return null;
}

export function TestsStep({ model, sim, results, setResults }: { model: Model; sim: SimulatorSession; results: Results; setResults: (fn: (r: Results) => Results) => void }) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const run = (id: CapabilityId, delay = 0) => {
    timers.current.push(
      setTimeout(() => {
        setResults((r) => ({ ...r, [id]: "running" }));
        if (!sim.running) return;
        const message = testMessage(id);
        if (message) sim.send(message);
        else sim.log(id);
      }, delay)
    );
    timers.current.push(setTimeout(() => setResults((r) => ({ ...r, [id]: "passed" })), delay + 420));
  };
  const runAll = () => model.capabilities.filter((c) => results[c] !== "passed").forEach((c, i) => run(c, i * 340));
  const passed = model.capabilities.filter((c) => results[c] === "passed").length;
  return (
    <div className="flex flex-col gap-2.5">
      {sim.running && <DeviceScreen surface={model.surface} lines={sim.screen?.lines ?? []} options={sim.screen?.options} placeholder="Waiting for a message" onTap={sim.tap} className="min-h-24" />}
      <div className="flex items-center justify-between">
        <span className="text-caption tabular-nums text-text-secondary">
          {passed} of {model.capabilities.length} passed
        </span>
        <button type="button" className={pillButton("outline", "sm")} onClick={runAll}>
          Run all
        </button>
      </div>
      <ul className={cn(ov.rows, "white-card px-3.5")}>
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
    </div>
  );
}

export function ReviewStep({ kind, model, integration, testDevice, passed }: { kind: string; model: Model; integration: Integration; testDevice: string; passed: number }) {
  const missing = model.capabilities.length - passed;
  return (
    <div className="flex flex-col gap-3">
      <div className="white-card flex items-center gap-3 p-3.5">
        <TypeMark kind={kind} size="l" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-heading font-medium text-text-primary">{model.name}</span>
          <span className={ov.rowMeta}>{integration.name}</span>
        </span>
      </div>
      <div className="card-well grid grid-cols-2 gap-2 px-3 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-micro text-text-muted">Test device</span>
          <span className="truncate text-body font-medium text-text-primary">{testDevice}</span>
        </span>
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-micro text-text-muted">Tests passed</span>
          <span className="text-body font-medium tabular-nums text-text-primary">
            {passed} of {model.capabilities.length}
          </span>
        </span>
      </div>
      {missing > 0 && (
        <p className="flex items-center gap-1.5 text-caption text-warning">
          <CircleAlert size={13} aria-hidden="true" />
          {missing} tests have not passed
        </p>
      )}
    </div>
  );
}
