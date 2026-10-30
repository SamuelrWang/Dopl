"use client";

/**
 * Playground: pick a device and what it should do, see what happens on it. The output is drawn from
 * the capability, not the device, so anything with no screen still shows a result. The simulator and
 * the real device are the same call; here both are computed locally and nothing is sent.
 */
import { CircleAlert, Radio, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button, Card, Chip, ICON, PillMenu, Segmented, TwoLine, type Tone } from "../_design/ui";
import { Alert, Between, CodeBlock, ConfirmDialog, FilterRow, Grow, ListRow, Mark, Page, PageHeader, Stack, Text, TextArea, TextField, WarnNote } from "../_design/ui-page";
import { CaptureOutput, ChangeOutput, HapticOutput, LensScreen, PanelScreen, ReadOutput, SpeakerOutput, SplitLayout, Stage } from "../_design/ui-output";
import { CATEGORIES, ALL_MODELS, categoryOf, modelById, type Model, type ModelId } from "../_data/catalog";
import { wrapLines } from "../_data/receives";
import { usePortal, useUsers } from "../_components/portal-store";
import { HAPTICS, answersOf, changeOf, choicesOf, defaultText, eventsOf, familyOf, labelOf, needsConfirm, needsText, readRows, requestOf, responseOf, sendable, textLabel, type Phase } from "./playground-model";

const PHASE: Record<Phase, [string, Tone]> = { idle: ["Not sent", "neutral"], queued: ["Queued", "neutral"], delivered: ["Sent", "neutral"], seen: ["Seen by device", "ok"], answered: ["Answered", "ok"], refused: ["Refused", "error"] };
const TABS = ["Request", "Response", "Events"];
const TARGETS = ["Simulator", "Real device"];

function Output({ model, capability, phase, text, choice, answers, answer, onAnswer }: { model: Model; capability: Model["capabilities"][number]; phase: Phase; text: string; choice: string; answers: string[]; answer: string | null; onAnswer: (a: string) => void }) {
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
          Device offline. Nothing was delivered.
        </Alert>
      </Stage>
    );
  }
  if (family === "speak") return <Stage><SpeakerOutput text={text} /></Stage>;
  if (family === "haptic") return <Stage><HapticOutput pattern={HAPTICS[choice] ?? HAPTICS.Tap} /></Stage>;
  if (family === "act") return <Stage><ChangeOutput {...changeOf(capability, choice, text)} /></Stage>;
  if (family === "read") return <Stage><ReadOutput rows={readRows(capability, model)} /></Stage>;
  if (family === "capture") return <Stage><CaptureOutput /></Stage>;

  const all = wrapLines(text, model.floor.lineWidth);
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
  const [categoryId, setCategoryId] = useState(categoryOf(modelId).id);
  const capabilities = sendable(model);
  const [capability, setCapability] = useState(capabilities.find((c) => c === "present.display") ?? capabilities[0]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [options, setOptions] = useState("Yes, No");
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [target, setTarget] = useState(0);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [answer, setAnswer] = useState<string | null>(null);
  const [tab, setTab] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase("idle");
    setAnswer(null);
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
  const inCategory = ALL_MODELS.filter((m) => categoryOf(m.id).id === categoryId);

  const pickModel = (id: ModelId) => {
    const next = modelById(id);
    const list = sendable(next);
    setModelId(id);
    setCapability(list.includes(capability) ? capability : (list.find((c) => c === "present.display") ?? list[0]));
    setDeviceId(null);
    setTarget(0);
    clear();
  };
  const run = () => {
    clear();
    if (real && device?.state !== "online") return setPhase("refused");
    setPhase("queued");
    timers.current.push(setTimeout(() => setPhase("delivered"), 300), setTimeout(() => setPhase((p) => (p === "delivered" ? "seen" : p)), 800));
  };
  const send = () => (real && needsConfirm(capability) ? setConfirming(true) : run());
  const canSend = (!needsText(capability) || text.trim() !== "") && (!real || device !== null);
  const tag = PHASE[phase];
  const events = eventsOf(phase, answer);

  return (
    <Page
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
          <Card>
            <Stack>
              <Text kind="strong">Device</Text>
              <FilterRow>
                {CATEGORIES.map((c) => (
                  <Chip key={c.id} on={categoryId === c.id} pressed={categoryId === c.id} onClick={() => { setCategoryId(c.id); const first = ALL_MODELS.find((m) => categoryOf(m.id).id === c.id); if (first) pickModel(first.id); }}>
                    {c.name}
                  </Chip>
                ))}
              </FilterRow>
              {inCategory.length > 1 && (
                <FilterRow>
                  {inCategory.map((m) => (
                    <Chip key={m.id} ring={modelId !== m.id} on={modelId === m.id} pressed={modelId === m.id} onClick={() => pickModel(m.id)}>
                      {m.name}
                    </Chip>
                  ))}
                </FilterRow>
              )}
            </Stack>
            <Stack>
              <Text kind="strong">Do</Text>
              <FilterRow>
                {capabilities.map((c) => (
                  <Chip key={c} on={capability === c} pressed={capability === c} onClick={() => { setCapability(c); clear(); }}>
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
            <Button block variant="ink" disabled={!canSend} onClick={send}>
              <Send {...ICON} aria-hidden="true" />
              {familyOf(capability) === "read" || familyOf(capability) === "capture" ? "Read" : "Send"}
            </Button>
          </Card>
        }
        right={
          <Card>
            <Between>
              <Segmented label="Send to" options={TARGETS} value={target} onChange={(i) => { setTarget(i); clear(); }} />
              <Badge tone={tag[1]} dot={phase === "seen" || phase === "answered"}>
                {tag[0]}
              </Badge>
            </Between>
            {real &&
              (owned.length === 0 ? (
                <Text kind="muted">No paired {model.name} in this project</Text>
              ) : (
                <FilterRow>
                  <PillMenu label={device?.name ?? "Device"} value={device?.id ?? ""} options={owned.slice(0, 12).map((d) => ({ value: d.id, label: d.name }))} onChange={(id) => { setDeviceId(id); clear(); }} />
                  {device && <Badge tone={device.state === "online" ? "ok" : "warn"}>{device.state === "online" ? "Online" : "Offline"}</Badge>}
                </FilterRow>
              ))}
            <Output model={model} capability={capability} phase={phase} text={text} choice={choice} answers={answers} answer={answer} onAnswer={(a) => { setAnswer(a); setPhase("answered"); }} />
            <Segmented label="Details" options={TABS} value={tab} onChange={setTab} />
            {tab === 0 && <CodeBlock title="Request">{requestOf(capability, callDevice, text, choice, answers)}</CodeBlock>}
            {tab === 1 && (phase === "idle" ? <Text kind="muted">Nothing sent yet</Text> : <CodeBlock title="Response">{responseOf(capability, callDevice, phase, model)}</CodeBlock>)}
            {tab === 2 &&
              (events.length === 0 ? (
                <Text kind="muted">Nothing sent yet</Text>
              ) : (
                <div>
                  {events.map(([name, detail], i) => (
                    <ListRow key={name} line={i < events.length - 1}>
                      <Text kind="mono" clip>
                        {name}
                      </Text>
                      <Grow />
                      <Text kind="smallMuted" nowrap>
                        {detail}
                      </Text>
                    </ListRow>
                  ))}
                </div>
              ))}
          </Card>
        }
      />
    </Page>
  );
}
