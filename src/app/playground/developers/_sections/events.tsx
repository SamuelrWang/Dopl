"use client";

import { Fragment, useState } from "react";
import type { DeviceEventRow, ErrorCode, EventOutcome } from "@dopl/contracts/device-sdk";
import { ERROR_CODE_INFO } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { usePortal } from "../_components/portal-context";
import { Chip, KIND_LABEL, Muted, PageHeader, Table, Td, TierChip, clock } from "../_components/ui";

type OutcomeFilter = "all" | EventOutcome;
const OUTCOMES: ReadonlyArray<{ key: OutcomeFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "ok", label: "Ok" },
  { key: "error", label: "Error" },
  { key: "denied", label: "Denied" },
];

const OUTCOME_TONE: Record<EventOutcome, string> = {
  ok: "text-success",
  error: "text-danger",
  denied: "text-warning",
};

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
    <>
      <PageHeader title="Events" action={<Muted>{rows.length} of {events.length}</Muted>} />
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl options={OUTCOMES} value={outcome} onChange={setOutcome} ariaLabel="Outcome" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Device kind" className={cn(RAISED_INPUT, "h-8 w-auto px-2.5")}>
          <option value="all">All devices</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select value={code} onChange={(e) => setCode(e.target.value)} aria-label="Error code" className={cn(RAISED_INPUT, "h-8 w-auto px-2.5 font-mono")}>
          <option value="all">All errors</option>
          {codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <SearchField value={query} onChange={setQuery} placeholder="User, device or event id" size="sm" className="w-56" />
      </div>
      <Table columns={["Time", "Capability", "User", "Route", "Tier", "Outcome", "Latency"]}>
        {rows.map((e) => (
          <Fragment key={e.event_id}>
            <tr className="cursor-pointer hover:bg-surface-raised-1" onClick={() => setOpenId(openId === e.event_id ? null : e.event_id)}>
              <Td mono className="whitespace-nowrap text-text-secondary">
                {clock(e.ts)}
              </Td>
              <Td mono className="whitespace-nowrap">
                {e.capability}
                {e.intent && <span className="ml-1.5 text-text-muted">{e.intent}</span>}
              </Td>
              <Td mono className="whitespace-nowrap text-text-secondary">
                {e.external_user_id ?? "—"}
              </Td>
              <Td className="whitespace-nowrap">
                {e.route_decision ? (
                  <span className="font-mono text-small">
                    {e.route_decision.target} → {e.device_kind}
                    <span className="ml-1.5 text-text-muted">{e.route_decision.reason}</span>
                  </span>
                ) : (
                  <Muted>{e.device_kind ? `from ${e.device_kind}` : "—"}</Muted>
                )}
              </Td>
              <Td>{e.risk_tier && <TierChip tier={e.risk_tier} />}</Td>
              <Td className="whitespace-nowrap">
                <span className={cn("font-mono text-small font-medium", OUTCOME_TONE[e.outcome])}>{e.error_code ?? e.outcome}</span>
              </Td>
              <Td mono className="whitespace-nowrap text-right tabular-nums">
                {e.latency_ms.api + (e.latency_ms.device_delivery ?? 0)} ms
              </Td>
            </tr>
            {openId === e.event_id && (
              <tr>
                <td colSpan={7} className="px-3 pb-3">
                  <EventDetail e={e} />
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
    </>
  );
}

function EventDetail({ e }: { e: DeviceEventRow }) {
  const info = e.error_code ? ERROR_CODE_INFO[e.error_code] : null;
  return (
    <div className="card-well flex flex-col gap-2 px-3.5 py-3">
      {info && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{info.type}</Chip>
          <Chip>HTTP {info.status}</Chip>
          <Chip>{info.retryable ? "retryable" : "not retryable"}</Chip>
        </div>
      )}
      <pre className="overflow-x-auto font-mono text-caption leading-relaxed text-text-secondary">{JSON.stringify(e, null, 2)}</pre>
    </div>
  );
}
