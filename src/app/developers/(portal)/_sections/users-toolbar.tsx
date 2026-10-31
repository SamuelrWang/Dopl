"use client";

/** Search, the quick views, the filter pills and the chips for what is on. */
import { useEffect, useRef } from "react";
import { ALL_MODELS, CATEGORIES, INTEGRATIONS, categoryById, categoryOf, integrationById, integrationOf, modelById, type CategoryId, type ModelId } from "@/features/device-sdk/portal/catalog";
import type { PortalUser } from "@/features/device-sdk/portal/view";
import { Button, Chip as Tag, PillMenu, SearchField, Segmented, type PillOption } from "../_design/ui";
import { FilterRow, Row, Text, Toolbar } from "../_design/ui-page";
import { NO_FILTERS, QUICK, type Quick, type UserFilters } from "./users-model";

const ACTIVE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "over7", label: "Over 7 days ago" },
];
const withAll = (options: PillOption[]) => [{ value: "all", label: "All" }, ...options];

function chipsOf(v: UserFilters) {
  const chips: { key: string; label: string; clear: Partial<UserFilters> }[] = [];
  // Clearing a level clears what depends on it: Category, then Integration, then Model.
  if (v.category !== "all") chips.push({ key: "category", label: categoryById(v.category as CategoryId).name, clear: { category: "all", integration: "all", model: "all" } });
  if (v.integration !== "all") chips.push({ key: "integration", label: integrationById(v.integration)?.name ?? v.integration, clear: { integration: "all", model: "all" } });
  if (v.model !== "all") chips.push({ key: "model", label: modelById(v.model as ModelId).name, clear: { model: "all" } });
  if (v.active !== "all") chips.push({ key: "active", label: `Active: ${ACTIVE_OPTIONS.find((a) => a.value === v.active)?.label}`, clear: { active: "all" } });
  return chips;
}

export function UsersToolbar({ users, filters, quick, onFilters, onQuick }: { users: PortalUser[]; filters: UserFilters; quick: Quick; onFilters: (patch: Partial<UserFilters>) => void; onQuick: (quick: Quick) => void }) {
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);

  const devices = users.flatMap((u) => u.devices);
  const owners = (pick: (modelId: ModelId) => boolean) => users.filter((u) => u.devices.some((d) => pick(d.modelId))).length;
  const integrations = INTEGRATIONS.filter((i) => filters.category === "all" || i.categoryId === filters.category);
  const modelIds = new Set(integrations.filter((i) => filters.integration === "all" || i.id === filters.integration).flatMap((i) => i.models.map((m) => m.id)));
  const models = ALL_MODELS.filter((m) => modelIds.has(m.id) && devices.some((d) => d.modelId === m.id));
  const chips = chipsOf(filters);

  return (
    <Toolbar>
      <Row>
        <SearchField inputRef={search} value={filters.q} placeholder="Search" label="Search users" hint="⌘ K" onChange={(q) => onFilters({ q })} />
        <Segmented label="Quick views" options={QUICK.map((q) => q.label)} value={QUICK.findIndex((q) => q.key === quick)} onChange={(i) => onQuick(QUICK[i].key)} />
      </Row>
      <FilterRow>
        <Text kind="muted">Filter by</Text>
        <PillMenu label="Category" value={filters.category} options={withAll(CATEGORIES.map((c) => ({ value: c.id, label: c.name, count: owners((id) => categoryOf(id).id === c.id) })).filter((c) => c.count > 0))} onChange={(category) => onFilters({ category, integration: "all", model: "all" })} />
        <PillMenu label="Integration" value={filters.integration} options={withAll(integrations.map((i) => ({ value: i.id, label: i.name, count: owners((id) => integrationOf(id).id === i.id) })).filter((i) => i.count > 0))} onChange={(integration) => onFilters({ integration, model: "all" })} />
        <PillMenu label="Model" value={filters.model} options={withAll(models.map((m) => ({ value: m.id, label: m.name, count: owners((id) => id === m.id) })))} onChange={(model) => onFilters({ model })} />
        <PillMenu label="Last active" value={filters.active} options={withAll(ACTIVE_OPTIONS)} onChange={(active) => onFilters({ active })} />
      </FilterRow>
      {chips.length > 0 && (
        <FilterRow>
          {chips.map((chip) => (
            <Tag key={chip.key} kind="tag" removeLabel={`Remove ${chip.label}`} onRemove={() => onFilters(chip.clear)}>
              {chip.label}
            </Tag>
          ))}
          <Button variant="ghost" size="sm" onClick={() => onFilters({ ...NO_FILTERS, q: filters.q })}>
            Clear
          </Button>
        </FilterRow>
      )}
    </Toolbar>
  );
}
