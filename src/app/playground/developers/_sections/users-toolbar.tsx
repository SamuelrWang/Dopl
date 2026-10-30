"use client";

/** Search, the quick views, the filter pills and the chips for what is on. */
import { Bookmark } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Chip as Tag, ICON, PillMenu, PopMenu, SearchField, Segmented, type PillOption } from "../_design/ui";
import { FilterRow, Grow, MenuItem, MenuLine, Row, Text, Toolbar } from "../_design/ui-page";
import { ALL_MODELS, CATEGORIES, INTEGRATIONS, categoryById, integrationById, modelById, type CategoryId, type ModelId } from "../_data/catalog";
import type { PortalUser } from "../_data/users";
import { matchesHierarchy } from "../_components/hierarchy-filter";
import { NO_FILTERS, type SavedView, type UserFilters } from "../_components/portal-store";
import { QUICK, type Quick } from "./users-model";

const ACTIVE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "over1d", label: "Over a day ago" },
  { value: "over7", label: "Over 2 days ago" },
];
const ISSUE_LABEL: Record<string, string> = { any: "Has issues", none: "No issues", relink: "Needs relink", stale: "Stale pairing" };
const STATE_LABEL: Record<string, string> = { online: "Has a device online", offline: "All devices offline" };

const withAll = (options: PillOption[]) => [{ value: "all", label: "All" }, ...options];

interface Chip {
  key: string;
  label: string;
  clear: Partial<UserFilters>;
}

function chipsOf(v: UserFilters): Chip[] {
  const chips: Chip[] = [];
  // Clearing a level clears what depends on it: Category, then Integration, then Model.
  if (v.category !== "all") chips.push({ key: "category", label: categoryById(v.category as CategoryId).name, clear: { category: "all", integration: "all", model: "all" } });
  if (v.integration !== "all") chips.push({ key: "integration", label: integrationById(v.integration)?.name ?? v.integration, clear: { integration: "all", model: "all" } });
  if (v.model !== "all") chips.push({ key: "model", label: modelById(v.model as ModelId).name, clear: { model: "all" } });
  if (v.firmware !== "all") chips.push({ key: "firmware", label: `Firmware ${v.firmware}`, clear: { firmware: "all" } });
  if (v.active !== "all") chips.push({ key: "active", label: `Active: ${ACTIVE_OPTIONS.find((a) => a.value === v.active)?.label}`, clear: { active: "all" } });
  if (v.issues !== "all") chips.push({ key: "issues", label: ISSUE_LABEL[v.issues] ?? v.issues, clear: { issues: "all" } });
  if (v.status !== "all") chips.push({ key: "status", label: STATE_LABEL[v.status] ?? v.status, clear: { status: "all" } });
  return chips;
}

export function UsersToolbar({
  users,
  filters,
  quick,
  views,
  onFilters,
  onQuick,
  onView,
  onSaveView,
}: {
  users: PortalUser[];
  filters: UserFilters;
  quick: Quick;
  views: SavedView[];
  onFilters: (patch: Partial<UserFilters>) => void;
  onQuick: (quick: Quick) => void;
  onView: (view: SavedView) => void;
  onSaveView: () => void;
}) {
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

  const count = (level: Partial<Pick<UserFilters, "category" | "integration" | "model">>) =>
    users.filter((u) => u.devices.some((d) => matchesHierarchy(d.modelId, { category: "all", integration: "all", model: "all", ...level }))).length;
  const integrations = INTEGRATIONS.filter((i) => filters.category === "all" || i.categoryId === filters.category);
  const modelIds = new Set(integrations.filter((i) => filters.integration === "all" || i.id === filters.integration).flatMap((i) => i.models.map((m) => m.id)));
  const models = ALL_MODELS.filter((m) => modelIds.has(m.id));
  const firmware = [...new Set(users.flatMap((u) => u.devices.map((d) => d.firmware)))].sort().reverse();
  const chips = chipsOf(filters);
  const filtered = chips.length > 0 || filters.q !== "";

  return (
    <Toolbar>
      <Row>
        <SearchField inputRef={search} value={filters.q} placeholder="Search" label="Search users" hint="⌘ K" onChange={(q) => onFilters({ q })} />
        <Segmented label="Quick views" options={QUICK.map((q) => q.label)} value={QUICK.findIndex((q) => q.key === quick)} onChange={(i) => onQuick(QUICK[i].key)} />
      </Row>
      <FilterRow>
        <Text kind="muted">Filter by</Text>
        <PillMenu
          label="Category"
          value={filters.category}
          options={withAll(CATEGORIES.map((c) => ({ value: c.id, label: c.name, count: count({ category: c.id }) })).filter((c) => c.count > 0))}
          onChange={(category) => onFilters({ category, integration: "all", model: "all" })}
        />
        <PillMenu
          label="Integration"
          value={filters.integration}
          options={withAll(integrations.map((i) => ({ value: i.id, label: i.name, count: count({ integration: i.id }) })).filter((i) => i.count > 0))}
          onChange={(integration) => onFilters({ integration, model: "all" })}
        />
        <PillMenu
          label="Model"
          value={filters.model}
          options={withAll(models.map((m) => ({ value: m.id, label: m.name, count: count({ model: m.id }) })).filter((m) => m.count > 0))}
          onChange={(model) => onFilters({ model })}
        />
        <PillMenu label="Firmware" value={filters.firmware} options={withAll(firmware.map((v) => ({ value: v, label: v })))} onChange={(v) => onFilters({ firmware: v })} />
        <PillMenu label="Last active" value={filters.active} options={withAll(ACTIVE_OPTIONS)} onChange={(active) => onFilters({ active })} />
        <Grow />
        <PopMenu
          right
          label="Saved views"
          trigger={(open, toggle) => (
            <Button size="sm" haspopup="menu" expanded={open} onClick={toggle}>
              <Bookmark {...ICON} />
              Views
            </Button>
          )}
        >
          {(close) => (
            <>
              {views.map((view) => (
                <MenuItem
                  key={view.id}
                  onClick={() => {
                    onView(view);
                    close();
                  }}
                >
                  {view.name}
                </MenuItem>
              ))}
              {filtered && (
                <>
                  <MenuLine />
                  <MenuItem
                    onClick={() => {
                      onSaveView();
                      close();
                    }}
                  >
                    Save current
                  </MenuItem>
                </>
              )}
            </>
          )}
        </PopMenu>
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
