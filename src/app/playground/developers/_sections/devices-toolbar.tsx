"use client";

/** Find a model: search, quick views, every category as a pill, two secondary filters. */
import { X } from "lucide-react";
import { SearchPill } from "@/shared/ui/search-pill";
import b from "../_design/base.module.css";
import c from "../_design/catalog.module.css";
import { cx, ICON_100_SM } from "../_design/components";
import f from "../_design/forms.module.css";
import { PillMenu, Segmented } from "../_design/interactive";
import p from "../_design/page.module.css";
import { CATEGORIES } from "../_data/catalog";
import { DEVICE_QUICK, NO_DEVICE_FILTERS, integrationName, type DeviceFilters, type ModelRow } from "./devices-model";

const withAll = <T extends { value: string; label: string }>(options: T[]) => [{ value: "all", label: "All" }, ...options];

export function DevicesToolbar({ rows, filters, onChange }: { rows: ModelRow[]; filters: DeviceFilters; onChange: (patch: Partial<DeviceFilters>) => void }) {
  const inCategory = rows.filter((r) => filters.category === "all" || r.category.id === filters.category);
  const integrations = [...new Set(inCategory.map((r) => r.integration.id as string))];
  const functions = [...new Set(rows.flatMap((r) => r.functions))].sort();
  const chips = [
    filters.integration !== "all" && { key: "integration", label: integrationName(filters.integration), clear: { integration: "all" } },
    filters.fn !== "all" && { key: "fn", label: filters.fn, clear: { fn: "all" } },
  ].filter((chip) => chip !== false);
  return (
    <div className={cx(b.card, p.toolbar)}>
      <div className={b.between}>
        <SearchPill value={filters.q} onChange={(q) => onChange({ q })} label="Search models" />
        <Segmented label="Quick views" options={DEVICE_QUICK.map((q) => q.label)} value={DEVICE_QUICK.findIndex((q) => q.key === filters.quick)} onChange={(i) => onChange({ quick: DEVICE_QUICK[i].key })} />
      </div>
      <div className={p.filterRow}>
        <button type="button" aria-pressed={filters.category === "all"} className={cx(b.pill, b.pillBtn, filters.category === "all" && b.pillOn)} onClick={() => onChange({ category: "all", integration: "all" })}>
          All
        </button>
        {CATEGORIES.map((category) => {
          const on = filters.category === category.id;
          const n = rows.filter((r) => r.category.id === category.id).length;
          return (
            <button key={category.id} type="button" aria-pressed={on} className={cx(b.pill, b.pillBtn, on && b.pillOn)} onClick={() => onChange({ category: on ? "all" : category.id, integration: "all" })}>
              {category.name}
              {n > 0 && <span className={cx(c.pillCount, on && c.pillOnCount)}>{n}</span>}
            </button>
          );
        })}
        <span className={b.grow} />
        <PillMenu label="Integration" value={filters.integration} options={withAll(integrations.map((id) => ({ value: id, label: integrationName(id) })))} onChange={(integration) => onChange({ integration })} />
        <PillMenu label="Function" value={filters.fn} options={withAll(functions.map((fn) => ({ value: fn, label: fn })))} onChange={(fn) => onChange({ fn })} />
      </div>
      {chips.length > 0 && (
        <div className={p.filterRow}>
          {chips.map((chip) => (
            <span key={chip.key} className={cx(f.tag, p.chip)}>
              {chip.label}
              <button type="button" className={b.reset} aria-label={`Remove ${chip.label}`} onClick={() => onChange(chip.clear)}>
                <X {...ICON_100_SM} className={b.iconSoft} />
              </button>
            </span>
          ))}
          <button type="button" className={cx(b.btn, b.ghost, b.sm)} onClick={() => onChange({ ...NO_DEVICE_FILTERS, q: filters.q, quick: filters.quick, category: filters.category })}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
