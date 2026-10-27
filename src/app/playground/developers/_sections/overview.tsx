"use client";

import Link from "next/link";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { pillButton } from "@/shared/ui/pill-button";
import { StatusPill } from "@/shared/ui/status-pill";
import { usePortal } from "../_components/portal-context";
import { PORTAL_BASE } from "../_components/portal-shell";
import { Bars, Card, Cell, PageHeader, Chip, KIND_LABEL, Strip, glyphKind, ov, since } from "../_components/ui";
import type { DayPoint } from "../_data/activity";

const fmt = new Intl.NumberFormat("en-US");
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const tick = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));

function bars(series: DayPoint[], pick: (d: DayPoint) => number, unit: string) {
  return series.map((d) => ({ key: d.day, value: pick(d), label: `${tick(d.day)} · ${fmt.format(pick(d))} ${unit}`, tick: tick(d.day) }));
}

const TWO_COLS = "grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3.5";

export function OverviewSection() {
  const { fx, activity } = usePortal();
  const { series, events } = activity;
  const last = series[series.length - 1];
  const total = series.reduce((n, d) => n + d.requests, 0);
  const errors = series.reduce((n, d) => n + d.errors, 0);
  const users = new Set(fx.connections.filter((c) => c.status === "active").map((c) => c.external_user_id));
  const online = fx.devices.filter((d) => d.online).length;
  const deliveries = events.filter((e) => e.intent !== null);
  const delivered = deliveries.filter((e) => e.outcome === "ok").length;
  const byKind = Object.entries(
    fx.devices.reduce<Record<string, { all: number; online: number }>>((acc, d) => {
      const row = acc[d.kind] ?? { all: 0, online: 0 };
      return { ...acc, [d.kind]: { all: row.all + 1, online: row.online + (d.online ? 1 : 0) } };
    }, {})
  );
  const recentErrors = events.filter((e) => e.outcome !== "ok").slice(0, 5);

  return (
    <>
      <PageHeader title="Overview" />
      <Strip label="Summary">
        <Cell label="Requests today" value={fmt.format(last.requests)} sub={`${fmt.format(total)} in 14 days`} />
        <Cell label="Connected users" value={fmt.format(users.size)} sub={`${fx.connections.length} connections`} />
        <Cell label="Devices online" value={String(online)} of={`/ ${fx.devices.length}`} />
        <Cell
          label="Delivery success"
          value={`${((delivered / Math.max(1, deliveries.length)) * 100).toFixed(1)}%`}
          sub={`${(100 - (errors / Math.max(1, total)) * 100).toFixed(1)}% of requests ok`}
        />
      </Strip>

      <div className={TWO_COLS}>
        <Card title="Requests" aside={<span className="text-text-muted">14 days</span>}>
          <span className={ov.figure}>{fmt.format(total)}</span>
          <Bars bars={bars(series, (d) => d.requests, "requests")} label="Requests per day, last 14 days" />
        </Card>
        <Card title="Errors" aside={<span className="text-text-muted">14 days</span>}>
          <span className={ov.figure}>{fmt.format(errors)}</span>
          <Bars bars={bars(series, (d) => d.errors, "errors")} label="Errors per day, last 14 days" dim />
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
        <Card title="Devices" count={fx.devices.length}>
          <ul className={ov.rows}>
            {byKind.map(([kind, n]) => (
              <li key={kind} className={ov.row}>
                <span className={ov.mark} data-shape="tile" aria-hidden="true">
                  <DeviceKindIcon kind={glyphKind(kind)} size={13} strokeWidth={1.8} />
                </span>
                <span className={ov.rowMain}>
                  <span className={ov.rowTitle}>{KIND_LABEL[kind] ?? kind}</span>
                </span>
                <span className={ov.mono}>{n.all}</span>
                <StatusPill bare dot tone={n.online > 0 ? "live" : "neutral"}>
                  {n.online} online
                </StatusPill>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
