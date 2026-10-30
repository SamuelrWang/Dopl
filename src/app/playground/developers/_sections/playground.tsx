"use client";

/**
 * Playground: compose one delivery and see what routing would answer. The simulator is a test option
 * on each model here. Computed locally; nothing is sent.
 */
import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { ALL_MODELS, modelById, trail, type ModelId } from "../_data/catalog";
import { useUsers, usePortal } from "../_components/portal-store";
import { Card, Filter, ov, PortalPage } from "../_components/ui";

const INTENT = { message: "present.notify", notify: "present.notify", display: "present.display", ask: "ask.choice" } as const;
type Intent = keyof typeof INTENT;

export function PlaygroundSection({ initialModel }: { initialModel?: string }) {
  const { state } = usePortal();
  const users = useUsers();
  const added = ALL_MODELS.filter((m) => state.integrations[m.integrationId]);
  const [model, setModel] = useState<ModelId>(added.find((m) => m.id === initialModel)?.id ?? added[0]?.id ?? "g2");
  const [target, setTarget] = useState<"simulator" | string>("simulator");
  const [intent, setIntent] = useState<Intent>("notify");
  const [text, setText] = useState("Pump 4 at Site 12 is over pressure. Close valve B before restart.");
  const [sent, setSent] = useState<unknown>(null);
  const def = modelById(model);
  const owned = useMemo(() => users.flatMap((u) => u.devices).filter((d) => d.modelId === model && !d.simulated), [users, model]);
  const request = {
    target: target === "simulator" ? { simulator: model } : { device_id: target },
    intent,
    content: { text, ...(intent === "ask" ? { options: ["Yes", "No"] } : {}) },
  };
  const send = () => {
    const device = owned.find((d) => d.id === target);
    const offline = device && device.state !== "online";
    setSent(
      offline
        ? { error: { type: "device_error", code: "device_offline", retryable: true, device_kind: "glasses" } }
        : !def.intents.includes(intent)
          ? { error: { type: "invalid_request_error", code: "capability_unsupported", retryable: false } }
          : {
              id: "del_pg7310",
              status: "accepted",
              route: { target: request.target, chosen: device?.id ?? `dev_sim_${model}`, reason: device ? "Targeted by id" : "Simulator for this model" },
              capability: INTENT[intent],
              rules_version: 7,
            }
    );
  };
  return (
    <PortalPage title="Playground" meta={<span>{trail(model).join(" › ")}</span>}>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3.5">
        <Card title="Send a delivery">
          <div className="flex flex-wrap items-center gap-1.5">
            <Filter label="Model" value={model} options={added.map((m) => ({ value: m.id, label: m.name }))} onChange={(m) => { setModel(m); setTarget("simulator"); setSent(null); }} />
            <SelectMenu
              variant="outline"
              prefix="To"
              ariaLabel="Target"
              value={target}
              options={[{ value: "simulator", label: `Simulated ${def.name}` }, ...owned.slice(0, 6).map((d) => ({ value: d.id, label: d.name }))]}
              onChange={setTarget}
            />
            <Filter label="Intent" value={intent} options={(Object.keys(INTENT) as Intent[]).map((i) => ({ value: i, label: i }))} onChange={setIntent} />
          </div>
          <textarea aria-label="Message" rows={4} value={text} onChange={(e) => setText(e.target.value)} className={cn(RAISED_INPUT, "resize-none px-3 py-2")} />
          <div className="flex justify-end">
            <button type="button" className={pillButton("ink", "md")} onClick={send}>
              Send
            </button>
          </div>
        </Card>
        <Card title="Request">
          <pre className="card-well overflow-x-auto px-3 py-2.5 font-mono text-caption leading-relaxed text-text-secondary">{`POST /v1/deliver\n${JSON.stringify(request, null, 2)}`}</pre>
        </Card>
      </div>
      <Card title="Response" aside={sent ? <StatusPill>{(sent as { error?: unknown }).error ? "Refused" : "202 accepted"}</StatusPill> : undefined}>
        {sent ? (
          <pre className="card-well overflow-x-auto px-3 py-2.5 font-mono text-caption leading-relaxed text-text-secondary">{JSON.stringify(sent, null, 2)}</pre>
        ) : (
          <p className={ov.note}>Nothing sent yet.</p>
        )}
      </Card>
    </PortalPage>
  );
}
