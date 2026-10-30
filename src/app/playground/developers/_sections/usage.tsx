"use client";

/** Usage: the plan's meters and deliveries by day, filterable at every level of the hierarchy. */
import { useState } from "react";
import { pillButton } from "@/shared/ui/pill-button";
import { toast } from "@/shared/ui/toast";
import { ThinMeter } from "@/shared/ui/usage-meter";
import { dailySeries } from "../_data/activity";
import { ALL_MODELS, trail } from "../_data/catalog";
import { PLAN } from "../_data/misc";
import { ALL_LEVELS, HierarchyFilter, matchesHierarchy, type Hierarchy } from "../_components/hierarchy-filter";
import { usePortal, useUsers } from "../_components/portal-store";
import { devicesOfModel, figuresOfDevices } from "../_components/stats";
import { Bars, Card, Cell, PortalPage, Strip, fmt, ov } from "../_components/ui";

export function UsageSection() {
  const { state } = usePortal();
  const users = useUsers();
  const [levels, setLevels] = useState<Hierarchy>(ALL_LEVELS);
  const devices = users.flatMap((u) => u.devices).filter((d) => matchesHierarchy(d.modelId, levels));
  const week = figuresOfDevices(devices);
  const month = Math.round(week.deliveries * 3.9);
  const series = dailySeries(week.deliveries, 30);
  const rows = ALL_MODELS.map((m) => ({ model: m, f: figuresOfDevices(devicesOfModel(users, m.id)) })).filter((r) => r.f.devices > 0 && matchesHierarchy(r.model.id, levels));
  const seats = state.members.length;
  return (
    <PortalPage title="Usage" actions={<button type="button" className={pillButton("outline", "lg")} onClick={() => toast({ title: "Demo: would open billing" })}>Manage plan</button>}>
      <Strip label="Plan">
        <Cell label="Plan" value={PLAN.name} sub={PLAN.price} />
        <Cell label="Deliveries, this month" value={fmt(month)} of={`/ ${fmt(PLAN.deliveriesIncluded)}`} />
        <Cell label="Seats" value={String(seats)} of={`/ ${PLAN.seatsIncluded}`} />
        <Cell label="Renews" value={PLAN.renewsOn} />
      </Strip>
      <div className="flex flex-wrap items-center gap-1.5">
        <HierarchyFilter value={levels} onChange={setLevels} />
      </div>
      <Card title="Deliveries" count="Last 30 days">
        <Bars bars={series} label="Deliveries per day" />
        <ThinMeter used={month} limit={PLAN.deliveriesIncluded} warnNearFull />
      </Card>
      <Card title="By model" count={rows.length}>
        <ul className={ov.rows}>
          {rows.map(({ model, f }) => (
            <li key={model.id} className={ov.row}>
              <span className={ov.rowMain}>
                <span className={ov.rowTitle}>{model.name}</span>
                <span className={ov.rowMeta}>{trail(model.id).slice(0, 2).join(" › ")}</span>
              </span>
              <span className="w-28 text-right text-caption tabular-nums text-text-secondary">{fmt(f.deliveries)} deliveries</span>
              <span className="w-20 text-right text-caption tabular-nums text-text-secondary">{f.users} users</span>
              <ThinMeter used={f.deliveries} limit={Math.max(week.deliveries, 1)} className="w-24" />
            </li>
          ))}
        </ul>
      </Card>
    </PortalPage>
  );
}
