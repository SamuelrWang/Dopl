"use client";

/**
 * Devices: which models this project supports and how each is doing. A heading per category, a card
 * per added model, an add card closing each section. Physical devices only appear on a user's page.
 */
import { Plus, SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, ICON, StatCard } from "../_design/ui";
import { CardSection, EmptyState, Page, PageHeader, StatRow } from "../_design/ui-page";
import { CATEGORIES, type CategoryId } from "../_data/catalog";
import { CategoryGlyph } from "../_components/category-glyph";
import { usePortal, useUsers } from "../_components/portal-store";
import { figuresOfDevices } from "../_components/stats";
import { fmt } from "../_components/ui";
import { AddDeviceDialog } from "./add-device-dialog";
import { AddModelCard, ModelCard } from "./devices-card";
import { NO_DEVICE_FILTERS, attentionOf, availableModels, keeps, modelRows, type DeviceFilters } from "./devices-model";
import { DevicesToolbar } from "./devices-toolbar";

export function DevicesSection() {
  const { state } = usePortal();
  const users = useUsers();
  const [filters, setFilters] = useState<DeviceFilters>(NO_DEVICE_FILTERS);
  const [adding, setAdding] = useState<CategoryId | "any" | null>(null);

  const all = useMemo(() => modelRows(state, users), [state, users]);
  const rows = useMemo(() => all.filter((r) => keeps(r, filters)), [all, filters]);
  const patch = (next: Partial<DeviceFilters>) => setFilters((f) => ({ ...f, ...next }));

  const figures = figuresOfDevices(rows.flatMap((r) => r.devices));
  const live = rows.filter((r) => r.added.status === "live").length;
  const relink = rows.reduce((n, r) => n + r.relink, 0);
  const stale = rows.reduce((n, r) => n + r.stale, 0);
  // Add cards belong to browsing; a search answers with what matched.
  const browsing = filters.q === "" && filters.quick === "all" && filters.integration === "all" && filters.fn === "all";
  const categories = CATEGORIES.filter((category) => (filters.category === "all" || filters.category === category.id) && (browsing || rows.some((r) => r.category.id === category.id)));

  return (
    <Page overlays={adding && <AddDeviceDialog initialCategory={adding === "any" ? null : adding} onClose={() => setAdding(null)} />}>
      <PageHeader
        title="Devices"
        test={state.env === "test"}
        action={
          <Button variant="ink" onClick={() => setAdding("any")}>
            <Plus {...ICON} />
            Add device
          </Button>
        }
      />

      <StatRow>
        <StatCard label="Models" value={fmt(rows.length)} hint={`${live} live${rows.length > live ? `, ${rows.length - live} testing` : ""}`} />
        <StatCard label="Connected devices" value={fmt(figures.devices)} hint={`${fmt(figures.online)} online, ${fmt(figures.users)} users`} />
        <StatCard label="Shown, 7d" value={figures.deliveries ? `${figures.rate}%` : "None"} hint={`${fmt(figures.deliveries)} calls`} />
        <StatCard
          label="Devices with issues"
          value={fmt(rows.reduce((n, r) => n + attentionOf(r), 0))}
          hint={`${relink} relink, ${stale} stale`}
          pressed={filters.quick === "attention"}
          onClick={() => patch({ quick: filters.quick === "attention" ? "all" : "attention" })}
        />
      </StatRow>

      <DevicesToolbar rows={all} filters={filters} onChange={patch} />

      {categories.length === 0 ? (
        <EmptyState icon={SearchX} title="No models match" action={<Button onClick={() => setFilters(NO_DEVICE_FILTERS)}>Clear filters</Button>} />
      ) : (
        categories.map((category) => {
          const inSection = rows.filter((r) => r.category.id === category.id);
          const devices = inSection.reduce((n, r) => n + r.figures.devices, 0);
          return (
            <CardSection key={category.id} icon={<CategoryGlyph id={category.id} size={ICON} />} title={category.name} meta={devices > 0 && `${fmt(devices)} devices`}>
              {inSection.map((row) => (
                <ModelCard key={row.model.id} row={row} />
              ))}
              {browsing && <AddModelCard category={category} available={availableModels(state, category.id)} wide={inSection.length === 0} onClick={() => setAdding(category.id)} />}
            </CardSection>
          );
        })
      )}
    </Page>
  );
}
