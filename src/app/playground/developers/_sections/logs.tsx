"use client";

/** Logs: the aggregate first. One user's rows appear only after a search by user id. */
import { useState } from "react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { SearchField } from "@/shared/ui/search-field";
import { StatusPill } from "@/shared/ui/status-pill";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { integrationById, integrationOfModel, modelName } from "../_data/catalog";
import { byIntegration, dailyBars, rowsForUser, topErrors, usageOf, type LogRow } from "../_data/logs";
import { usePortal } from "../_components/portal-store";
import { Bars, Card, PortalPage, clock, fmt, ov } from "../_components/ui";

const GRID = "grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_72px] items-center gap-3";
const STATUS_LABEL = { delivered: "Delivered", answered: "Answered" } as const;

function Row({ row }: { row: LogRow }) {
  return (
    <li className={cn(GRID, "min-h-9 border-t border-border-default py-1 text-caption text-text-secondary")}>
      <span className="tabular-nums">{clock(row.at)}</span>
      <span className="truncate text-text-primary">
        {integrationOfModel(row.modelId).name} {modelName(row.modelId)}
      </span>
      <span className="truncate font-mono">{row.capability}</span>
      <span>{row.status === "failed" ? <StatusPill tone="attention">{row.errorCode}</StatusPill> : <StatusPill>{STATUS_LABEL[row.status]}</StatusPill>}</span>
      <span className="text-right tabular-nums">{row.latencyMs} ms</span>
    </li>
  );
}

function UserRows({ query }: { query: string }) {
  const { state } = usePortal();
  const rows = rowsForUser(state.env, query);
  if (rows.length === 0) return <EmptyState variant="outline" title="No calls for this user ID" />;
  return (
    <Card title={query.trim()} count={`Latest ${rows.length}`}>
      <div className={cn(GRID, "text-caption text-text-muted")}>
        <span>Time</span>
        <span>Device</span>
        <span>Capability</span>
        <span>Status</span>
        <span className="text-right">Latency</span>
      </div>
      <ul className="-mt-2.5 flex flex-col">
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
    </Card>
  );
}

export function LogsSection() {
  const { state } = usePortal();
  const [draft, setDraft] = useState("");
  const usage = usageOf(state.env);
  const integrations = byIntegration(state.env);
  const errors = topErrors(state.env);
  const query = draft.trim();
  return (
    <PortalPage title="Logs">
      <Card title="Calls" count="Last 14 days" aside={<span className="text-caption text-text-secondary">{usage.successRate}% success, last 7 days</span>}>
        <Bars bars={dailyBars(state.env)} label="Calls per day" />
      </Card>
      <div className="grid grid-cols-2 items-start gap-3.5">
        <Card title="By integration">
          <ul className={ov.rows}>
            {integrations.map((row) => (
              <li key={row.id} className={ov.row}>
                <span className={ov.rowMain}>
                  <span className={ov.rowTitle}>{integrationById(row.id).name}</span>
                  <span className={ov.rowMeta}>{fmt(row.calls)} calls</span>
                </span>
                <span className="w-24">
                  <ThinMeter used={row.successRate} limit={100} />
                </span>
                <span className="w-11 text-right text-caption tabular-nums text-text-primary">{row.successRate}%</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Top errors">
          {errors.length === 0 ? (
            <p className={ov.note}>None</p>
          ) : (
            <ul className={ov.rows}>
              {errors.map((row) => (
                <li key={row.code} className={ov.row}>
                  <span className={cn(ov.rowMain, "font-mono text-small text-text-primary")}>{row.code}</span>
                  <span className="text-caption tabular-nums text-text-secondary">{fmt(row.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <SearchField value={draft} onChange={setDraft} onClear={() => setDraft("")} placeholder={state.env === "live" ? "Search by user ID, like tech_1107" : "Search by user ID, like qa_mei"} />
      {query && <UserRows query={query} />}
    </PortalPage>
  );
}
