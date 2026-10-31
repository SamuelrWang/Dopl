"use client";

/**
 * Devices: which models this project has connected and how each is doing. A heading per category, a
 * card per model. Physical devices only appear on a user's page.
 */
import { Cpu, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { CATEGORIES } from "@/features/device-sdk/portal/catalog";
import { counted, figuresOfDevices, rowsBetween, type MetricRow, type PortalUser } from "@/features/device-sdk/portal/view";
import { Button, ICON, StatCard } from "../_design/ui";
import { CardSection, EmptyState, Page, PageHeader, StatRow } from "../_design/ui-page";
import { CategoryGlyph } from "../_components/category-glyph";
import { BASE, fmt, portalNow } from "../_components/format";
import { usePortal } from "../_components/portal-store";
import { ModelCard } from "./devices-card";
import { NO_DEVICE_FILTERS, attentionOf, keeps, modelRows, type DeviceFilters } from "./devices-model";
import { DevicesToolbar } from "./devices-toolbar";

export function DevicesSection({ users, metrics }: { users: PortalUser[]; metrics: MetricRow[] }) {
  const { test } = usePortal();
  const [filters, setFilters] = useState<DeviceFilters>(NO_DEVICE_FILTERS);
  const all = useMemo(() => modelRows(users), [users]);
  const rows = useMemo(() => all.filter((r) => keeps(r, filters)), [all, filters]);
  const patch = (next: Partial<DeviceFilters>) => setFilters((f) => ({ ...f, ...next }));

  const figures = figuresOfDevices(rows.flatMap((r) => r.devices));
  const relink = rows.reduce((n, r) => n + r.relink, 0);
  const stale = rows.reduce((n, r) => n + r.stale, 0);
  const categories = CATEGORIES.filter((category) => rows.some((r) => r.category.id === category.id));
  const week = rowsBetween(metrics, portalNow(), 6);

  return (
    <Page>
      <PageHeader title="Devices" test={test} />

      <StatRow>
        <StatCard label="Models" value={fmt(rows.length)} hint={counted(categories.length, "category", "categories")} />
        <StatCard label="Connected devices" value={fmt(figures.devices)} hint={`${fmt(figures.online)} online, ${counted(figures.users, "user")}`} />
        <StatCard label="Delivered, 7d" value={figures.deliveries ? `${figures.rate}%` : "None"} hint={`${fmt(figures.deliveries)} to connected devices`} />
        <StatCard label="Devices with issues" value={fmt(rows.reduce((n, r) => n + attentionOf(r), 0))} hint={`${relink} relink, ${stale} stale`} pressed={filters.quick === "attention"} onClick={() => patch({ quick: filters.quick === "attention" ? "all" : "attention" })} />
      </StatRow>

      <DevicesToolbar rows={all} filters={filters} onChange={patch} />

      {all.length === 0 ? (
        <EmptyState icon={Cpu} title="No devices connected" action={<Button href={`${BASE}/connect`}>Open Connect</Button>} />
      ) : categories.length === 0 ? (
        <EmptyState icon={SearchX} title="No models match" action={<Button onClick={() => setFilters(NO_DEVICE_FILTERS)}>Clear filters</Button>} />
      ) : (
        categories.map((category) => {
          const inSection = rows.filter((r) => r.category.id === category.id);
          const devices = inSection.reduce((n, r) => n + r.figures.devices, 0);
          return (
            <CardSection key={category.id} icon={<CategoryGlyph id={category.id} size={ICON} />} title={category.name} meta={counted(devices, "device")}>
              {inSection.map((row) => (
                <ModelCard key={row.model.id} row={row} metrics={week} />
              ))}
            </CardSection>
          );
        })
      )}
    </Page>
  );
}
