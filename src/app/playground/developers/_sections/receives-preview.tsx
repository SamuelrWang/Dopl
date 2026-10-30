"use client";

/**
 * The sticky preview: a sample message rendered on this model as the draft rules would deliver it.
 * It only cuts and routes, as the runtime does; the words are the agent's.
 */
import { CircleAlert, Play, Send, Square } from "lucide-react";
import { useSimulatorSession } from "../_components/device-simulator";
import { G2Screen } from "../_design/g2-screen";
import { Badge, Button, Card, ICON_SM, PillMenu, TwoLine, type Tone } from "../_design/ui";
import { Limit } from "../_design/ui-data";
import { LensScreen, PanelScreen, Stage } from "../_design/ui-output";
import { Alert, Between, CodeBlock, Grow, ListRow, Row, Stack, Text } from "../_design/ui-page";
import { modelById } from "../_data/catalog";
import { SAMPLE_MESSAGES, resolveField, wrapLines, type FieldKey } from "../_data/receives";
import type { ReceivesEditor } from "./receives";

export function renderPreview(editor: Pick<ReceivesEditor, "modelId" | "state" | "segment" | "sample">) {
  const { modelId, state, segment, sample } = editor;
  const model = modelById(modelId);
  const get = (key: FieldKey) => resolveField(modelId, state.draft, segment, key).value;
  const message = SAMPLE_MESSAGES.find((m) => m.value === sample)!;
  const template = String(get("inbound_template"));
  const full = template.replaceAll("{{title}}", message.title).replaceAll("{{body}}", message.body);
  const maxChars = Number(get("max_chars"));
  const maxLines = Number(get("max_lines"));
  const clipped = full.length > maxChars ? full.slice(0, maxChars).trimEnd() : full;
  const all = wrapLines(full, model.floor.lineWidth);
  const fitting = wrapLines(clipped, model.floor.lineWidth);
  const shown = fitting.slice(0, maxLines);
  const overflow = full.length > maxChars || all.length > shown.length;
  const mode = String(get("overflow"));
  if (overflow && mode === "truncate" && shown.length) shown[shown.length - 1] = `${shown[shown.length - 1].replace(/[.,;:]?$/, "")}...`;
  const intents = get("allowed_intents") as string[];
  const isAsk = message.options.length > 0;
  const refused = isAsk && !intents.includes("ask");
  const options = refused ? [] : message.options.slice(0, Number(get("ask_options")));
  const sendTo = String(get("overflow_send_to"));
  const callback = String(get("overflow_callback"));
  const overflowPayload = !overflow ? null : mode === "send_to" ? { send_to: sendTo } : mode === "callback" ? { callback } : "truncate";
  const payload = {
    model: model.name,
    capability: isAsk ? "ask.choice" : "present.notify",
    format: get("format"),
    lines: shown,
    ...(options.length ? { options, timeout_s: get("timeout_s") } : {}),
    ...(overflowPayload ? { overflow: overflowPayload } : {}),
    fallback: get("fallback"),
  };
  return { model, shown, total: all.length, maxLines, overflow, mode, options, refused, payload, sendTo, title: message.title, instructions: String(get("agent_instructions")) };
}

const CALL_TONE: Record<string, Tone> = { refused: "error", seen: "ok", answered: "ok", received: "ok" };

function Screen({ surface, modelId, lines, options, onTap }: { surface: string; modelId: string; lines: string[]; options: string[]; onTap?: (option: string) => void }) {
  const replies = options.map((o) => (
    <Button key={o} size="sm" onClick={() => onTap?.(o)}>
      {o}
    </Button>
  ));
  if (modelId === "g2") {
    return (
      <>
        <G2Screen lines={[...lines, ...options.map((o, i) => `${i === 0 ? ">" : " "} ${o}`)]} />
        {onTap && replies.length > 0 && <Row>{replies}</Row>}
      </>
    );
  }
  if (surface === "lens") return <LensScreen lines={lines}>{replies.length > 0 ? replies : null}</LensScreen>;
  return <PanelScreen app="Larkfield Assist" lines={lines}>{replies.length > 0 ? replies : null}</PanelScreen>;
}

export function ReceivesPreview({ editor }: { editor: ReceivesEditor }) {
  const r = renderPreview(editor);
  const fits = r.shown.length;
  const sim = useSimulatorSession();
  const sendTest = () => sim.send({ capability: r.payload.capability, lines: r.shown, options: r.options, refused: r.refused });
  const sample = SAMPLE_MESSAGES.find((m) => m.value === editor.sample)!;
  return (
    <>
      <Card>
        <Between>
          <Text kind="h3">Live preview</Text>
          <PillMenu stable label={sample.label} value={editor.sample} options={SAMPLE_MESSAGES.map((m) => ({ value: m.value, label: m.label }))} onChange={(v) => editor.setSample(v as ReceivesEditor["sample"])} />
        </Between>
        <Stage>
          {sim.running ? (
            <Screen surface={r.model.surface} modelId={r.model.id} lines={sim.screen?.lines ?? ["Waiting for a message"]} options={sim.screen?.options ?? []} onTap={sim.tap} />
          ) : r.refused ? (
            <Alert tone="error" icon={CircleAlert}>
              Refused, ask is not an allowed intent
            </Alert>
          ) : (
            <Screen surface={r.model.surface} modelId={r.model.id} lines={r.shown} options={r.options} />
          )}
        </Stage>
        <Between>
          <Badge tone={sim.running ? "ok" : "neutral"} dot>
            {sim.running ? "Simulator on" : "Simulator off"}
          </Badge>
          <Row>
            {sim.running ? (
              <>
                {r.model.capabilities.includes("input.utterance") && (
                  <Button size="sm" onClick={sim.voice}>
                    Voice
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={sim.stop}>
                  <Square {...ICON_SM} aria-hidden="true" />
                  Stop
                </Button>
                <Button size="sm" variant="ink" onClick={sendTest}>
                  <Send {...ICON_SM} aria-hidden="true" />
                  Send test
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={sim.start}>
                <Play {...ICON_SM} aria-hidden="true" />
                Start simulator
              </Button>
            )}
          </Row>
        </Between>
        {sim.calls.length > 0 && (
          <div>
            {sim.calls.map((c, i) => (
              <ListRow key={c.id} line={i < sim.calls.length - 1}>
                <TwoLine strong={false} title={c.capability} sub={c.detail ? `${c.at}, ${c.detail}` : c.at} />
                <Grow />
                <Badge tone={CALL_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
              </ListRow>
            ))}
          </div>
        )}
        <Limit goal label={`Fits ${fits} of ${r.total} lines`} used={fits} limit={Math.max(r.maxLines, r.total, 1)} />
        {r.overflow && (
          <Text kind="smallMuted">
            {r.mode === "truncate" && "The rest is cut."}
            {r.mode === "send_to" && `The full text goes to ${modelById(r.sendTo as never)?.name ?? r.sendTo}.`}
            {r.mode === "callback" && "Your agent is called back with the full text."}
          </Text>
        )}
      </Card>
      <Card>
        <Stack>
          <Text kind="strong" as="h3">
            Passed to your agent
          </Text>
          <Text kind="muted">{r.instructions}</Text>
        </Stack>
        <CodeBlock title="Final payload">{JSON.stringify(r.payload, null, 2)}</CodeBlock>
      </Card>
    </>
  );
}
