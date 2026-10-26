// STAGING ONLY — Overview Version E: devices (the reach order, every device, Add device) and the
// activity feed (Routing and Logs). Built new; no Current / D component imported.
"use client";

import { useState } from "react";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import type { DevicesMock } from "@/features/overview-staging/overview-mock-data";
import { ECard, EDeviceMark, EStatus } from "./overview-e-bits";
import { seen, type DeviceRow } from "./overview-e-data";

const ADD_KINDS = [
  { kind: "computer", label: "Mac" },
  { kind: "glasses", label: "Glasses" },
  { kind: "phone", label: "Phone" },
  { kind: "other", label: "Other" },
] as const;

function AddDevice({ onClose }: { onClose: () => void }) {
  const [kind, setKind] = useState<string | null>(null);
  return (
    <div className="ove-add" role="group" aria-label="Add a device">
      <div className="ove-add-kinds">
        {ADD_KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className="ove-add-kind"
            aria-pressed={kind === k.kind}
            onClick={() => setKind(k.kind)}
          >
            <EDeviceMark kind={k.kind} />
            {k.label}
          </button>
        ))}
        <button type="button" className="ove-icon-btn" aria-label="Close add device" onClick={onClose}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {kind && kind !== "computer" && (
        <div className="ove-add-pair">
          <input aria-label="Pairing code" placeholder="ABC123" maxLength={6} className="ove-input" />
          <button type="button" className="ove-btn" disabled>
            Pair
          </button>
        </div>
      )}
      {kind === "computer" && <p className="ove-note">Sign in to Dopl on the new Mac.</p>}
    </div>
  );
}

export function DevicesCard({ mock, devices }: { mock: DevicesMock; devices: Map<string, DeviceRow> }) {
  const [adding, setAdding] = useState(false);
  const rows = [...devices.values()];
  const online = rows.filter((d) => d.status === "active").length;
  const chain = mock.fallbackChain.map((id) => devices.get(id)).filter((d): d is DeviceRow => Boolean(d));
  return (
    <ECard
      title="Devices"
      count={`${online}/${rows.length} online`}
      aside={
        <button type="button" className="ove-btn" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          <Plus size={12} aria-hidden="true" />
          Add device
        </button>
      }
    >
      {adding && <AddDevice onClose={() => setAdding(false)} />}
      <ol className="ove-chain" aria-label="Reach order">
        {chain.map((d, i) => (
          <li key={d.id} className="ove-chain-step" data-first={i === 0 ? "true" : undefined}>
            {i > 0 && (
              <span className="ove-chain-wait" aria-label="after 30 seconds">
                <ArrowRight size={11} aria-hidden="true" />
                30s
              </span>
            )}
            <EDeviceMark kind={d.kind} />
            <span className="ove-chain-name">{d.name}</span>
          </li>
        ))}
      </ol>
      <ul className="ove-rows">
        {rows.map((d) => (
          <li key={d.id} className="ove-row">
            <EDeviceMark kind={d.kind} />
            <span className="ove-row-main">
              <span className="ove-row-title">
                {d.name}
                {d.inUse && <span className="ove-tag" data-live="true">In use</span>}
              </span>
              <span className="ove-row-meta">
                {d.host ? `${d.model} · through ${d.host}` : d.model}
              </span>
            </span>
            {d.battery !== undefined && <span className="ove-mono">{d.battery}%</span>}
            <EStatus status={d.status} suffix={d.status === "active" ? undefined : seen(d.lastSeen)} />
          </li>
        ))}
      </ul>
    </ECard>
  );
}

export function ActivityCard({ mock, devices }: { mock: DevicesMock; devices: Map<string, DeviceRow> }) {
  const [tab, setTab] = useState<"routing" | "logs">("routing");
  const name = (id: string) => devices.get(id)?.name ?? "Removed device";
  const direct = mock.routes.filter((r) => r.tried.length === 1).length;
  return (
    <ECard
      title="Activity"
      count={tab === "routing" ? `${direct}/${mock.routes.length} first try` : mock.logs.length}
      aside={
        <span className="ove-tabs" role="tablist" aria-label="Activity feed">
          {(["routing", "logs"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className="ove-tab" onClick={() => setTab(t)}>
              {t === "routing" ? "Routing" : "Logs"}
            </button>
          ))}
        </span>
      }
    >
      {tab === "routing" ? (
        <ul className="ove-rows" aria-label="Routing">
          {mock.routes.map((r) => (
            <li key={r.id} className="ove-row ove-feed">
              <span className="ove-mono ove-time">{r.at}</span>
              <span className="ove-row-main">
                <span className="ove-row-title">{r.summary}</span>
                <span className="ove-row-meta" title={r.why}>
                  {r.kind} from {r.from}
                </span>
              </span>
              <span className="ove-hops" aria-label={`Tried ${r.tried.map(name).join(", ")}; landed on ${name(r.landedOn)}`}>
                {r.tried.map((id) => (
                  <span key={id} className="ove-hop" data-landed={id === r.landedOn ? "true" : undefined}>
                    {id === r.landedOn ? <Check size={10} aria-hidden="true" /> : <X size={10} aria-hidden="true" />}
                    {name(id)}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="ove-rows" aria-label="Logs">
          {mock.logs.map((l) => (
            <li key={l.id} className="ove-row ove-feed">
              <span className="ove-level" data-level={l.level} aria-label={l.level} />
              <span className="ove-mono ove-time">{l.at}</span>
              <span className="ove-row-main">
                <span className="ove-row-title">{l.event}</span>
                <span className="ove-row-meta">
                  {name(l.deviceId)} · {l.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </ECard>
  );
}
