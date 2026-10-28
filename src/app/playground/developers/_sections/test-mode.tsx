"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import type { DeviceKind, ErrorCode } from "@dopl/device-contracts";
import { ERROR_CODE_INFO, TEST_MAGIC_DEVICE_IDS } from "@dopl/device-contracts";
import { cn } from "@/shared/lib/utils";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { EmptyState } from "@/shared/ui/empty-state";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { usePortal } from "../_components/portal-context";
import { createSim } from "../_components/portal-actions";
import { Card, Chip, KIND_LABEL, PageHeader, glyphKind, ov } from "../_components/ui";
import { SIM_KINDS, isDirty } from "../_data/simulator";
import { SimDevicePanel } from "./sim-device";

const MAGIC = Object.entries(TEST_MAGIC_DEVICE_IDS) as Array<[keyof typeof TEST_MAGIC_DEVICE_IDS, ErrorCode]>;

export function TestModeSection() {
  const { env, setEnv, store } = usePortal();
  const devices = store.sim.devices;
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const open = devices.find((d) => d.id === openId) ?? devices[0] ?? null;

  if (env !== "test") {
    return (
      <>
        <PageHeader title="Test mode" />
        <Card title="Simulator">
          <EmptyState variant="outline" title="Simulators run in test only" />
          <button type="button" className={cn(pillButton("ink", "md"), "self-start")} onClick={() => setEnv("test")}>
            Switch to test
          </button>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Test mode"
        action={
          <button type="button" className={pillButton("ink", "lg")} onClick={() => setCreating((v) => !v)}>
            <Plus size={PILL_ICON.lg} aria-hidden="true" />
            Simulated device
          </button>
        }
      />
      {creating && (
        <CreateSim
          onDone={(id) => {
            setCreating(false);
            if (id) setOpenId(id);
          }}
        />
      )}
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start gap-3.5">
        <div className="flex min-w-0 flex-col gap-3.5">
          <Card title="Simulated devices" count={devices.length}>
            <ul className={ov.rows}>
              {devices.map((d) => (
                <li key={d.id} className={cn(ov.row, ov.openRow, "rounded-field", d.id === open?.id && "bg-menu-item-hover-bg")}>
                  <span className={ov.mark} data-shape="tile" aria-hidden="true">
                    <DeviceKindIcon kind={glyphKind(d.kind)} size={13} strokeWidth={1.8} />
                  </span>
                  <span className={ov.rowMain}>
                    <button type="button" className={cn(ov.open, ov.rowTitle)} aria-current={d.id === open?.id ? "true" : undefined} onClick={() => setOpenId(d.id)}>
                      {d.name}
                    </button>
                    <span className={cn(ov.rowMeta, "font-mono")}>{d.external_user_id}</span>
                  </span>
                  {isDirty(d) && <StatusPill tone="attention">Draft</StatusPill>}
                  <StatusPill tone={d.published.online ? "live" : "neutral"} dot bare>
                    {d.published.online ? "Online" : "Offline"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Magic ids" count={MAGIC.length}>
            <ul className={ov.rows}>
              {MAGIC.map(([id, code]) => (
                <li key={id} className={ov.row}>
                  <span className={ov.rowMain}>
                    <span className={cn(ov.rowTitle, "font-mono")}>{id}</span>
                    <span className={ov.rowMeta}>HTTP {ERROR_CODE_INFO[code].status}</span>
                  </span>
                  <Chip>{code}</Chip>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {open && <SimDevicePanel key={open.id} device={open} />}
      </div>
    </>
  );
}

function CreateSim({ onDone }: { onDone: (id: string | null) => void }) {
  const [kind, setKind] = useState<DeviceKind>("glasses");
  const [name, setName] = useState("");
  const [user, setUser] = useState("");
  return (
    <Card title="New simulated device">
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={ov.cellLabel}>Kind</span>
          <SelectMenu variant="outline" ariaLabel="Kind" value={kind} onChange={setKind} options={SIM_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ov.cellLabel}>Name</span>
          <input value={name} placeholder={`Simulated ${kind}`} onChange={(e) => setName(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3")} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ov.cellLabel}>external_user_id</span>
          <input value={user} placeholder="usr_123" onChange={(e) => setUser(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3 font-mono")} />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!user.trim()}
          className={cn(pillButton("ink", "md"), "disabled:opacity-60")}
          onClick={() => onDone(createSim({ kind, name: name.trim(), external_user_id: user.trim() }))}
        >
          Create
        </button>
        <button type="button" className={pillButton("quiet", "md")} onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
