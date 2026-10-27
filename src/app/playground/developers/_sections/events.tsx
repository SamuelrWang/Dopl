"use client";

import { Fragment, useState } from "react";
import type { DeviceEventRow, ErrorCode, EventOutcome } from "@dopl/contracts/device-sdk";
import { ERROR_CODE_INFO } from "@dopl/contracts/device-sdk";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { SelectMenu } from "@/shared/ui/select-menu";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Chip, Json, KIND_LABEL, RowOpen, Table, TierChip, clock, ov } from "../_components/ui";

type OutcomeFilter = "all" | EventOutcome;
const OUTCOMES: ReadonlyArray<{ key: OutcomeFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ok", label: "Ok" },
  { key: "error", label: "Error" },
  { key: "denied", label: "Denied" },
];

function Outcome({ e }: { e: DeviceEventRow }) {
  if (e.outcome === "ok")
    return (
      <StatusPill tone="live" dot bare>
        ok
      </StatusPill>
    );
  return (
    <StatusPill tone={e.outcome === "error" ? "attention" : "neutral"} className="font-mono">
      {e.error_code ?? e.outcome}
    </StatusPill>
  );
}

export function EventsSection() {
  const { activity } = usePortal();
  const events = activity.events;
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [kind, setKind] = useState("all");
  const [code, setCode] = useState("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const kinds = [...new Set(events.map((e) => e.device_kind).filter((k): k is NonNullable<typeof k> => k !== null))];
  const codes = [...new Set(events.map((e) => e.error_code).filter((c): c is ErrorCode => c !== null))];
  const q = query.trim();
  const rows = events.filter(
    (e) =>
      (outcome === "all" || e.outcome === outcome) &&
      (kind === "all" || e.device_kind === kind) &&
      (code === "all" || e.error_code === code) &&
      (!q || [e.external_user_id, e.device_id, e.event_id, e.capability].some((v) => v?.includes(q)))
  );

  return (
    <Card title="Events" count={`${rows.length} of ${events.length}`}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl options={OUTCOMES} value={outcome} onChange={setOutcome} ariaLabel="Outcome" />
        <SelectMenu
          variant="outline"
          ariaLabel="Device kind"
          value={kind}
          onChange={setKind}
          options={[{ value: "all", label: "All devices" }, ...kinds.map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))]}
        />
        <SelectMenu
          variant="outline"
          ariaLabel="Error code"
          value={code}
          onChange={setCode}
          options={[{ value: "all", label: "All errors" }, ...codes.map((c) => ({ value: c, label: c }))]}
        />
        <SearchField value={query} onChange={setQuery} placeholder="User, device or event id" size="sm" className="ml-auto w-56" />
      </div>
      <Table columns={["Time", "Capability", "User", "Route", "Tier", "Outcome", { label: "Latency", num: true }]}>
        {rows.map((e) => {
          const open = openId === e.event_id;
          return (
            <Fragment key={e.event_id}>
              <tr>
                <td className="font-mono text-small text-text-muted">
                  <RowOpen label={`Event ${e.event_id}`} expanded={open} onClick={() => setOpenId(open ? null : e.event_id)}>
                    {clock(e.ts)}
                  </RowOpen>
                </td>
                <td className="whitespace-nowrap font-mono text-small">
                  {e.capability}
                  {e.intent && <span className="ml-1.5 text-text-muted">{e.intent}</span>}
                </td>
                <td className="whitespace-nowrap font-mono text-small text-text-secondary">{e.external_user_id ?? "—"}</td>
                <td className="whitespace-nowrap font-mono text-small">
                  {e.route_decision ? (
                    <>
                      {e.route_decision.target} → {e.device_kind}
                      <span className="ml-1.5 text-text-muted">{e.route_decision.reason}</span>
                    </>
                  ) : (
                    <span className="text-text-muted">{e.device_kind ? `from ${e.device_kind}` : "—"}</span>
                  )}
                </td>
                <td>{e.risk_tier && <TierChip tier={e.risk_tier} />}</td>
                <td className="whitespace-nowrap">
                  <Outcome e={e} />
                </td>
                <td className={`${ov.num} whitespace-nowrap font-mono text-small`}>
                  {e.latency_ms.api + (e.latency_ms.device_delivery ?? 0)} ms
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={7} className="pb-2.5">
                    <EventDetail e={e} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </Table>
    </Card>
  );
}

function EventDetail({ e }: { e: DeviceEventRow }) {
  const info = e.error_code ? ERROR_CODE_INFO[e.error_code] : null;
  return (
    <div className="flex flex-col gap-2">
      {info && (
        <div className="flex flex-wrap items-center gap-1">
          <Chip>{info.type}</Chip>
          <Chip>HTTP {info.status}</Chip>
          <Chip mono={false}>{info.retryable ? "Retryable" : "Not retryable"}</Chip>
        </div>
      )}
      <Json value={e} />
    </div>
  );
}
