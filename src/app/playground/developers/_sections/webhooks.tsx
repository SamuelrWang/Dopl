"use client";

import { Fragment, useState } from "react";
import { Plus } from "lucide-react";
import type { WebhookEventName } from "@dopl/contracts/device-sdk";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { usePortal } from "../_components/portal-context";
import { addEndpoint, sendTestEvent } from "../_components/portal-actions";
import { ALL_WEBHOOK_EVENTS } from "../_components/portal-store";
import { Card, Json, Muted, PageHeader, RowOpen, Table, clock, ov, since } from "../_components/ui";
import type { WebhookOutboxRow } from "../_data/activity";

type StatusFilter = "all" | WebhookOutboxRow["status"];
const STATUSES: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "delivered", label: "Delivered" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
];

/** Attempts after the first, with exponential backoff; the eighth attempt is the last. */
export const RETRY_SCHEDULE = ["1m", "5m", "30m", "2h", "5h", "10h", "24h"] as const;
const MAX_ATTEMPTS = RETRY_SCHEDULE.length + 1;

/** Events grouped by their resource, the WorkOS picker's groups. */
const GROUPS = Object.entries(
  ALL_WEBHOOK_EVENTS.reduce<Record<string, WebhookEventName[]>>((acc, e) => {
    const g = e.split(".")[0];
    return { ...acc, [g]: [...(acc[g] ?? []), e] };
  }, {})
);

function statusPill(row: WebhookOutboxRow) {
  if (row.status === "delivered")
    return (
      <StatusPill tone="live" dot bare>
        Delivered
      </StatusPill>
    );
  if (row.status === "pending") return <StatusPill tone="attention">Retry {since(row.next_attempt_at)}</StatusPill>;
  return <StatusPill>Failed</StatusPill>;
}

export function WebhooksSection() {
  const { env, activity, store } = usePortal();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [replayed, setReplayed] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const rows = activity.webhooks.filter((r) => status === "all" || r.status === status);
  const endpoints = store.endpoints[env];

  return (
    <>
      <PageHeader
        title="Webhooks"
        action={
          <button type="button" className={pillButton("ink", "lg")} onClick={() => setAdding((v) => !v)}>
            <Plus size={PILL_ICON.lg} aria-hidden="true" />
            Add endpoint
          </button>
        }
      />
      {adding && <AddEndpoint onDone={() => setAdding(false)} />}

      <Card title="Endpoints" count={endpoints.length}>
        <ul className={ov.rows}>
          {endpoints.map((e) => (
            <li key={e.id} className={ov.row}>
              <span className={ov.rowMain}>
                <span className={cn(ov.rowTitle, "font-mono")}>{e.url}</span>
                <span className={cn(ov.rowMeta, "font-mono")}>
                  {e.events.length} events · whsec_{env}_••••{e.secret_tail}
                </span>
              </span>
              <CopyButton text={e.url} />
              <button type="button" className={pillButton("outline", "sm")} onClick={() => sendTestEvent(e)}>
                Send test event
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card
        title="Deliveries"
        count={rows.length}
        aside={<SegmentedControl options={STATUSES} value={status} onChange={setStatus} ariaLabel="Delivery status" />}
      >
        <span className={cn(ov.rowMeta, "font-mono")}>Retries {RETRY_SCHEDULE.join(" → ")}</span>
        <Table columns={["Created", "Event", "Status", { label: "Attempts", num: true }, "Next retry", ""]}>
          {rows.map((r) => {
            const open = openId === r.id;
            return (
              <Fragment key={r.id}>
                <tr>
                  <td className="font-mono text-small text-text-muted">
                    <RowOpen label={`Delivery ${r.id}`} expanded={open} onClick={() => setOpenId(open ? null : r.id)}>
                      {clock(r.created_at)}
                    </RowOpen>
                  </td>
                  <td className="font-mono text-small">{r.event_type}</td>
                  <td className="whitespace-nowrap">{statusPill(r)}</td>
                  <td className={`${ov.num} font-mono text-small`}>
                    {r.attempts} / {MAX_ATTEMPTS}
                  </td>
                  <td className="whitespace-nowrap font-mono text-small text-text-muted">
                    {r.status === "pending" ? RETRY_SCHEDULE[Math.min(r.attempts - 1, RETRY_SCHEDULE.length - 1)] : "—"}
                  </td>
                  <td className="text-right">
                    {replayed.has(r.id) ? (
                      <Muted>Queued</Muted>
                    ) : (
                      <button
                        type="button"
                        className={`${pillButton("quiet", "xs")} relative`}
                        onClick={() => setReplayed((prev) => new Set(prev).add(r.id))}
                      >
                        Replay
                      </button>
                    )}
                  </td>
                </tr>
                {open && (
                  <tr>
                    <td colSpan={6} className="pb-2.5">
                      <Json value={{ id: r.id, type: r.event_type, created_at: r.created_at, attempts: r.attempts, data: r.payload }} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </Table>
      </Card>
    </>
  );
}

/** WorkOS's create form: the URL, then a searchable picker of events grouped by resource. */
function AddEndpoint({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("https://");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<WebhookEventName>>(new Set());
  const valid = /^https:\/\/[^\s/]+\.[^\s]+/.test(url) && picked.size > 0;
  const toggle = (e: WebhookEventName) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(e)) next.delete(e);
      else next.add(e);
      return next;
    });

  return (
    <Card title="New endpoint">
      <label className="flex flex-col gap-1.5">
        <span className={ov.cellLabel}>URL</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} className={cn(RAISED_INPUT, "h-8 px-3 font-mono")} />
      </label>
      <SearchField value={q} onChange={setQ} placeholder="Search events" size="sm" />
      <div className="grid grid-cols-2 gap-3">
        {GROUPS.map(([group, events]) => {
          const shown = events.filter((e) => e.includes(q.trim()));
          if (shown.length === 0) return null;
          const all = events.every((e) => picked.has(e));
          return (
            <div key={group} className="card-well flex flex-col gap-1.5 px-3 py-2.5">
              <span className="flex items-center justify-between">
                <span className={cn(ov.rowTitle, "capitalize")}>{group}</span>
                <button
                  type="button"
                  className={pillButton("quiet", "xs")}
                  onClick={() => setPicked((prev) => new Set(all ? [...prev].filter((e) => !events.includes(e)) : [...prev, ...events]))}
                >
                  {all ? "None" : "All"}
                </button>
              </span>
              {shown.map((e) => (
                <label key={e} className="flex items-center gap-2 font-mono text-small text-text-primary">
                  <input type="checkbox" checked={picked.has(e)} onChange={() => toggle(e)} />
                  {e}
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!valid}
          className={cn(pillButton("ink", "md"), "disabled:opacity-60")}
          onClick={() => {
            addEndpoint(url, [...picked]);
            onDone();
          }}
        >
          Create with {picked.size} events
        </button>
        <button type="button" className={pillButton("quiet", "md")} onClick={onDone}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
