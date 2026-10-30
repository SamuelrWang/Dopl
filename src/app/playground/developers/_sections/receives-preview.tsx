"use client";

/**
 * The sticky preview: a sample message rendered on this model as the draft rules would deliver it.
 * It only cuts and routes, as the runtime does; the words are the agent's.
 */
import { cn } from "@/shared/lib/utils";
import { SelectMenu } from "@/shared/ui/select-menu";
import { SECTION_TITLE } from "@/shared/ui/section-title";
import { StatusPill } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { pillButton } from "@/shared/ui/pill-button";
import { DeviceScreen, SimulatorCalls, SimulatorControls, useSimulatorSession } from "../_components/device-simulator";
import { modelById } from "../_data/catalog";
import { SAMPLE_MESSAGES, resolveField, wrapLines, type FieldKey } from "../_data/receives";
import { ov } from "../_components/ui";
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

export function ReceivesPreview({ editor }: { editor: ReceivesEditor }) {
  const r = renderPreview(editor);
  const fits = r.shown.length;
  const sim = useSimulatorSession();
  const sendTest = () => sim.send({ capability: r.payload.capability, lines: r.shown, options: r.options, refused: r.refused });
  return (
    <div className="flex min-w-0 flex-col gap-3 p-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className={SECTION_TITLE}>Live preview</h2>
        <SelectMenu
          variant="outline"
          ariaLabel="Sample message"
          value={editor.sample}
          options={SAMPLE_MESSAGES.map((m) => ({ value: m.value, label: m.label }))}
          onChange={editor.setSample}
        />
      </div>
      {sim.running ? (
        <DeviceScreen surface={r.model.surface} lines={sim.screen?.lines ?? []} options={sim.screen?.options} placeholder="Waiting for a message" onTap={sim.tap} />
      ) : r.refused ? (
        <div className="card-well flex items-center justify-center px-3 py-8">
          <StatusPill tone="attention">Refused, ask is not an allowed intent</StatusPill>
        </div>
      ) : (
        <DeviceScreen surface={r.model.surface} lines={r.shown} options={r.options} />
      )}
      <SimulatorControls session={sim} model={r.model}>
        <button type="button" className={pillButton("ink", "sm", { raise: false })} onClick={sendTest}>
          Send test
        </button>
      </SimulatorControls>
      <SimulatorCalls calls={sim.calls} />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className={cn("text-caption font-medium", r.overflow ? "text-warning" : "text-text-primary")}>
            Fits {fits} of {r.total} lines
          </span>
          <span className={ov.rowMeta}>Limit {r.maxLines}</span>
        </div>
        <ThinMeter used={fits} limit={Math.max(r.total, 1)} />
        {r.overflow && (
          <span className="text-caption text-text-muted">
            {r.mode === "truncate" && "The rest is cut."}
            {r.mode === "send_to" && `The full text goes to ${modelById(r.sendTo as never)?.name ?? r.sendTo}.`}
            {r.mode === "callback" && "Your agent is called back with the full text."}
          </span>
        )}
      </div>
      <section className="flex flex-col gap-1.5">
        <h3 className={SECTION_TITLE}>Passed to your agent</h3>
        <p className="card-well px-3 py-2.5 text-caption text-text-secondary">{r.instructions}</p>
      </section>
      <section className="flex flex-col gap-1.5">
        <h3 className={SECTION_TITLE}>Final payload</h3>
        <pre className="card-well overflow-x-auto px-3 py-2.5 font-mono text-caption leading-relaxed text-text-secondary">{JSON.stringify(r.payload, null, 2)}</pre>
      </section>
    </div>
  );
}
