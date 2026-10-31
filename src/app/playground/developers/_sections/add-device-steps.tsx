"use client";

/** The add-device popup's pages. Each is one decision; the shell owns state, progress and footer. */
import { useEffect, useRef } from "react";
import { Check, CircleAlert, MonitorPlay, QrCode } from "lucide-react";
import { CAPABILITY_RISK_TIER, type CapabilityId } from "@dopl/device-contracts";
import { Badge, Button, ICON, ICON_SM, TwoLine } from "../_design/ui";
import { CodeCells } from "../_design/ui-extras";
import { Between, BoxList, BoxListRow, Grow, Mark, PairWell, QrPattern, ReviewWell, Row, Stack, Text, Tile, Tiles, WarnNote } from "../_design/ui-page";
import { TIER_LABEL, functionsOf, type Category, type Integration, type Model } from "../_data/catalog";
import { CategoryGlyph } from "../_components/category-glyph";
import { DeviceScreen, SimulatorControls, type SimMessage, type SimulatorSession } from "../_components/device-simulator";

export type TestMethod = "simulator" | "hardware";
export type TestState = "running" | "passed";
export type Results = Partial<Record<CapabilityId, TestState>>;

export function CategoryStep({ categories, availableCount, value, onPick }: { categories: readonly Category[]; availableCount: (c: Category) => number; value: string | null; onPick: (c: Category) => void }) {
  return (
    <Tiles cols={3}>
      {categories.map((c) => {
        const count = availableCount(c);
        return (
          <Tile key={c.id} selected={value === c.id} disabled={count === 0} onClick={() => onPick(c)}>
            <Mark>
              <CategoryGlyph id={c.id} size={ICON} />
            </Mark>
            <TwoLine title={c.name} sub={count === 0 ? "None available" : `${count} available`} />
          </Tile>
        );
      })}
    </Tiles>
  );
}

export function ModelStep({ category, options, value, onPick }: { category: Category; options: { model: Model; integration: Integration }[]; value: string | null; onPick: (id: string) => void }) {
  return (
    <Tiles>
      {options.map(({ model, integration }) => (
        <Tile key={model.id} selected={value === model.id} onClick={() => onPick(model.id)}>
          <Row>
            <Mark>
              <CategoryGlyph id={category.id} size={ICON} />
            </Mark>
            <TwoLine title={model.name} sub={integration.name} />
          </Row>
          <Row wrap>
            {functionsOf(model)
              .slice(0, 3)
              .map((f) => (
                <Badge key={f} tone="ring">
                  {f}
                </Badge>
              ))}
            {integration.comingSoon && <Badge>Coming soon</Badge>}
          </Row>
        </Tile>
      ))}
    </Tiles>
  );
}

export function MethodStep({ value, onPick }: { value: TestMethod | null; onPick: (m: TestMethod) => void }) {
  const tile = (method: TestMethod, icon: typeof QrCode, title: string, sub: string) => (
    <Tile selected={value === method} onClick={() => onPick(method)}>
      <Mark icon={icon} />
      <TwoLine title={title} sub={sub} />
    </Tile>
  );
  return (
    <Tiles>
      {tile("simulator", MonitorPlay, "Simulator", "No hardware")}
      {tile("hardware", QrCode, "Real hardware", "Scan to pair")}
    </Tiles>
  );
}

export function ConnectStep({ method, model, sim, connected, onConnect }: { method: TestMethod; model: Model; sim: SimulatorSession; connected: boolean; onConnect: () => void }) {
  if (method === "hardware") {
    return (
      <PairWell>
        <QrPattern seed={model.id} />
        <Stack>
          <span>
            {connected ? (
              <Badge tone="ok" dot>
                Online
              </Badge>
            ) : (
              <Badge tone="ring">Not connected</Badge>
            )}
          </span>
          <CodeCells value="K7Q294" />
          <span>
            <Button variant={connected ? "secondary" : "ink"} onClick={onConnect}>
              {connected ? "Paired" : "Confirm pairing"}
            </Button>
          </span>
        </Stack>
      </PairWell>
    );
  }
  return (
    <Stack>
      <DeviceScreen surface={model.surface} lines={sim.screen?.lines ?? []} options={sim.screen?.options} placeholder={sim.running ? "Waiting for a message" : `Simulated ${model.name}`} onTap={sim.tap} />
      <SimulatorControls session={sim} model={model} />
    </Stack>
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
    <Stack>
      {sim.running && <DeviceScreen surface={model.surface} lines={sim.screen?.lines ?? []} options={sim.screen?.options} placeholder="Waiting for a message" onTap={sim.tap} className="min-h-24" />}
      <Between>
        <Text kind="small" num>
          {passed} of {model.capabilities.length} passed
        </Text>
        <Button size="sm" onClick={runAll}>
          Run all
        </Button>
      </Between>
      <BoxList>
        {model.capabilities.map((c) => {
          const tier = CAPABILITY_RISK_TIER[c];
          return (
            <BoxListRow key={c}>
              <Badge tone={tier === "T4" ? "warn" : "ring"} title={TIER_LABEL[tier]}>
                {tier}
              </Badge>
              <Text kind="mono" clip>
                {c}
              </Text>
              <Grow />
              {results[c] === "passed" ? (
                <Badge tone="ok">
                  <Check {...ICON_SM} aria-hidden="true" />
                  Passed
                </Badge>
              ) : results[c] === "running" ? (
                <Badge>Running</Badge>
              ) : (
                <Button size="sm" onClick={() => run(c)}>
                  Run
                </Button>
              )}
            </BoxListRow>
          );
        })}
      </BoxList>
    </Stack>
  );
}

export function ReviewStep({ category, model, integration, testDevice, passed }: { category: Category; model: Model; integration: Integration; testDevice: string; passed: number }) {
  const missing = model.capabilities.length - passed;
  return (
    <Stack>
      <Row>
        <Mark>
          <CategoryGlyph id={category.id} size={ICON} />
        </Mark>
        <TwoLine title={<Text kind="h3">{model.name}</Text>} sub={integration.name} />
      </Row>
      <ReviewWell
        items={[
          ["Test device", testDevice],
          ["Tests passed", `${passed} of ${model.capabilities.length}`],
        ]}
      />
      {missing > 0 && (
        <WarnNote>
          <CircleAlert {...ICON_SM} aria-hidden="true" />
          {missing} tests have not passed
        </WarnNote>
      )}
    </Stack>
  );
}
