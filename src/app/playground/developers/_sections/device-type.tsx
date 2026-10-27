"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import type { CapabilityDescriptor, CapabilityId } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { EmptyState } from "@/shared/ui/empty-state";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { PORTAL_BASE } from "../_components/portal-shell";
import { Card, Cell, Chip, Chips, Json, PageHeader, Strip, TierChip, ov } from "../_components/ui";
import { endpointFor, endpointLabel, simulate, type DeviceType } from "../_data/device-types";
import { allPassed, passedCount, type CapabilityTest } from "../_data/device-type-status";
import { ConnectCode } from "./device-code";
import { TypeStatusPill, usersOn } from "./devices";

const STEP_MS = 140;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function DeviceTypeSection({ type, descriptors }: { type: DeviceType; descriptors: CapabilityDescriptor[] }) {
  const p = usePortal();
  const state = p.typeState(type.id, descriptors);
  const caps = descriptors.map((d) => d.capability);
  const [running, setRunning] = useState<Set<CapabilityId>>(new Set());
  const [openCap, setOpenCap] = useState<CapabilityId | null>(null);
  const added = state.status !== "not_connected";
  const busy = running.size > 0;

  async function run(list: readonly CapabilityDescriptor[]) {
    setRunning(new Set(list.map((d) => d.capability)));
    for (const d of list) {
      await sleep(STEP_MS);
      const result: CapabilityTest = simulate(type, d);
      p.recordTypeTests(type.id, descriptors, [result]);
      setRunning((prev) => {
        const next = new Set(prev);
        next.delete(d.capability);
        return next;
      });
    }
    if (list.length === 1) setOpenCap(list[0].capability);
  }

  const passed = passedCount(state, caps);
  const latencies = caps.map((c) => state.tests[c]).filter((t): t is CapabilityTest => Boolean(t?.passed)).map((t) => t.latency_ms);
  const users = p.env === "live" ? usersOn(p.fx, type) : 0;

  return (
    <>
      <Link href={`${PORTAL_BASE}/devices`} className={cn(pillButton("quiet", "xs"), "self-start")}>
        <ArrowLeft size={PILL_ICON.xs} aria-hidden="true" />
        Devices
      </Link>
      <PageHeader
        title={type.name}
        action={
          <>
            <TypeStatusPill state={state} />
            {!added && (
              <button type="button" className={pillButton("ink", "lg")} onClick={() => p.addDeviceType(type.id, descriptors)}>
                <Plus size={PILL_ICON.lg} aria-hidden="true" />
                Add
              </button>
            )}
            {state.status === "added" && (
              <button type="button" disabled={busy} className={cn(pillButton("ink", "lg"), "disabled:opacity-60")} onClick={() => void run(descriptors)}>
                Test all
              </button>
            )}
            {state.status === "connected" && !state.live && type.availability !== "test_only" && (
              <button type="button" className={pillButton("ink", "lg")} onClick={() => p.goLiveType(type.id, descriptors)}>
                Go live
              </button>
            )}
            {added && (
              <button type="button" className={pillButton("quiet", "md")} onClick={() => p.removeDeviceType(type.id, descriptors)}>
                Remove
              </button>
            )}
          </>
        }
      />

      <Strip label="Status">
        <Cell label="Tests passed" value={String(passed)} of={`/ ${caps.length}`} />
        <Cell
          label="Average latency"
          value={latencies.length ? `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)} ms` : "—"}
        />
        <Cell label="Live" value={state.live ? "Shipped" : allPassed(state, caps) ? "Ready" : "After tests"} />
        <Cell label="Users connected" value={p.env === "live" ? String(users) : "—"} />
      </Strip>

      <ConnectCode type={type} descriptors={descriptors} testKey={p.testKey} />

      <Card
        title="Capabilities"
        count={caps.length}
        aside={
          <button
            type="button"
            disabled={!added || busy}
            className={cn(pillButton("outline", "sm"), "disabled:opacity-60")}
            onClick={() => void run(descriptors)}
          >
            Test all
          </button>
        }
      >
        <ul className={ov.rows}>
          {descriptors.map((d) => (
            <CapabilityRow
              key={d.capability}
              d={d}
              test={state.tests[d.capability] ?? null}
              running={running.has(d.capability)}
              disabled={!added || busy}
              open={openCap === d.capability}
              onToggle={() => setOpenCap(openCap === d.capability ? null : d.capability)}
              onTest={() => void run([d])}
            />
          ))}
        </ul>
      </Card>

      <OwnDevice type={type} descriptors={descriptors} />
    </>
  );
}

function CapabilityRow({
  d,
  test,
  running,
  disabled,
  open,
  onToggle,
  onTest,
}: {
  d: CapabilityDescriptor;
  test: CapabilityTest | null;
  running: boolean;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onTest: () => void;
}) {
  const limits = Object.entries(d.limits);
  return (
    <li className="flex flex-col">
      <div className={ov.row}>
        <span className={ov.rowMain}>
          <span className={ov.rowTitle}>
            <span className="font-mono">{d.capability}</span>
            <TierChip tier={d.risk_tier} />
          </span>
          <span className={cn(ov.rowMeta, "font-mono")}>{endpointLabel(endpointFor(d.capability))}</span>
          {limits.length > 0 && (
            <Chips>
              {limits.map(([k, v]) => (
                <Chip key={k}>
                  {k}={String(v)}
                </Chip>
              ))}
            </Chips>
          )}
        </span>
        {running ? (
          <StatusPill dot>Testing</StatusPill>
        ) : test ? (
          <button type="button" aria-expanded={open} onClick={onToggle}>
            <StatusPill tone={test.passed ? "live" : "attention"} dot bare={test.passed}>
              {test.passed ? "Passed" : "Failed"} · {test.latency_ms} ms
            </StatusPill>
          </button>
        ) : (
          <span className={ov.rowAside}>{d.latency_class}</span>
        )}
        <button type="button" disabled={disabled} className={cn(pillButton("outline", "xs"), "disabled:opacity-60")} onClick={onTest}>
          Test
        </button>
      </div>
      {open && test && (
        <div className="grid grid-cols-2 gap-3 pb-3">
          {(
            [
              ["Request", test.request],
              ["Response", test.response],
            ] as const
          ).map(([label, body]) => (
            <div key={label} className="flex min-w-0 flex-col gap-1.5">
              <span className={ov.cellLabel}>{label}</span>
              <Json value={body} />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

const DEMO_LINK = "https://www.usedopl.com/connect/demo_acme_own_device";
const DEMO_CODE = "K7Q2-94";

function OwnDevice({ type, descriptors }: { type: DeviceType; descriptors: CapabilityDescriptor[] }) {
  const p = usePortal();
  const state = p.typeState(type.id, descriptors);
  if (type.availability === "test_only") return null;
  return (
    <Card title="Test on my own device" aside={state.ownDevice === "paired" ? <StatusPill tone="live" dot>Paired</StatusPill> : undefined}>
      {state.status === "not_connected" ? (
        <EmptyState variant="outline" title="Add this device type first" />
      ) : state.ownDevice === "none" ? (
        <button type="button" className={cn(pillButton("outline", "sm"), "self-start")} onClick={() => p.stepOwnDeviceType(type.id, descriptors)}>
          Create test link
        </button>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
            <code className="truncate font-mono text-body text-text-primary">{DEMO_LINK}</code>
            <span className="flex items-center gap-3">
              <span className="font-mono text-body font-medium text-text-primary">{DEMO_CODE}</span>
              <CopyButton text={DEMO_LINK} />
            </span>
          </div>
          {state.ownDevice === "link" && (
            <button type="button" className={cn(pillButton("ink", "sm"), "self-start")} onClick={() => p.stepOwnDeviceType(type.id, descriptors)}>
              Mark as paired
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
