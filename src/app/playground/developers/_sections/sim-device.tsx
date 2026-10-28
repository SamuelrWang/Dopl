"use client";

import { useState } from "react";
import type { CapabilityId, WebhookEventName } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { Switch } from "@/shared/ui/switch";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { deliverSim, editSim, publishSim, resetSim, sendSample, toggleSimScope } from "../_components/portal-actions";
import { ALL_WEBHOOK_EVENTS } from "../_components/portal-store";
import { Card, Facts, Json, ov } from "../_components/ui";
import { SCOPE_FAMILIES, SIM_CAPABILITIES, isDirty, type SimDelivery, type SimDevice, type SimState } from "../_data/simulator";

const SWITCHES: ReadonlyArray<{ key: Exclude<keyof SimState, "battery">; label: string }> = [
  { key: "online", label: "Online" },
  { key: "wearing", label: "Wearing" },
  { key: "display_busy", label: "Display busy" },
];

/** Smartcar's vehicle page: editable state with Publish, scope toggles, deliveries and sample payloads. */
export function SimDevicePanel({ device }: { device: SimDevice }) {
  const [last, setLast] = useState<SimDelivery | null>(null);
  const [sample, setSample] = useState<WebhookEventName>("device.online");
  const dirty = isDirty(device);

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <Card
        title={device.name}
        aside={
          <>
            {dirty ? <StatusPill tone="attention">Draft</StatusPill> : <StatusPill tone="live" dot bare>Published</StatusPill>}
            <button type="button" disabled={!dirty} className={cn(pillButton("quiet", "sm"), "disabled:opacity-60")} onClick={() => resetSim(device.id)}>
              Reset
            </button>
            <button type="button" disabled={!dirty} className={cn(pillButton("ink", "sm"), "disabled:opacity-60")} onClick={() => publishSim(device.id)}>
              Publish
            </button>
          </>
        }
      >
        <Facts
          facts={[
            ["Device id", device.id],
            ["User", device.external_user_id],
            ["Connection", device.connection_id],
          ]}
        />
        <ul className={ov.rows} aria-label="State">
          {SWITCHES.map((s) => (
            <li key={s.key} className={ov.row}>
              <span className={cn(ov.rowTitle, "flex-1")}>{s.label}</span>
              <Switch checked={device.state[s.key]} onChange={(v) => editSim(device.id, { [s.key]: v })} aria-label={s.label} />
            </li>
          ))}
          <li className={ov.row}>
            <span className={cn(ov.rowTitle, "flex-1")}>Battery</span>
            <input
              type="number"
              min={0}
              max={100}
              aria-label="Battery"
              value={device.state.battery}
              onChange={(e) => editSim(device.id, { battery: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
              className={cn(RAISED_INPUT, "h-7 w-20 px-2 text-right font-mono")}
            />
            <span className={ov.rowMeta}>%</span>
          </li>
        </ul>
      </Card>

      <Card title="Scopes" count={`${SCOPE_FAMILIES.filter((f) => device.scopes[f]).length} granted`}>
        <span className="flex flex-wrap gap-1.5">
          {SCOPE_FAMILIES.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={device.scopes[f]}
              onClick={() => toggleSimScope(device.id, f)}
              className={cn(pillButton(device.scopes[f] ? "ink" : "outline", "xs", { raise: false }), "font-mono")}
            >
              {f}.*
            </button>
          ))}
        </span>
      </Card>

      <Card title="Deliver">
        <span className="flex flex-wrap gap-1.5">
          {SIM_CAPABILITIES.map((c: CapabilityId) => (
            <button key={c} type="button" className={cn(pillButton("outline", "sm"), "font-mono")} onClick={() => setLast(deliverSim(device.id, c))}>
              {c}
            </button>
          ))}
        </span>
        {last && (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["Request", last.request],
                ["Response", last.response],
              ] as const
            ).map(([label, body]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1.5">
                <span className={ov.cellLabel}>{label}</span>
                <Json value={body} />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Sample payloads">
        <span className="flex items-center gap-2">
          <SelectMenu
            variant="outline"
            ariaLabel="Webhook event"
            value={sample}
            onChange={setSample}
            options={ALL_WEBHOOK_EVENTS.map((e) => ({ value: e, label: e }))}
          />
          <button type="button" className={pillButton("outline", "sm")} onClick={() => sendSample(sample, device.id)}>
            Send sample
          </button>
        </span>
      </Card>
    </div>
  );
}
