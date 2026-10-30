"use client";

/**
 * Activity: what just happened, and why a call did what it did. Fits the window: figures for what is
 * filtered, every call on the left, the selected call's full story on the right.
 */
import { Download, SearchX } from "lucide-react";
import { useState } from "react";
import { Badge, Button, DataCell, DataRow, DataTable, ICON, PillMenu, SearchField, Segmented, StatCard, TwoLine, type Column, type Tone } from "../_design/ui";
import { FillCard, ScrollArea, SplitLayout } from "../_design/ui-output";
import { Between, EmptyState, FilterRow, Grow, Page, PageHeader, StatRow, TableHead, Text } from "../_design/ui-page";
import { DEMO_NOW } from "../_data/company";
import { KIND_LABEL, STATUS_LABEL, type Call, type CallKind, type CallStatus } from "../_data/activity";
import { ownedDevice, userById } from "../_data/users";
import { useCalls, usePortal } from "../_components/portal-store";
import { fmt, since } from "../_components/ui";
import { CallDetail } from "./activity-detail";

export const STATUS_TONE: Partial<Record<CallStatus, Tone>> = { seen: "ok", answered: "ok", ok: "ok", failed: "error", retrying: "warn", expired: "warn" };
const KINDS: { label: string; value: CallKind | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Deliveries", value: "delivery" },
  { label: "Requests", value: "request" },
  { label: "Webhooks", value: "webhook" },
];
const TROUBLE: CallStatus[] = ["failed", "retrying", "expired"];
const STATUSES = [{ value: "all", label: "All statuses" }, { value: "trouble", label: "Needs a look" }, ...(["seen", "answered", "ok", "sent", "accepted", "expired", "retrying", "failed"] as CallStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))];
const TIMES = [
  { value: "all", label: "Any time", mins: Infinity },
  { value: "1h", label: "Last hour", mins: 60 },
  { value: "24h", label: "Last 24 hours", mins: 1440 },
  { value: "7d", label: "Last 7 days", mins: 10080 },
];
const COLUMNS: Column[] = [
  { key: "call", label: "Call", width: "58%" },
  { key: "status", label: "Status", width: "26%" },
  { key: "at", label: "When", width: "16%" },
];
const labelOf = (options: { value: string; label: string }[], value: string) => options.find((o) => o.value === value)?.label ?? value;

function metaOf(call: Call) {
  const user = call.userId ? userById(call.userId)?.name : null;
  const device = call.deviceId ? ownedDevice(call.deviceId)?.name : null;
  return [user, device ?? call.http?.key, call.errorCode].filter(Boolean).join(", ") || KIND_LABEL[call.kind];
}

export function ActivitySection({ initial }: { initial: { call?: string; user?: string; device?: string; status?: string } }) {
  const { state } = usePortal();
  const calls = useCalls();
  const [openId, setOpenId] = useState<string | null>(initial.call ?? null);
  const [kind, setKind] = useState(0);
  const [status, setStatus] = useState(initial.status ?? "all");
  const [user, setUser] = useState(initial.user ?? "all");
  const [capability, setCapability] = useState("all");
  const [time, setTime] = useState("all");
  const [q, setQ] = useState(initial.device ?? "");

  const needle = q.trim().toLowerCase();
  const limit = TIMES.find((t) => t.value === time)!.mins;
  const rows = calls.filter((c) => {
    if (KINDS[kind].value !== "all" && c.kind !== KINDS[kind].value) return false;
    if (status === "trouble" ? !TROUBLE.includes(c.status) : status !== "all" && c.status !== status) return false;
    if (user !== "all" && c.userId !== user) return false;
    if (capability !== "all" && c.capability !== capability) return false;
    if ((Date.parse(DEMO_NOW) - Date.parse(c.at)) / 60_000 > limit) return false;
    return !needle || [c.id, c.requestId, c.deviceId, c.userId, c.title, c.webhook?.event].join(" ").toLowerCase().includes(needle);
  });
  const open = calls.find((c) => c.id === openId || c.requestId === openId) ?? rows[0] ?? null;

  const users = [...new Set(calls.map((c) => c.userId).filter(Boolean))] as string[];
  const userOptions = [{ value: "all", label: "All users" }, ...users.map((id) => ({ value: id, label: userById(id)?.name ?? id }))];
  const capabilityOptions = [{ value: "all", label: "All capabilities" }, ...[...new Set(calls.map((c) => c.capability).filter(Boolean))].map((c) => ({ value: c as string, label: c as string }))];
  const filtered = status !== "all" || user !== "all" || capability !== "all" || time !== "all" || kind !== 0 || q !== "";
  const clear = () => {
    setStatus("all");
    setUser("all");
    setCapability("all");
    setTime("all");
    setKind(0);
    setQ("");
  };

  const trouble = rows.filter((c) => TROUBLE.includes(c.status)).length;
  const worked = rows.filter((c) => ["seen", "answered", "ok"].includes(c.status)).length;
  const sorted = rows.map((c) => c.latencyMs).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const exportCsv = () => {
    const csv = ["id,kind,status,at,title", ...rows.map((c) => `${c.id},${c.kind},${c.status},${c.at},"${c.title.replaceAll('"', '""')}"`)].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "activity.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page fit>
      <PageHeader
        title="Activity"
        test={state.env === "test"}
        action={
          <Button disabled={rows.length === 0} onClick={exportCsv}>
            <Download {...ICON} aria-hidden="true" />
            Export
          </Button>
        }
      />
      <StatRow>
        <StatCard label="Calls" value={fmt(rows.length)} hint={rows.length === calls.length ? "Most recent" : `of ${fmt(calls.length)}`} />
        <StatCard label="Succeeded" value={rows.length ? `${Math.round((worked / rows.length) * 100)}%` : "None"} hint={`${fmt(worked)} calls`} />
        <StatCard label="Median time" value={`${fmt(median)} ms`} hint="Accepted to sent" />
        <StatCard label="Needs a look" value={fmt(trouble)} hint="Failed, retrying or unanswered" pressed={status === "trouble"} onClick={() => setStatus(status === "trouble" ? "all" : "trouble")} />
      </StatRow>
      <SplitLayout
        wide
        left={
          <FillCard flush>
            <TableHead stacked>
              <Between>
                <SearchField hug value={q} placeholder="Search calls" onChange={setQ} />
                <Segmented label="Type" options={KINDS.map((k) => k.label)} value={kind} onChange={setKind} />
              </Between>
              <FilterRow>
                <PillMenu stable label={labelOf(STATUSES, status)} value={status} options={STATUSES} onChange={setStatus} />
                <PillMenu stable label={labelOf(userOptions, user)} value={user} options={userOptions} onChange={setUser} />
                <PillMenu stable label={labelOf(capabilityOptions, capability)} value={capability} options={capabilityOptions} onChange={setCapability} />
                <PillMenu stable label={labelOf(TIMES, time)} value={time} options={TIMES} onChange={setTime} />
                <Grow />
                {filtered && (
                  <Button size="sm" variant="ghost" onClick={clear}>
                    Clear
                  </Button>
                )}
              </FilterRow>
            </TableHead>
            {rows.length === 0 ? (
              <EmptyState icon={SearchX} title="No calls match" action={<Button onClick={clear}>Clear filters</Button>} />
            ) : (
              <ScrollArea>
                <DataTable columns={COLUMNS}>
                  {rows.map((c) => (
                    <DataRow key={c.id} selected={open?.id === c.id} onClick={() => setOpenId(c.id)}>
                      <DataCell>
                        <TwoLine title={c.webhook?.event ?? c.title} sub={metaOf(c)} />
                      </DataCell>
                      <DataCell>
                        <Badge tone={STATUS_TONE[c.status] ?? "neutral"} dot>
                          {STATUS_LABEL[c.status]}
                        </Badge>
                      </DataCell>
                      <DataCell>
                        <Text nowrap>{since(c.at)}</Text>
                      </DataCell>
                    </DataRow>
                  ))}
                </DataTable>
              </ScrollArea>
            )}
          </FillCard>
        }
        right={<FillCard>{open ? <CallDetail call={open} /> : <Between><Text kind="muted">No call selected</Text></Between>}</FillCard>}
      />
    </Page>
  );
}
