"use client";

/** Find a model: search, quick views, every category as a pill, two secondary filters. */
import { Button, Chip, PillMenu, SearchField, Segmented } from "../_design/ui";
import { Between, FilterRow, Grow, Toolbar } from "../_design/ui-page";
import { CATEGORIES } from "@/features/device-sdk/portal/catalog";
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
    <Toolbar>
      <Between>
        <SearchField hug value={filters.q} placeholder="Search models" onChange={(q) => onChange({ q })} />
        <Segmented label="Quick views" options={DEVICE_QUICK.map((q) => q.label)} value={DEVICE_QUICK.findIndex((q) => q.key === filters.quick)} onChange={(i) => onChange({ quick: DEVICE_QUICK[i].key })} />
      </Between>
      <FilterRow>
        <Chip on={filters.category === "all"} pressed={filters.category === "all"} onClick={() => onChange({ category: "all", integration: "all" })}>
          All
        </Chip>
        {CATEGORIES.filter((category) => rows.some((r) => r.category.id === category.id)).map((category) => {
          const on = filters.category === category.id;
          return (
            <Chip key={category.id} on={on} pressed={on} count={rows.filter((r) => r.category.id === category.id).length} onClick={() => onChange({ category: on ? "all" : category.id, integration: "all" })}>
              {category.name}
            </Chip>
          );
        })}
        <Grow />
        <PillMenu label="Integration" value={filters.integration} options={withAll(integrations.map((id) => ({ value: id, label: integrationName(id) })))} onChange={(integration) => onChange({ integration })} />
        <PillMenu label="Function" value={filters.fn} options={withAll(functions.map((fn) => ({ value: fn, label: fn })))} onChange={(fn) => onChange({ fn })} />
      </FilterRow>
      {chips.length > 0 && (
        <FilterRow>
          {chips.map((chip) => (
            <Chip key={chip.key} kind="tag" removeLabel={`Remove ${chip.label}`} onRemove={() => onChange(chip.clear)}>
              {chip.label}
            </Chip>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...NO_DEVICE_FILTERS, q: filters.q, quick: filters.quick, category: filters.category })}>
            Clear
          </Button>
        </FilterRow>
      )}
    </Toolbar>
  );
}
