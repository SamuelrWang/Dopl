"use client";

import { useState } from "react";
import type { Device } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, PageHeader, Chips, Facts, KIND_LABEL, TierChip, deviceName, glyphKind, ov, since } from "../_components/ui";
import { ownerOf } from "../_data/fixtures";

const LIMIT_KEYS_SHOWN = 4;

export function DevicesSection() {
  const { fx } = usePortal();
  const [openId, setOpenId] = useState<string | null>(fx.devices[0]?.id ?? null);
  const open = fx.devices.find((d) => d.id === openId) ?? null;

  return (
    <>
      <PageHeader title="Devices" />
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3.5">
      <Card title="Devices" count={fx.devices.length}>
        <ul className={ov.rows}>
          {fx.devices.map((d) => (
            <li
              key={d.id}
              className={cn(ov.row, ov.openRow, "rounded-field", d.id === openId && "bg-menu-item-hover-bg")}
            >
              <span className={ov.mark} data-shape="tile" aria-hidden="true">
                <DeviceKindIcon kind={glyphKind(d.kind)} size={13} strokeWidth={1.8} />
              </span>
              <span className={ov.rowMain}>
                <button
                  type="button"
                  className={cn(ov.open, ov.rowTitle)}
                  aria-current={d.id === openId ? "true" : undefined}
                  onClick={() => setOpenId(d.id)}
                >
                  {deviceName(d)}
                </button>
                <span className={cn(ov.rowMeta, "font-mono")}>
                  {ownerOf(fx, d.id) ?? "Unclaimed"} · {d.id}
                </span>
              </span>
              <OnlinePill device={d} />
            </li>
          ))}
        </ul>
      </Card>
      {open && <DeviceDetail device={open} owner={ownerOf(fx, open.id)} />}
    </div>
    </>
  );
}

function OnlinePill({ device }: { device: Device }) {
  return (
    <StatusPill tone={device.online ? "live" : "neutral"} dot bare>
      {device.online ? "Online" : `Seen ${since(device.last_seen_at)}`}
    </StatusPill>
  );
}

function DeviceDetail({ device, owner }: { device: Device; owner: string | null }) {
  return (
    <Card title={deviceName(device)} aside={<OnlinePill device={device} />}>
      <Facts
        facts={[
          ["Kind", KIND_LABEL[device.kind] ?? device.kind],
          ["Vendor", device.vendor],
          ["Model", device.model],
          ["Firmware", device.firmware ?? "—"],
          ["Adapter", `${device.adapter_id}@${device.adapter_version}`],
          ["End user", owner ?? "—"],
        ]}
      />
      <ul className={ov.rows} aria-label="Capabilities">
        {device.capabilities.map((c) => {
          const limits = Object.entries(c.limits);
          return (
            <li key={c.capability} className={ov.row}>
              <span className={ov.rowMain}>
                <span className={cn(ov.rowTitle, "font-mono")}>{c.capability}</span>
                {limits.length > 0 && (
                  <Chips>
                    {limits.slice(0, LIMIT_KEYS_SHOWN).map(([k, v]) => (
                      <Chip key={k}>
                        {k}={String(v)}
                      </Chip>
                    ))}
                    {limits.length > LIMIT_KEYS_SHOWN && <span className={ov.rowMeta}>+{limits.length - LIMIT_KEYS_SHOWN}</span>}
                  </Chips>
                )}
              </span>
              <span className={ov.rowAside}>{c.latency_class}</span>
              <TierChip tier={c.risk_tier} />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
