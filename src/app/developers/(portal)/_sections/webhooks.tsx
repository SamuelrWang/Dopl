"use client";

/**
 * Webhooks: is every endpoint receiving its events, and what failed. Endpoints on top, then every
 * event sent to them, newest first; a row opens its attempts and payload.
 */
import { ChevronRight, Plus, SearchX, Webhook } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { counted, rateOf, type Call, type EndpointView } from "@/features/device-sdk/portal/view";
import { errorText, portalCall } from "../../_lib/client-api";
import { Button, Card, DataCell, DataRow, DataTable, ICON, PillMenu, SearchField, Segmented, StatCard, type Column } from "../_design/ui";
import { Between, CardSection, EmptyState, Page, PageHeader, Pager, StatRow, TableFoot, TableHead, Text, Toast } from "../_design/ui-page";
import { fmt, since } from "../_components/format";
import { useLiveRefresh, usePortal } from "../_components/portal-store";
import { useLiveCalls } from "../_components/use-live-calls";
import { useNotice } from "../_components/use-notice";
import { CallStatusBadge } from "./activity-parts";
import { AddEndpointFlow } from "./webhooks-add";
import { EndpointCard } from "./webhooks-card";
import { EventSheet } from "./webhooks-sheet";

const VIEWS = ["All", "Failed"];
const SHOWN = 10;
/** The rows stay live on their own. This is for the endpoint figures above them. */
const FIGURES_MS = 30_000;
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
const isFailure = (c: Call) => c.status === "failed" || c.status === "retrying";

export function WebhooksSection({ endpoints, events: first }: { endpoints: EndpointView[]; events: Call[] }) {
  const router = useRouter();
  const { test, project, env, canManage } = usePortal();
  useLiveRefresh(FIGURES_MS);
  const { calls: events } = useLiveCalls(first, "webhooks");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [endpointId, setEndpointId] = useState("all");
  const [q, setQ] = useState("");
  const { notice, say } = useNotice();
  const [busy, setBusy] = useState(false);

  const rows = events.filter((c) => (endpointId === "all" || c.webhook!.endpointId === endpointId) && (view === 0 || isFailure(c)) && (q === "" || c.webhook!.event.includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / SHOWN));
  const current = Math.min(page, pages);
  const open = events.find((c) => c.id === openId) ?? null;
  const nameOf = (id: string) => endpoints.find((e) => e.id === id)?.name ?? id;

  const sent = endpoints.reduce((n, e) => n + e.sent7d, 0);
  const delivered = endpoints.reduce((n, e) => n + e.delivered7d, 0);
  const failedCount = endpoints.reduce((n, e) => n + e.failed7d, 0);
  const rate = rateOf({ deliveries: delivered + failedCount, delivered });
  const failing = endpoints.filter((e) => e.state === "failing");

  const toggle = async (e: EndpointView) => {
    try {
      await portalCall(`/api/developers/webhooks/${e.id}`, "PATCH", { project: project.id, env, paused: e.state !== "paused" });
      router.refresh();
    } catch (err) {
      say(errorText(err, "Could not change this endpoint."));
    }
  };
  const retry = async (c: Call) => {
    setBusy(true);
    try {
      await portalCall(`/api/developers/webhook-deliveries/${c.id}`, "POST", { project: project.id, env });
      say(`${c.webhook!.event} queued again`);
      router.refresh();
    } catch (err) {
      say(errorText(err, "Could not send this again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      overlays={
        <>
          {adding && (
            <AddEndpointFlow
              onClose={() => {
                setAdding(false);
                router.refresh();
              }}
            />
          )}
          {open && <EventSheet call={open} canManage={canManage} busy={busy} onClose={() => setOpenId(null)} onRetry={() => void retry(open)} />}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      <PageHeader
        title="Webhooks"
        test={test}
        action={
          canManage && (
            <Button variant="ink" onClick={() => setAdding(true)}>
              <Plus {...ICON} aria-hidden="true" />
              Add endpoint
            </Button>
          )
        }
      />

      <StatRow>
        <StatCard label="Endpoints" value={fmt(endpoints.length)} hint={`${endpoints.filter((e) => e.state === "healthy").length} healthy`} />
        <StatCard label="Sent, 7d" value={fmt(sent)} hint="Across all endpoints" />
        <StatCard label="Delivered" value={delivered + failedCount ? `${rate}%` : "None"} hint="Answered with a 2xx" />
        <StatCard label="Failed events" value={fmt(failedCount)} hint={`${counted(failing.length, "endpoint")} failing`} pressed={view === 1} onClick={() => setView(view === 1 ? 0 : 1)} />
      </StatRow>

      {endpoints.length === 0 ? (
        <EmptyState icon={Webhook} title="No endpoints yet" action={canManage ? <Button onClick={() => setAdding(true)}>Add endpoint</Button> : undefined} />
      ) : (
        <>
          <CardSection icon={<Webhook {...ICON} aria-hidden="true" />} title="Endpoints" meta={`${fmt(sent)} sent, 7d`}>
            {endpoints.map((e) => (
              <EndpointCard
                key={e.id}
                endpoint={e}
                canManage={canManage}
                onEvents={() => {
                  setEndpointId(e.id);
                  setView(e.state === "failing" ? 1 : 0);
                }}
                onToggle={() => void toggle(e)}
              />
            ))}
          </CardSection>
          <Card flush>
            <TableHead>
              <Between>
                <SearchField hug value={q} placeholder="Search events" onChange={setQ} />
                <PillMenu stable label={endpointId === "all" ? "All endpoints" : nameOf(endpointId)} value={endpointId} options={[{ value: "all", label: "All endpoints" }, ...endpoints.map((e) => ({ value: e.id, label: e.name }))]} onChange={setEndpointId} />
              </Between>
              <Segmented label="Event views" options={VIEWS} value={view} onChange={setView} />
            </TableHead>
            {rows.length === 0 ? (
              <EmptyState icon={SearchX} title={events.length === 0 ? "No events yet" : "No events match"} action={events.length > 0 ? <Button onClick={() => { setQ(""); setView(0); setEndpointId("all"); }}>Clear filters</Button> : undefined} />
            ) : (
              <DataTable columns={COLUMNS}>
                {rows.slice((current - 1) * SHOWN, current * SHOWN).map((c) => (
                  <DataRow key={c.id} selected={openId === c.id} onClick={() => setOpenId(c.id)}>
                    <DataCell>
                      <Text kind="mono" clip>
                        {c.webhook!.event}
                      </Text>
                    </DataCell>
                    <DataCell>
                      <Text clip>{c.webhook!.endpointName}</Text>
                    </DataCell>
                    <DataCell>
                      <CallStatusBadge status={c.status} />
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
            {pages > 1 && (
              <TableFoot>
                <Text kind="smallMuted">{counted(rows.length, "event")}</Text>
                <Pager page={current} pages={pages} onPage={setPage} />
              </TableFoot>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}
