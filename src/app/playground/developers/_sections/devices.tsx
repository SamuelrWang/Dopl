"use client";

import { useState } from "react";
import type { Device } from "@dopl/contracts/device-sdk";
import { RISK_TIER_DEFAULT_POLICY } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { IDENTITY_NAME_TEXT, LABEL_TEXT_MUTED } from "@/shared/ui/section-heading";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, KIND_LABEL, Muted, PageHeader, TierChip, deviceName, since } from "../_components/ui";
import { ownerOf } from "../_data/fixtures";

const LIMIT_KEYS_SHOWN = 4;

export function DevicesSection() {
  const { fx } = usePortal();
  const [openId, setOpenId] = useState<string | null>(fx.devices[0]?.id ?? null);
  const open = fx.devices.find((d) => d.id === openId) ?? null;

  return (
    <>
      <PageHeader title="Devices" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <ul className="white-card m-0 flex h-fit min-w-0 list-none flex-col px-3">
          {fx.devices.map((d) => (
            <li key={d.id} className="border-t border-border-default first:border-t-0">
              <button
                type="button"
                onClick={() => setOpenId(d.id)}
                className={cn(
                  "-mx-1.5 my-1 flex w-[calc(100%+0.75rem)] items-center justify-between gap-3 rounded-field px-1.5 py-2 text-left transition-colors",
                  d.id === openId ? "bg-surface-raised-2" : "hover:bg-surface-raised-1"
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body font-medium text-text-primary">{deviceName(d)}</span>
                  <span className="truncate font-mono text-micro text-text-muted">
                    {ownerOf(fx, d.id)} · {d.id}
                  </span>
                </div>
                <OnlinePill device={d} />
              </button>
            </li>
          ))}
        </ul>
        {open && <DeviceDetail device={open} owner={ownerOf(fx, open.id)} />}
      </div>
    </>
  );
}

function OnlinePill({ device }: { device: Device }) {
  return device.online ? (
    <StatusPill tone="live" dot bare>
      Online
    </StatusPill>
  ) : (
    <StatusPill bare>Offline {since(device.last_seen_at)}</StatusPill>
  );
}

function DeviceDetail({ device, owner }: { device: Device; owner: string | null }) {
  const facts: Array<[string, string]> = [
    ["Kind", KIND_LABEL[device.kind] ?? device.kind],
    ["Vendor", device.vendor],
    ["Model", device.model],
    ["Firmware", device.firmware ?? "—"],
    ["Adapter", `${device.adapter_id}@${device.adapter_version}`],
    ["End user", owner ?? "—"],
  ];
  return (
    <Card className="h-fit">
      <div className="flex items-center justify-between gap-3">
        <h2 className={IDENTITY_NAME_TEXT}>{deviceName(device)}</h2>
        <OnlinePill device={device} />
      </div>
      <dl className="card-well grid grid-cols-3 gap-x-4 gap-y-3 px-3.5 py-3">
        {facts.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5">
            <dt className={LABEL_TEXT_MUTED}>{k}</dt>
            <dd className="truncate font-mono text-small text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <span className={LABEL_TEXT_MUTED}>Capabilities</span>
      <ul className="flex flex-col divide-y divide-border-subtle">
        {device.capabilities.map((c) => {
          const limits = Object.entries(c.limits);
          return (
            <li key={c.capability} className="flex items-start justify-between gap-3 py-2">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-mono text-body text-text-primary">{c.capability}</span>
                {limits.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {limits.slice(0, LIMIT_KEYS_SHOWN).map(([k, v]) => (
                      <Chip key={k}>
                        {k}={String(v)}
                      </Chip>
                    ))}
                    {limits.length > LIMIT_KEYS_SHOWN && <Muted>+{limits.length - LIMIT_KEYS_SHOWN}</Muted>}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Muted>{c.latency_class}</Muted>
                <span title={RISK_TIER_DEFAULT_POLICY[c.risk_tier]}>
                  <TierChip tier={c.risk_tier} />
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
