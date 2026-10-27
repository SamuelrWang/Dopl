"use client";

import Link from "next/link";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { usePortal } from "../_components/portal-context";
import { PORTAL_BASE } from "../_components/portal-shell";
import { Bars, Card, Cell, Chip, PageHeader, Strip, glyphKind, ov, since } from "../_components/ui";
import { ADDABLE_TYPES } from "../_data/device-types";
import { TypeStatusPill, typeHref } from "./devices";
import type { DayPoint } from "../_data/activity";

const fmt = new Intl.NumberFormat("en-US");
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tick = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));

function bars(series: DayPoint[], pick: (d: DayPoint) => number, unit: string) {
  return series.map((d) => ({ key: d.day, value: pick(d), label: `${tick(d.day)} · ${fmt.format(pick(d))} ${unit}`, tick: tick(d.day) }));
}

const TWO_COLS = "grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3.5";

export function OverviewSection() {
  const { fx, activity, typeState } = usePortal();
  const { series, events } = activity;
  const last = series[series.length - 1];
  const total = series.reduce((n, d) => n + d.requests, 0);
  const errors = series.reduce((n, d) => n + d.errors, 0);
  const users = new Set(fx.connections.filter((c) => c.status === "active").map((c) => c.external_user_id));
  const online = fx.devices.filter((d) => d.online).length;
  const deliveries = events.filter((e) => e.intent !== null);
  const delivered = deliveries.filter((e) => e.outcome === "ok").length;
  const types = ADDABLE_TYPES.map((t) => ({ type: t, state: typeState(t.id, null) }));
  const compatible = types.filter((t) => t.state.status === "connected").length;
  const recentErrors = events.filter((e) => e.outcome !== "ok").slice(0, 5);

  return (
    <>
      <PageHeader title="Overview" />
      <Strip label="Summary">
        <Cell label="Requests today" value={fmt.format(last.requests)} sub={`${fmt.format(total)} in 30 days`} />
        <Cell label="Connected users" value={fmt.format(users.size)} sub={`${fx.connections.length} connections`} />
        <Cell label="Device types connected" value={String(compatible)} of={`/ ${types.length}`} sub={`${online} of ${fx.devices.length} devices online`} />
        <Cell
          label="Delivery success"
          value={`${((delivered / Math.max(1, deliveries.length)) * 100).toFixed(1)}%`}
          sub={`${(100 - (errors / Math.max(1, total)) * 100).toFixed(1)}% of requests ok`}
        />
      </Strip>

      <div className={TWO_COLS}>
        <Card title="Requests" aside={<span className="text-text-muted">30 days</span>}>
          <span className={ov.figure}>{fmt.format(total)}</span>
          <Bars bars={bars(series, (d) => d.requests, "requests")} label="Requests per day, last 30 days" />
        </Card>
        <Card title="Errors" aside={<span className="text-text-muted">30 days</span>}>
          <span className={ov.figure}>{fmt.format(errors)}</span>
          <Bars bars={bars(series, (d) => d.errors, "errors")} label="Errors per day, last 30 days" dim />
        </Card>
      </div>

      <div className={TWO_COLS}>
        <Card
          title="Recent errors"
          count={recentErrors.length}
          aside={
            <Link href={`${PORTAL_BASE}/events`} className={pillButton("outline", "sm")}>
              Open events
            </Link>
          }
        >
          <ul className={ov.rows}>
            {recentErrors.map((e) => (
              <li key={e.event_id} className={ov.row}>
                <span className={ov.rowMain}>
                  <span className={ov.rowTitle}>
                    <span className="truncate font-mono">{e.capability}</span>
                    <Chip>{e.error_code}</Chip>
                  </span>
                  <span className={ov.rowMeta}>{e.external_user_id ?? "No user"}</span>
                </span>
                <span className={ov.rowAside}>{since(e.ts)}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card
          title="Device types"
          count={compatible}
          aside={
            <Link href={`${PORTAL_BASE}/devices`} className={pillButton("outline", "sm")}>
              Open devices
            </Link>
          }
        >
          <ul className={ov.rows}>
            {types.map(({ type, state }) => (
              <li key={type.id} className={cn(ov.row, ov.openRow)}>
                <span className={ov.mark} data-shape="tile" aria-hidden="true">
                  <DeviceKindIcon kind={glyphKind(type.kind)} size={13} strokeWidth={1.8} />
                </span>
                <span className={ov.rowMain}>
                  <Link href={typeHref(type.id)} className={cn(ov.open, ov.rowTitle)}>
                    {type.name}
                  </Link>
                </span>
                <TypeStatusPill state={state} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
