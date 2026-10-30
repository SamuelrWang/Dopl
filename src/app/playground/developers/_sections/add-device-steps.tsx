"use client";

/** The add-device popup's pages. Each is one decision; the shell owns state, progress and footer. */
import { useEffect, useRef, type ReactNode } from "react";
import { Check, CircleAlert, MonitorPlay, QrCode } from "lucide-react";
import { CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import b from "../_design/base.module.css";
import { cx, ICON_100, ICON_100_SM } from "../_design/components";
import flow from "../_design/flow.module.css";
import { TIER_LABEL, functionsOf, type Category, type Integration, type Model } from "../_data/catalog";
import { CategoryGlyph } from "../_components/category-glyph";
import { DeviceScreen, SimulatorControls, type SimMessage, type SimulatorSession } from "../_components/device-simulator";

export type TestMethod = "simulator" | "hardware";
export type TestState = "running" | "passed";
export type Results = Partial<Record<CapabilityId, TestState>>;

/** One selectable tile; the ink edge and a check say it is chosen. */
function Tile({ selected, disabled, onClick, children }: { selected: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={selected} disabled={disabled} onClick={onClick} className={cx(flow.tile, selected && flow.tileOn, disabled && flow.tileOff)}>
      {selected && <Check {...ICON_100_SM} aria-hidden="true" className={flow.tileCheck} />}
      {children}
    </button>
  );
}

function Mark({ children }: { children: ReactNode }) {
  return <span className={b.tile}>{children}</span>;
}

export function CategoryStep({ categories, availableCount, value, onPick }: { categories: readonly Category[]; availableCount: (c: Category) => number; value: string | null; onPick: (c: Category) => void }) {
  return (
    <div className={flow.tiles3}>
      {categories.map((c) => {
        const count = availableCount(c);
        return (
          <Tile key={c.id} selected={value === c.id} disabled={count === 0} onClick={() => onPick(c)}>
            <Mark>
              <CategoryGlyph id={c.id} size={ICON_100} />
            </Mark>
            <span className={b.tight}>
              <span className={b.strong}>{c.name}</span>
              <span className={b.smallMuted}>{count === 0 ? "None available" : `${count} available`}</span>
            </span>
          </Tile>
        );
      })}
    </div>
  );
}

export function ModelStep({ category, options, value, onPick }: { category: Category; options: { model: Model; integration: Integration }[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <div className={flow.tiles2}>
      {options.map(({ model, integration }) => (
        <Tile key={model.id} selected={value === model.id} onClick={() => onPick(model.id)}>
          <span className={b.row}>
            <Mark>
              <CategoryGlyph id={category.id} size={ICON_100} />
            </Mark>
            <span className={b.tight}>
              <span className={b.strong}>{model.name}</span>
              <span className={b.smallMuted}>{integration.name}</span>
            </span>
          </span>
          <span className={cx(b.row, b.wrap)}>
            {functionsOf(model)
              .slice(0, 3)
              .map((f) => (
                <span key={f} className={cx(b.badge, b.badgeRing)}>
                  {f}
                </span>
              ))}
            {integration.comingSoon && <span className={b.badge}>Coming soon</span>}
          </span>
        </Tile>
      ))}
    </div>
  );
}

export function MethodStep({ value, onPick }: { value: TestMethod | null; onPick: (m: TestMethod) => void }) {
  const tile = (method: TestMethod, Icon: typeof QrCode, title: string, sub: string) => (
    <Tile selected={value === method} onClick={() => onPick(method)}>
      <Mark>
        <Icon {...ICON_100} aria-hidden="true" />
      </Mark>
      <span className={b.tight}>
        <span className={b.strong}>{title}</span>
        <span className={b.smallMuted}>{sub}</span>
      </span>
    </Tile>
  );
  return (
    <div className={flow.tiles2}>
      {tile("simulator", MonitorPlay, "Simulator", "No hardware")}
      {tile("hardware", QrCode, "Real hardware", "Scan to pair")}
    </div>
  );
}

function QrWell({ seed }: { seed: string }) {
  // A deterministic, decorative pattern: the real page draws the pairing QR.
  const cells = Array.from({ length: 121 }, (_, i) => (seed.charCodeAt(i % seed.length) * (i + 7) * 2654435761) % 7 < 3);
  return (
    <span className={flow.qr} aria-label="Pairing code" role="img">
      {cells.map((on, i) => (
        <i key={i} className={on ? flow.qrOn : undefined} />
      ))}
    </span>
  );
}

export function ConnectStep({ method, model, sim, connected, onConnect }: { method: TestMethod; model: Model; sim: SimulatorSession; connected: boolean; onConnect: () => void }) {
  if (method === "hardware") {
    return (
      <div className={flow.pair}>
        <QrWell seed={model.id} />
        <span className={b.stack}>
          <span>
            {connected ? (
              <span className={cx(b.badge, b.badgeOk)}>
                <span className={b.dot} />
                Online
              </span>
            ) : (
              <span className={cx(b.badge, b.badgeRing)}>Not connected</span>
            )}
          </span>
          <span className={flow.code}>K7Q2-94</span>
          <span>
            <button type="button" className={cx(b.btn, !connected && b.ink)} onClick={onConnect}>
              {connected ? "Paired" : "Confirm pairing"}
            </button>
          </span>
        </span>
      </div>
    );
  }
  return (
    <div className={b.stack}>
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
    <div className={b.stack}>
      {sim.running && <DeviceScreen surface={model.surface} lines={sim.screen?.lines ?? []} options={sim.screen?.options} placeholder="Waiting for a message" onTap={sim.tap} className="min-h-24" />}
      <div className={b.between}>
        <span className={cx(b.small, b.num)}>
          {passed} of {model.capabilities.length} passed
        </span>
        <button type="button" className={cx(b.btn, b.sm)} onClick={runAll}>
          Run all
        </button>
      </div>
      <ul className={b.box}>
        {model.capabilities.map((c) => {
          const tier = CAPABILITY_RISK_TIER[c];
          return (
            <li key={c} className={flow.testRow}>
              <span className={cx(b.badge, tier === "T4" ? b.badgeWarn : b.badgeRing)} title={TIER_LABEL[tier]}>
                {tier}
              </span>
              <span className={cx(flow.mono, b.grow)}>{c}</span>
              {results[c] === "passed" ? (
                <span className={cx(b.badge, b.badgeOk)}>
                  <Check {...ICON_100_SM} aria-hidden="true" />
                  Passed
                </span>
              ) : results[c] === "running" ? (
                <span className={b.badge}>Running</span>
              ) : (
                <button type="button" className={cx(b.btn, b.sm)} onClick={() => run(c)}>
                  Run
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ReviewStep({ category, model, integration, testDevice, passed }: { category: Category; model: Model; integration: Integration; testDevice: string; passed: number }) {
  const missing = model.capabilities.length - passed;
  return (
    <div className={b.stack}>
      <div className={b.row}>
        <Mark>
          <CategoryGlyph id={category.id} size={ICON_100} />
        </Mark>
        <span className={b.tight}>
          <span className={b.h3}>{model.name}</span>
          <span className={b.smallMuted}>{integration.name}</span>
        </span>
      </div>
      <div className={cx(b.well, flow.tiles2, flow.reviewWell)}>
        <span className={b.tight}>
          <span className={b.smallMuted}>Test device</span>
          <span className={b.strong}>{testDevice}</span>
        </span>
        <span className={b.tight}>
          <span className={b.smallMuted}>Tests passed</span>
          <span className={cx(b.strong, b.num)}>
            {passed} of {model.capabilities.length}
          </span>
        </span>
      </div>
      {missing > 0 && (
        <p className={cx(b.small, flow.warning)}>
          <CircleAlert {...ICON_100_SM} aria-hidden="true" />
          {missing} tests have not passed
        </p>
      )}
    </div>
  );
}
