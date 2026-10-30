"use client";

/**
 * Playground: pick a device and what it should do, see what happens on it. The output is drawn from
 * the capability, not the device, so anything with no screen still shows a result. The simulator and
 * the real device are the same call; here both are computed locally and nothing is sent.
 */
import { Check, CircleAlert, Copy, Play, Radio, RotateCcw, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CapabilityId } from "@dopl/device-contracts";
import { Badge, Button, Chip, ICON, PillMenu, Segmented, TwoLine, type Tone } from "../_design/ui";
import { Alert, Between, CodeBlock, ConfirmDialog, FilterRow, Grow, ListRow, Mark, Page, PageHeader, Stack, Text, TextArea, TextField, WarnNote } from "../_design/ui-page";
import { CaptureOutput, ChangeOutput, CodeEditor, DetailsPane, FillBody, FillCard, HapticOutput, LensScreen, PanelScreen, ReadOutput, SpeakerOutput, SplitLayout, Stage } from "../_design/ui-output";
import { CATEGORIES, ALL_MODELS, categoryOf, modelById, type CategoryId, type Model, type ModelId } from "../_data/catalog";
import { wrapLines } from "../_data/receives";
import { usePortal, useUsers } from "../_components/portal-store";
import { HAPTICS, answersOf, changeOf, choicesOf, defaultText, eventsOf, familyOf, labelOf, needsConfirm, needsText, readRows, requestOf, responseOf, sendable, snippetOf, textLabel, type Phase } from "./playground-model";
import { runSnippet } from "./playground-run";

const PHASE: Record<Phase, [string, Tone]> = { idle: ["Not sent", "neutral"], queued: ["Queued", "neutral"], delivered: ["Sent", "neutral"], seen: ["Seen by device", "ok"], answered: ["Answered", "ok"], refused: ["Refused", "error"] };
const TABS = ["Snippet", "Request", "Response", "Events"];
const MODES = ["Form", "Code"];

/** What is on the device now, from the form or from a run. */
interface Shown {
  capability: CapabilityId;
  text: string;
  lines?: string[];
  choice: string;
  answers: string[];
}
const TARGETS = ["Simulator", "Real device"];

function Output({ model, shown, phase, error, answer, onAnswer }: { model: Model; shown: Shown; phase: Phase; error: string | null; answer: string | null; onAnswer: (a: string) => void }) {
  const { capability, text, choice, answers } = shown;
  const family = familyOf(capability);
  if (phase === "idle" || phase === "queued") {
    return (
      <Stage>
        <Mark icon={Radio} />
        <TwoLine title={phase === "queued" ? "Sending" : `Simulated ${model.name}`} sub={labelOf(capability)} />
      </Stage>
    );
  }
  if (phase === "refused") {
    return (
      <Stage>
        <Alert tone="error" icon={CircleAlert}>
          {error ?? "Device offline. Nothing was delivered."}
        </Alert>
      </Stage>
    );
  }
  if (family === "speak") return <Stage><SpeakerOutput text={text} /></Stage>;
  if (family === "haptic") return <Stage><HapticOutput pattern={HAPTICS[choice] ?? HAPTICS.Tap} /></Stage>;
  if (family === "act") return <Stage><ChangeOutput {...changeOf(capability, choice, text)} /></Stage>;
  if (family === "read") return <Stage><ReadOutput rows={readRows(capability, model)} /></Stage>;
  if (family === "capture") return <Stage><CaptureOutput /></Stage>;

  const all = shown.lines ?? wrapLines(text, model.floor.lineWidth);
  const lines = model.surface === "lens" ? all.slice(0, model.floor.maxLines) : all;
  const cut = all.length - lines.length;
  const replies = family === "ask" && !answer && capability !== "ask.text" ? answers.slice(0, model.floor.maxOptions).map((a) => <Button key={a} size="sm" onClick={() => onAnswer(a)}>{a}</Button>) : null;
  const reply = answer ? <Badge tone="ok">{answer}</Badge> : capability === "ask.text" ? <Button size="sm" onClick={() => onAnswer("Text reply")}>Reply as user</Button> : replies;
  return (
    <Stage>
      {model.surface === "lens" ? <LensScreen lines={lines}>{reply}</LensScreen> : <PanelScreen app="Larkfield Assist" lines={lines}>{reply}</PanelScreen>}
      {cut > 0 && (
        <WarnNote>
          <CircleAlert {...ICON} aria-hidden="true" />
          {cut} lines cut, this device shows {model.floor.maxLines}
        </WarnNote>
      )}
    </Stage>
  );
}

export function PlaygroundSection({ initialModel }: { initialModel?: string }) {
  const { state } = usePortal();
  const users = useUsers();
  const [modelId, setModelId] = useState<ModelId>(ALL_MODELS.find((m) => m.id === initialModel)?.id ?? "g2");
  const model = modelById(modelId);
  const capabilities = sendable(model);
  const [capability, setCapability] = useState(capabilities.find((c) => c === "present.display") ?? capabilities[0]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [options, setOptions] = useState("Yes, No");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [mode, setMode] = useState(0);
  const [edited, setEdited] = useState<string | null>(null);
  const [ran, setRan] = useState<Shown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setAnswer(null);
    setRan(null);
    setError(null);
    setLogs([]);
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const owned = useMemo(() => users.flatMap((u) => u.devices).filter((d) => d.modelId === modelId && !d.simulated), [users, modelId]);
  const device = owned.find((d) => d.id === deviceId) ?? owned[0] ?? null;
  const real = target === 1;
  const text = texts[capability] ?? defaultText(capability);
  const pickable = choicesOf(capability);
  const choice = choices[capability] ?? pickable[0] ?? "";
  const answers = answersOf(capability, options);
  const callDevice = real && device ? device.id : `dev_sim_${modelId}`;
  const category = categoryOf(modelId);
  const inCategory = ALL_MODELS.filter((m) => categoryOf(m.id).id === category.id);
  const generated = snippetOf(capability, callDevice, text, choice, answers);
  const code = edited ?? generated;
  const shown: Shown = ran ?? { capability, text, choice, answers };
  const snippet = mode === 1 ? code : snippetOf(shown.capability, callDevice, shown.text, shown.choice, shown.answers);

  const pickModel = (id: ModelId) => {
    const list = sendable(modelById(id));
    setModelId(id);
    setCapability(list.includes(capability) ? capability : (list.find((c) => c === "present.display") ?? list[0]));
    setDeviceId(null);
    setTarget(0);
    setEdited(null);
    clear();
  };
  const play = () => {
    setPhase("queued");
    timers.current.push(setTimeout(() => setPhase("delivered"), 300), setTimeout(() => setPhase((p) => (p === "delivered" ? "seen" : p)), 800));
  };
  const run = () => {
    clear();
    if (real && device?.state !== "online") return setPhase("refused");
    play();
  };
  const send = () => (real && needsConfirm(capability) ? setConfirming(true) : run());
  const runCode = async () => {
    clear();
    const result = await runSnippet(code);
    setLogs(result.logs);
    const refuse = (message: string) => {
      setError(message);
      setPhase("refused");
    };
    if (result.error) return refuse(result.error);
    const last = result.calls.at(-1);
    if (!last) return refuse("The code made no call to dopl");
    if (!capabilities.includes(last.capability as CapabilityId)) return refuse(`${model.name} does not support ${last.capability}`);
    if (real && device?.state !== "online") return setPhase("refused");
    const c = last.capability as CapabilityId;
    setRan({ capability: c, text: last.text ?? last.lines?.join(" ") ?? "", lines: last.lines, choice: last.value ?? choicesOf(c)[0] ?? "", answers: last.options ?? answersOf(c, options) });
    play();
  };
  const canSend = (!needsText(capability) || text.trim() !== "") && (!real || device !== null);
  const tag = PHASE[phase];
  const events = eventsOf(phase, answer);

  return (
    <Page
      fit
      overlays={
        confirming && (
          <ConfirmDialog
            label={`Send ${labelOf(capability)}`}
            mark={<Mark icon={CircleAlert} tone="danger" />}
            title={`${labelOf(capability)} on a real device?`}
            sub={device?.name ?? model.name}
            onCancel={() => setConfirming(false)}
            action={
              <Button full variant="dangerFlat" onClick={() => { setConfirming(false); run(); }}>
                Send
              </Button>
            }
          />
        )
      }
    >
      <PageHeader title="Playground" test={state.env === "test"} />
      <SplitLayout
        left={
          <FillCard>
            <Between>
              <FilterRow>
                <PillMenu
                  label={category.name}
                  value={category.id}
                  options={CATEGORIES.map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(id) => {
                    const first = ALL_MODELS.find((m) => categoryOf(m.id).id === (id as CategoryId));
                    if (first) pickModel(first.id);
                  }}
                />
                <PillMenu label={model.name} value={modelId} options={inCategory.map((m) => ({ value: m.id, label: m.name }))} onChange={(id) => pickModel(id as ModelId)} />
              </FilterRow>
              <Segmented label="Build with" options={MODES} value={mode} onChange={setMode} />
            </Between>
            {mode === 0 ? (
              <>
                <FillBody>
                  <Stack>
                    <Text kind="strong">Do</Text>
                    <FilterRow>
                      {capabilities.map((c) => (
                        <Chip key={c} on={capability === c} pressed={capability === c} onClick={() => { setCapability(c); setEdited(null); clear(); }}>
                          {labelOf(c)}
                        </Chip>
                      ))}
                    </FilterRow>
                  </Stack>
                  {needsText(capability) && (
                    <Stack>
                      <Text kind="strong">{textLabel(capability)}</Text>
                      {capability === "act.navigate" ? (
                        <TextField label={textLabel(capability)} value={text} onChange={(v) => setTexts((t) => ({ ...t, [capability]: v }))} />
                      ) : (
                        <TextArea label={textLabel(capability)} value={text} onChange={(v) => setTexts((t) => ({ ...t, [capability]: v }))} />
                      )}
                    </Stack>
                  )}
                  {capability === "ask.choice" && (
                    <Stack>
                      <Text kind="strong">Answers</Text>
                      <TextField label="Answers" value={options} onChange={setOptions} />
                    </Stack>
                  )}
                  {pickable.length > 0 && (
                    <Stack>
                      <Text kind="strong">Value</Text>
                      <FilterRow>
                        {pickable.map((p) => (
                          <Chip key={p} on={choice === p} pressed={choice === p} onClick={() => setChoices((c) => ({ ...c, [capability]: p }))}>
                            {p}
                          </Chip>
                        ))}
                      </FilterRow>
                    </Stack>
                  )}
                </FillBody>
                <Button block variant="ink" disabled={!canSend} onClick={send}>
                  <Send {...ICON} aria-hidden="true" />
                  {familyOf(capability) === "read" || familyOf(capability) === "capture" ? "Read" : "Send"}
                </Button>
              </>
            ) : (
              <>
                <CodeEditor label="Code" value={code} onChange={setEdited} />
                <FilterRow>
                  {edited !== null && (
                    <Button variant="ghost" onClick={() => setEdited(null)}>
                      <RotateCcw {...ICON} aria-hidden="true" />
                      Reset
                    </Button>
                  )}
                  <Grow />
                  <Button variant="ink" onClick={() => void runCode()}>
                    <Play {...ICON} aria-hidden="true" />
                    Run
                  </Button>
                </FilterRow>
              </>
            )}
          </FillCard>
        }
        right={
          <FillCard>
            <Between>
              <FilterRow>
                <Segmented label="Send to" options={TARGETS} value={target} onChange={(i) => { setTarget(i); setEdited(null); clear(); }} />
                {real && owned.length === 0 && <Text kind="muted">No paired {model.name}</Text>}
                {real && owned.length > 0 && <PillMenu label={device?.name ?? "Device"} value={device?.id ?? ""} options={owned.slice(0, 12).map((d) => ({ value: d.id, label: d.name }))} onChange={(id) => { setDeviceId(id); setEdited(null); clear(); }} />}
                {real && device && <Badge tone={device.state === "online" ? "ok" : "warn"}>{device.state === "online" ? "Online" : "Offline"}</Badge>}
              </FilterRow>
              <Badge tone={tag[1]} dot={phase === "seen" || phase === "answered"}>
                {tag[0]}
              </Badge>
            </Between>
            <Output model={model} shown={shown} phase={phase} error={error} answer={answer} onAnswer={(a) => { setAnswer(a); setPhase("answered"); }} />
            <Between>
              <Segmented label="Details" options={TABS} value={tab} onChange={setTab} />
              {tab === 0 && (
                <Button
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(snippet);
                    setCopied(true);
                    timers.current.push(setTimeout(() => setCopied(false), 1500));
                  }}
                >
                  {copied ? <Check {...ICON} aria-hidden="true" /> : <Copy {...ICON} aria-hidden="true" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </Between>
            <DetailsPane>
              {tab === 0 && <CodeBlock title="JavaScript">{snippet}</CodeBlock>}
              {tab === 1 && <CodeBlock title="HTTP">{requestOf(shown.capability, callDevice, shown.text, shown.choice, shown.answers, shown.lines)}</CodeBlock>}
              {tab === 2 && (phase === "idle" ? <Text kind="muted">Nothing sent yet</Text> : <CodeBlock title="Response">{responseOf(shown.capability, callDevice, phase, model)}</CodeBlock>)}
              {tab === 3 &&
                (events.length === 0 && logs.length === 0 ? (
                  <Text kind="muted">Nothing sent yet</Text>
                ) : (
                  <div>
                    {events.map(([name, detail], i) => (
                      <ListRow key={name} line={i < events.length - 1 || logs.length > 0}>
                        <Text kind="mono" clip>
                          {name}
                        </Text>
                        <Grow />
                        <Text kind="smallMuted" nowrap>
                          {detail}
                        </Text>
                      </ListRow>
                    ))}
                    {logs.map((log, i) => (
                      <ListRow key={i} line={i < logs.length - 1}>
                        <Text kind="mono" clip>
                          {log}
                        </Text>
                        <Grow />
                        <Text kind="smallMuted">console</Text>
                      </ListRow>
                    ))}
                  </div>
                ))}
            </DetailsPane>
          </FillCard>
        }
      />
    </Page>
  );
}
