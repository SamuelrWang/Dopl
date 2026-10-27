"use client";

import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { pillButton } from "@/shared/ui/pill-button";
import { usePortal } from "../_components/portal-context";
import { PORTAL_BASE } from "../_components/portal-shell";
import { Card, Chip, KIND_LABEL, Muted, PageHeader, Stat, since } from "../_components/ui";
import type { DayPoint } from "../_data/activity";

const fmt = new Intl.NumberFormat("en-US");

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
    fx.devices.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.kind]: (acc[d.kind] ?? 0) + 1 }), {})
  );
  const recentErrors = events.filter((e) => e.outcome !== "ok").slice(0, 5);

  return (
    <>
      <PageHeader title="Overview" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Requests today" value={fmt.format(last.requests)} sub={`${fmt.format(total)} in 14 days`} />
        <Stat label="Connected users" value={fmt.format(users.size)} sub={`${fx.connections.length} connections`} />
        <Stat label="Devices online" value={`${online}/${fx.devices.length}`} sub={byKind.map(([k, n]) => `${n} ${KIND_LABEL[k]?.toLowerCase()}`).join(" · ")} />
        <Stat
          label="Delivery success"
          value={`${((delivered / Math.max(1, deliveries.length)) * 100).toFixed(1)}%`}
          sub={`${(100 - (errors / Math.max(1, total)) * 100).toFixed(1)}% of requests ok`}
        />
      </div>

      <Card title="Requests" aside={<Muted>Last 14 days</Muted>}>
        <RequestChart series={series} />
      </Card>

      <Card
        title="Recent errors"
        aside={
          <Link href={`${PORTAL_BASE}/events`} className={pillButton("outline", "sm")}>
            Open events
          </Link>
        }
      >
        <ul className="flex flex-col divide-y divide-border-subtle">
          {recentErrors.map((e) => (
            <li key={e.event_id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Chip>{e.error_code}</Chip>
                <span className="truncate font-mono text-small text-text-secondary">{e.capability}</span>
                <span className="truncate text-small text-text-muted">{e.external_user_id}</span>
              </div>
              <Muted>{since(e.ts)}</Muted>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Bars: requests on the solid histogram fill, the error share inked on top. */
function RequestChart({ series }: { series: DayPoint[] }) {
  const max = Math.max(...series.map((d) => d.requests));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-40 items-end gap-1.5" role="img" aria-label="Requests per day, last 14 days">
        {series.map((d, i) => (
          <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: ${fmt.format(d.requests)} requests, ${d.errors} errors`}>
            <div
              className={cn("flex w-full flex-col justify-start overflow-hidden rounded-mark transition-colors", i === series.length - 1 ? "bg-text-primary" : "bg-chart-bar group-hover:bg-text-muted")}
              style={{ height: `${(d.requests / max) * 100}%` }}
            >
              <div className="w-full bg-danger/60" style={{ height: `${(d.errors / d.requests) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-micro text-text-muted">
        <span>{series[0].day.slice(5)}</span>
        <span>{series[series.length - 1].day.slice(5)}</span>
      </div>
    </div>
  );
}
