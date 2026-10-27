"use client";

import { Fragment, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { CopyButton } from "@/shared/ui/copy-button";
import { pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Muted, PageHeader, Table, Td, clock, since } from "../_components/ui";
import type { WebhookOutboxRow } from "../_data/activity";

type StatusFilter = "all" | WebhookOutboxRow["status"];
const STATUSES: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "delivered", label: "Delivered" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
];

function statusPill(row: WebhookOutboxRow) {
  if (row.status === "delivered") return <StatusPill tone="done">Delivered</StatusPill>;
  if (row.status === "pending") return <StatusPill tone="attention">Retry {since(row.next_attempt_at)}</StatusPill>;
  return <StatusPill>Failed</StatusPill>;
}

export function WebhooksSection() {
  const { env, activity } = usePortal();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [replayed, setReplayed] = useState<Set<string>>(new Set());
  const endpoint = env === "live" ? "https://api.acme-agents.com/dopl/webhooks" : "https://acme-agents.ngrok.app/dopl/webhooks";
  const rows = activity.webhooks.filter((r) => status === "all" || r.status === status);

  return (
    <>
      <PageHeader title="Webhooks" />
      <Card title="Endpoint">
        <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
          <code className="truncate font-mono text-body text-text-primary">{endpoint}</code>
          <div className="flex items-center gap-2">
            <code className="font-mono text-caption text-text-muted">whsec_{env}_••••••••</code>
            <CopyButton text={endpoint} />
          </div>
        </div>
      </Card>
      <SegmentedControl options={STATUSES} value={status} onChange={setStatus} ariaLabel="Delivery status" />
      <Table columns={["Created", "Event", "Status", "Attempts", ""]}>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <tr className="cursor-pointer hover:bg-surface-raised-1" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
              <Td mono className="whitespace-nowrap text-text-secondary">
                {clock(r.created_at)}
              </Td>
              <Td mono>{r.event_type}</Td>
              <Td className="whitespace-nowrap">{statusPill(r)}</Td>
              <Td mono className="tabular-nums">
                {r.attempts}
              </Td>
              <Td className="text-right">
                {replayed.has(r.id) ? (
                  <Muted>Queued</Muted>
                ) : (
                  <button
                    type="button"
                    className={cn(pillButton("quiet", "xs"))}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setReplayed((prev) => new Set(prev).add(r.id));
                    }}
                  >
                    Replay
                  </button>
                )}
              </Td>
            </tr>
            {openId === r.id && (
              <tr>
                <td colSpan={5} className="px-3 pb-3">
                  <pre className="card-well overflow-x-auto px-3.5 py-3 font-mono text-caption leading-relaxed text-text-secondary">
                    {JSON.stringify({ id: r.id, type: r.event_type, created_at: r.created_at, data: r.payload }, null, 2)}
                  </pre>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </Table>
    </>
  );
}
