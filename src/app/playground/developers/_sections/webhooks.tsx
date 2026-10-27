"use client";

import { Fragment, useState } from "react";
import { CopyButton } from "@/shared/ui/copy-button";
import { pillButton } from "@/shared/ui/pill-button";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { Card, Json, Muted, RowOpen, Table, clock, ov, since } from "../_components/ui";
import type { WebhookOutboxRow } from "../_data/activity";

type StatusFilter = "all" | WebhookOutboxRow["status"];
const STATUSES: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "delivered", label: "Delivered" },
  { key: "pending", label: "Pending" },
  { key: "failed", label: "Failed" },
];

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
  const { env, activity } = usePortal();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [replayed, setReplayed] = useState<Set<string>>(new Set());
  const endpoint = env === "live" ? "https://api.acme-agents.com/dopl/webhooks" : "https://acme-agents.ngrok.app/dopl/webhooks";
  const rows = activity.webhooks.filter((r) => status === "all" || r.status === status);

  return (
    <>
      <Card title="Endpoint">
        <div className="card-well flex items-center justify-between gap-3 px-3 py-2.5">
          <code className="truncate font-mono text-body text-text-primary">{endpoint}</code>
          <span className="flex items-center gap-2">
            <code className="font-mono text-caption text-text-muted">whsec_{env}_••••••••</code>
            <CopyButton text={endpoint} />
          </span>
        </div>
      </Card>
      <Card
        title="Deliveries"
        count={rows.length}
        aside={<SegmentedControl options={STATUSES} value={status} onChange={setStatus} ariaLabel="Delivery status" />}
      >
        <Table columns={["Created", "Event", "Status", { label: "Attempts", num: true }, ""]}>
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
                  <td className={`${ov.num} font-mono text-small`}>{r.attempts}</td>
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
                    <td colSpan={5} className="pb-2.5">
                      <Json value={{ id: r.id, type: r.event_type, created_at: r.created_at, data: r.payload }} />
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
