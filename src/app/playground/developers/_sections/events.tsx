"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { PILL_ICON, pillButton } from "@/shared/ui/pill-button";
import { SearchField } from "@/shared/ui/search-field";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { patchLogFilter } from "../_components/portal-actions";
import { Card, Json, PageHeader, RowOpen, Table, clock, ov } from "../_components/ui";
import { LOG_TYPE_LABEL, queryLog, type LogRow, type LogType } from "../_data/log";

const TYPES: ReadonlyArray<{ key: LogType | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "request", label: "Requests" },
  { key: "connect", label: "Connect" },
  { key: "delivery", label: "Deliveries" },
  { key: "webhook", label: "Webhooks" },
];

const PAGE = 80;

function RowStatus({ row }: { row: LogRow }) {
  return row.ok ? (
    <StatusPill tone="live" dot bare>
      {row.status}
    </StatusPill>
  ) : (
    <StatusPill tone="attention" className="font-mono">
      {row.status}
    </StatusPill>
  );
}

/** Plaid's activity log and Stripe's inspector: one table of every row type, one id lookup, a JSON pane. */
export function EventsSection() {
  const { log, keys, store } = usePortal();
  const f = store.logFilter;
  const [failedOnly, setFailedOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const rows = queryLog(log, { q: f.q, type: f.type, key_id: f.key_id, error_code: f.error_code, failedOnly });
  const open = rows.find((r) => `${r.type}:${r.id}` === openId) ?? rows[0] ?? null;
  const key = f.key_id ? keys.find((k) => k.id === f.key_id) : null;

  return (
    <>
      <PageHeader title="Events" />
      <SearchField
        value={f.q}
        onChange={(q) => patchLogFilter({ q })}
        placeholder="Look up any id: req_, act_, evt_, dev_, conn_, ct_, whk_, or an external_user_id"
      />
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl options={TYPES} value={f.type} onChange={(type) => patchLogFilter({ type })} ariaLabel="Type" />
        <SegmentedControl
          options={[
            { key: "all", label: "Any status" },
            { key: "failed", label: "Failed" },
          ]}
          value={failedOnly ? "failed" : "all"}
          onChange={(v) => setFailedOnly(v === "failed")}
          ariaLabel="Status"
        />
        {f.key_id && (
          <button type="button" className={cn(pillButton("outline", "xs"), "font-mono")} onClick={() => patchLogFilter({ key_id: null })}>
            Key {key ? key.prefix : f.key_id}
            <X size={PILL_ICON.xs} aria-label="Clear key filter" />
          </button>
        )}
        {f.error_code && (
          <button type="button" className={cn(pillButton("outline", "xs"), "font-mono")} onClick={() => patchLogFilter({ error_code: null })}>
            {f.error_code}
            <X size={PILL_ICON.xs} aria-label="Clear error filter" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start gap-3.5">
        <Card title="Log" count={rows.length.toLocaleString()}>
          {rows.length === 0 ? (
            <EmptyState variant="outline" title="Nothing matches" />
          ) : (
            <>
              <Table columns={["Type", "Description", "Status", "Time"]}>
                {rows.slice(0, limit).map((r) => {
                  const id = `${r.type}:${r.id}`;
                  const selected = open !== null && `${open.type}:${open.id}` === id;
                  return (
                    <tr key={id} className={cn(selected && "bg-menu-item-hover-bg")}>
                      <td>
                        <RowOpen label={`${LOG_TYPE_LABEL[r.type]} ${r.id}`} expanded={selected} onClick={() => setOpenId(id)}>
                          <StatusPill>{LOG_TYPE_LABEL[r.type]}</StatusPill>
                        </RowOpen>
                      </td>
                      <td className="max-w-0 truncate font-mono text-small">{r.title}</td>
                      <td className="whitespace-nowrap">
                        <RowStatus row={r} />
                      </td>
                      <td className="whitespace-nowrap font-mono text-small text-text-muted">{clock(r.ts)}</td>
                    </tr>
                  );
                })}
              </Table>
              {rows.length > limit && (
                <button type="button" className={cn(pillButton("outline", "sm"), "self-center")} onClick={() => setLimit((n) => n + PAGE)}>
                  Show more
                </button>
              )}
            </>
          )}
        </Card>

        {open && (
          <Card title={LOG_TYPE_LABEL[open.type]} aside={<RowStatus row={open} />} className="sticky top-0">
            <span className={cn(ov.rowMeta, "font-mono")}>
              {open.id} · {clock(open.ts)}
            </span>
            <Json value={open.detail} />
          </Card>
        )}
      </div>
    </>
  );
}
