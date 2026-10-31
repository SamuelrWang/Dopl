"use client";

/**
 * Activity: what just happened, and why a call did what it did. Fits the window: figures for what is
 * filtered, every call on the left, the selected call's full story on the right. Stays current while the
 * tab is visible, and reads older pages on request.
 */
import { Download, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { STATUS_LABEL, TROUBLE, WORKED, type Call, type CallKind, type CallStatus, CALL_KIND_LABEL, type PortalUser } from "@/features/device-sdk/portal/view";
import { Badge, Button, DataCell, DataRow, DataTable, ICON, PillMenu, SearchField, Segmented, StatCard, TwoLine, type Column, type Tone } from "../_design/ui";
import { FillCard, ScrollArea, SplitLayout } from "../_design/ui-output";
import { Between, EmptyState, FilterRow, Grow, Page, PageHeader, StatRow, TableFoot, TableHead, Text } from "../_design/ui-page";
import { downloadCsv, fmt, ms, portalNow, since } from "../_components/format";
import { usePortal } from "../_components/portal-store";
import { useLiveCalls } from "../_components/use-live-calls";
import { CallDetail } from "./activity-detail";

export const STATUS_TONE: Partial<Record<CallStatus, Tone>> = { delivered: "ok", answered: "ok", ok: "ok", received: "ok", dismissed: "ok", failed: "error", refused: "error", retrying: "warn", expired: "warn" };
const KINDS: { label: string; value: CallKind | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Deliveries", value: "delivery" },
  { label: "Messages", value: "message" },
  { label: "Requests", value: "request" },
  { label: "Webhooks", value: "webhook" },
];
const STATUSES = [{ value: "all", label: "All statuses" }, { value: "trouble", label: "Needs a look" }, ...(Object.keys(STATUS_LABEL) as CallStatus[]).map((s) => ({ value: s as string, label: STATUS_LABEL[s] }))];
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

export const userNameOf = (users: readonly PortalUser[], id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? id) : null);
export const deviceNameOf = (users: readonly PortalUser[], id: string | null) => {
  if (!id) return null;
  for (const u of users) {
    const d = u.devices.find((x) => x.id === id);
    if (d) return d.name;
  }
  return null;
};

function namesOf(users: readonly PortalUser[]) {
  return {
    user: new Map(users.map((u) => [u.id, u.name])),
    device: new Map(users.flatMap((u) => u.devices.map((d) => [d.id, d.name] as const))),
  };
}

function metaOf(call: Call, names: ReturnType<typeof namesOf>) {
  const user = call.userId && (names.user.get(call.userId) ?? call.userId);
  const device = (call.deviceId && names.device.get(call.deviceId)) || call.webhook?.endpointName;
  return [user, device, call.errorCode].filter(Boolean).join(", ") || CALL_KIND_LABEL[call.kind];
}

type Initial = { call?: string; user?: string; device?: string; status?: string };

/** Page-level Activity: every call in this environment. */
export function ActivitySection({ calls: first, users, initial }: { calls: Call[]; users: PortalUser[]; initial: Initial }) {
  const { test } = usePortal();
  const { calls, more, loading, loadOlder } = useLiveCalls(first);
  return (
    <Page fit>
      <CallsBrowser calls={calls} users={users} initial={initial} figures test={test} older={more ? { loading, load: () => void loadOlder() } : undefined} />
    </Page>
  );
}

/** Figures, filters, every call and the selected call's story. Fills a fit page. */
export function CallsBrowser({ calls, users, initial, figures, test, older }: { calls: Call[]; users: PortalUser[]; initial?: Initial; figures?: boolean; test?: boolean; older?: { loading: boolean; load: () => void } }) {
  const [openId, setOpenId] = useState<string | null>(initial?.call ?? null);
  const [kind, setKind] = useState(0);
  const [status, setStatus] = useState(initial?.status ?? "all");
  const [user, setUser] = useState(initial?.user ?? "all");
  const [capability, setCapability] = useState("all");
  const [time, setTime] = useState("all");
  const [q, setQ] = useState(initial?.device ?? "");

  const needle = q.trim().toLowerCase();
  const limit = TIMES.find((t) => t.value === time)!.mins;
  const rows = calls.filter((c) => {
    if (KINDS[kind].value !== "all" && c.kind !== KINDS[kind].value) return false;
    if (status === "trouble" ? !TROUBLE.includes(c.status) : status !== "all" && c.status !== status) return false;
    if (user !== "all" && c.userId !== user) return false;
    if (capability !== "all" && c.capability !== capability) return false;
    if ((portalNow() - Date.parse(c.at)) / 60_000 > limit) return false;
    return !needle || [c.id, c.deviceId, c.userId, c.title, c.webhook?.event].join(" ").toLowerCase().includes(needle);
  });
  const names = useMemo(() => namesOf(users), [users]);
  // With nothing clicked the first row opens, and stays open when a newer row lands above it.
  const [shown, setShown] = useState<string | null>(null);
  const open = calls.find((c) => c.id === openId) ?? rows.find((c) => c.id === shown) ?? rows[0] ?? null;
  if ((open?.id ?? null) !== shown) setShown(open?.id ?? null);
  const loadOlder = older && (
    <Button size="sm" variant="ghost" loading={older.loading} onClick={older.load}>
      Load older
    </Button>
  );

  const userIds = [...new Set(calls.map((c) => c.userId).filter(Boolean))] as string[];
  const userOptions = [{ value: "all", label: "All users" }, ...userIds.map((id) => ({ value: id, label: userNameOf(users, id) ?? id }))];
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
  const worked = rows.filter((c) => WORKED.includes(c.status)).length;
  const sorted = rows.map((c) => c.latencyMs).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? null;
  const exportCsv = () => downloadCsv("activity.csv", [["id", "kind", "status", "at", "title"], ...rows.map((c) => [c.id, c.kind, c.status, c.at, c.title])]);

  return (
    <>
      {figures && (
        <PageHeader
          title="Activity"
          test={test}
          action={
            <Button variant="ink" disabled={rows.length === 0} onClick={exportCsv}>
              <Download {...ICON} aria-hidden="true" />
              Export
            </Button>
          }
        />
      )}
      {figures && (
        <StatRow>
          <StatCard label="Calls" value={fmt(rows.length)} hint={rows.length === calls.length ? "Most recent" : `of ${fmt(calls.length)}`} />
          <StatCard label="Succeeded" value={rows.length ? `${Math.round((worked / rows.length) * 100)}%` : "None"} hint={`${fmt(worked)} calls`} />
          <StatCard label="Median time" value={median === null ? "None" : ms(median)} hint="API response" />
          <StatCard label="Needs a look" value={fmt(trouble)} hint="Failed, refused, retrying or unanswered" pressed={status === "trouble"} onClick={() => setStatus(status === "trouble" ? "all" : "trouble")} />
        </StatRow>
      )}
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
              <EmptyState icon={SearchX} title={filtered ? "No calls match" : "No calls yet"} action={filtered ? <>{loadOlder}<Button onClick={clear}>Clear filters</Button></> : undefined} />
            ) : (
              <ScrollArea>
                <DataTable columns={COLUMNS}>
                  {rows.map((c) => (
                    <DataRow key={c.id} selected={open?.id === c.id} onClick={() => setOpenId(c.id)}>
                      <DataCell>
                        <TwoLine title={c.title} sub={metaOf(c, names)} />
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
            {loadOlder && rows.length > 0 && <TableFoot><Text kind="smallMuted">{fmt(calls.length)} loaded</Text>{loadOlder}</TableFoot>}
          </FillCard>
        }
        right={<FillCard>{open ? <CallDetail call={open} users={users} /> : <Between><Text kind="muted">No call selected</Text></Between>}</FillCard>}
      />
    </>
  );
}
