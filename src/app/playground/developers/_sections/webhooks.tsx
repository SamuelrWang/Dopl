"use client";

/**
 * Webhooks: is every endpoint receiving its events, and what failed. Endpoints on top, then every
 * event sent to them, newest first; a row opens its attempts and payload.
 */
import { ChevronRight, Plus, SearchX, Webhook } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, DataCell, DataRow, DataTable, ICON, PillMenu, SearchField, Segmented, StatCard, type Column } from "../_design/ui";
import { Between, CardSection, EmptyState, Page, PageHeader, StatRow, TableHead, Text, Toast } from "../_design/ui-page";
import { minsAgo } from "../_data/company";
import { STATUS_LABEL, type Call } from "../_data/activity";
import type { EndpointRow } from "../_data/misc";
import { useCalls, usePortal } from "../_components/portal-store";
import { fmt, since } from "../_components/ui";
import { AddEndpointFlow } from "./webhooks-add";
import { EndpointCard } from "./webhooks-card";
import { CALL_TONE, EventSheet } from "./webhooks-sheet";

const VIEWS = ["All", "Failed"];
const SHOWN = 10;
const COLUMNS: Column[] = [
  { key: "event", label: "Event", width: "26%" },
  { key: "endpoint", label: "Endpoint", width: "26%" },
  { key: "status", label: "Status", width: "16%" },
  { key: "code", label: "Response", width: "12%" },
  { key: "tries", label: "Attempts", width: "10%" },
  { key: "at", label: "Sent", width: "10%" },
  { key: "open", srLabel: "Open", width: "calc(75 * var(--u))" },
];

const lastCode = (c: Call) => c.webhook?.attempts.at(-1)?.status ?? null;

export function WebhooksSection() {
  const { state, update } = usePortal();
  const calls = useCalls();
  const endpoints = state.endpoints.filter((e) => e.env === state.env);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [endpointId, setEndpointId] = useState("all");
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };
  const ids = new Set(endpoints.map((e) => e.id));
  const events = calls.filter((c) => c.webhook && ids.has(c.webhook.endpointId));
  const rows = events.filter((c) => (endpointId === "all" || c.webhook!.endpointId === endpointId) && (view === 0 || c.status === "failed" || c.status === "retrying") && (q === "" || c.webhook!.event.includes(q.toLowerCase())));
  const open = rows.find((c) => c.id === openId) ?? events.find((c) => c.id === openId) ?? null;
  const nameOf = (id: string) => endpoints.find((e) => e.id === id)?.description ?? id;

  const sent = endpoints.reduce((n, e) => n + e.sent7d, 0);
  const rate = sent ? Math.round((endpoints.reduce((n, e) => n + e.successRate * e.sent7d, 0) / sent) * 10) / 10 : 0;
  const failing = endpoints.filter((e) => e.state === "failing");
  const failed = events.filter((c) => c.status === "failed" || c.status === "retrying").length;

  const replace = (row: EndpointRow) => update((s) => ({ ...s, endpoints: s.endpoints.map((e) => (e.id === row.id ? row : e)) }));
  const showEvents = (id: string, failedOnly: boolean) => {
    setEndpointId(id);
    setView(failedOnly ? 1 : 0);
  };

  return (
    <Page
      overlays={
        <>
          {adding && <AddEndpointFlow onClose={() => setAdding(false)} onAdd={(url, description, names) => update((s) => ({ ...s, endpoints: [...s.endpoints, { id: `wh_${s.endpoints.length + 1}`, env: s.env, url, description, events: names, state: "healthy", successRate: 100, sent7d: 0, lastAt: minsAgo(0) }] }))} />}
          {open && <EventSheet call={open} endpoint={nameOf(open.webhook!.endpointId)} onClose={() => setOpenId(null)} onRetry={() => say(`${open.webhook!.event} sent again`)} />}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      <PageHeader
        title="Webhooks"
        test={state.env === "test"}
        action={
          <Button variant="ink" onClick={() => setAdding(true)}>
            <Plus {...ICON} aria-hidden="true" />
            Add endpoint
          </Button>
        }
      />

      <StatRow>
        <StatCard label="Endpoints" value={fmt(endpoints.length)} hint={`${endpoints.length - failing.length} healthy`} />
        <StatCard label="Sent, 7d" value={fmt(sent)} hint="Across all endpoints" />
        <StatCard label="Delivered" value={sent ? `${rate}%` : "None"} hint="Answered with a 2xx" />
        <StatCard label="Failed events" value={fmt(failed)} hint={`${failing.length} endpoint${failing.length === 1 ? "" : "s"} failing`} pressed={view === 1} onClick={() => setView(view === 1 ? 0 : 1)} />
      </StatRow>

      <CardSection icon={<Webhook {...ICON} aria-hidden="true" />} title="Endpoints" meta={`${fmt(sent)} sent, 7d`}>
        {endpoints.map((e) => (
          <EndpointCard key={e.id} endpoint={e} onEvents={() => showEvents(e.id, e.state === "failing")} onTest={() => say(`Test event sent to ${e.description}`)} onToggle={() => replace({ ...e, state: e.state === "paused" ? "healthy" : "paused" })} />
        ))}
      </CardSection>

      {events.length === 0 && endpoints.length === 0 ? (
        <EmptyState icon={Webhook} title="No endpoints yet" action={<Button onClick={() => setAdding(true)}>Add endpoint</Button>} />
      ) : (
        <Card flush>
          <TableHead>
            <Between>
              <SearchField hug value={q} placeholder="Search events" onChange={setQ} />
              <PillMenu label={endpointId === "all" ? "All endpoints" : nameOf(endpointId)} value={endpointId} options={[{ value: "all", label: "All endpoints" }, ...endpoints.map((e) => ({ value: e.id, label: e.description }))]} onChange={setEndpointId} />
            </Between>
            <Segmented label="Event views" options={VIEWS} value={view} onChange={setView} />
          </TableHead>
          {rows.length === 0 ? (
            <EmptyState icon={SearchX} title="No events match" action={<Button onClick={() => { setQ(""); setView(0); setEndpointId("all"); }}>Clear filters</Button>} />
          ) : (
            <DataTable columns={COLUMNS}>
              {rows.slice(0, SHOWN).map((c) => (
                <DataRow key={c.id} selected={openId === c.id} onClick={() => setOpenId(c.id)}>
                  <DataCell>
                    <Text kind="mono" clip>
                      {c.webhook!.event}
                    </Text>
                  </DataCell>
                  <DataCell>
                    <Text clip>{nameOf(c.webhook!.endpointId)}</Text>
                  </DataCell>
                  <DataCell>
                    <Badge tone={CALL_TONE[c.status] ?? "neutral"} dot>
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </DataCell>
                  <DataCell>
                    <Text num>{lastCode(c) ?? "None"}</Text>
                  </DataCell>
                  <DataCell>
                    <Text num>{c.webhook!.attempts.length}</Text>
                  </DataCell>
                  <DataCell>
                    <Text nowrap>{since(c.at)}</Text>
                  </DataCell>
                  <DataCell align="end">
                    <ChevronRight {...ICON} aria-hidden="true" />
                  </DataCell>
                </DataRow>
              ))}
            </DataTable>
          )}
        </Card>
      )}
    </Page>
  );
}
