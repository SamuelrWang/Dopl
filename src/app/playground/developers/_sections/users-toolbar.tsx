"use client";

/** Search, the quick views, the filter pills and the chips for what is on. */
import { Bookmark, Search, X } from "lucide-react";
import { useEffect, useRef } from "react";
import b from "../_design/base.module.css";
import { cx, ICON_100, ICON_100_SM } from "../_design/components";
import f from "../_design/forms.module.css";
import { PillMenu, PopMenu, Segmented, type PillOption } from "../_design/interactive";
import p from "../_design/page.module.css";
import o from "../_design/surfaces.module.css";
import { ALL_MODELS, CATEGORIES, INTEGRATIONS, categoryById, integrationById, modelById, type CategoryId, type ModelId } from "../_data/catalog";
import type { PortalUser } from "../_data/users";
import { matchesHierarchy } from "../_components/hierarchy-filter";
import { NO_FILTERS, type SavedView, type UserFilters } from "../_components/portal-store";
import { QUICK, type Quick } from "./users-model";
import s from "./users.module.css";

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
    <div className={cx(b.card, p.toolbar)}>
      <div className={b.row}>
        <label className={cx(f.field, s.search)}>
          <Search {...ICON_100} className={b.iconInk} />
          <input ref={search} className={f.fieldInput} placeholder="Search" aria-label="Search users" value={filters.q} onChange={(e) => onFilters({ q: e.target.value })} />
          {filters.q ? (
            <button type="button" className={b.reset} aria-label="Clear search" onClick={() => onFilters({ q: "" })}>
              <X {...ICON_100} className={b.iconSoft} />
            </button>
          ) : (
            <span className={b.kbd}>⌘ K</span>
          )}
        </label>
        <Segmented label="Quick views" options={QUICK.map((q) => q.label)} value={QUICK.findIndex((q) => q.key === quick)} onChange={(i) => onQuick(QUICK[i].key)} />
      </div>
      <div className={p.filterRow}>
        <span className={b.muted}>Filter by</span>
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
        <span className={b.grow} />
        <PopMenu
          right
          label="Saved views"
          trigger={(open, toggle) => (
            <button type="button" aria-haspopup="menu" aria-expanded={open} className={cx(b.btn, b.sm, s.viewsBtn)} onClick={toggle}>
              <Bookmark {...ICON_100_SM} />
              Views
            </button>
          )}
        >
          {(close) => (
            <>
              {views.map((view) => (
                <button
                  key={view.id}
                  type="button"
                  role="menuitem"
                  className={cx(o.item, o.itemBtn)}
                  onClick={() => {
                    onView(view);
                    close();
                  }}
                >
                  {view.name}
                </button>
              ))}
              {filtered && (
                <>
                  <div className={o.menuLine} />
                  <button
                    type="button"
                    role="menuitem"
                    className={cx(o.item, o.itemBtn)}
                    onClick={() => {
                      onSaveView();
                      close();
                    }}
                  >
                    Save current
                  </button>
                </>
              )}
            </>
          )}
        </PopMenu>
      </div>
      {chips.length > 0 && (
        <div className={p.filterRow}>
          {chips.map((chip) => (
            <span key={chip.key} className={cx(f.tag, p.chip)}>
              {chip.label}
              <button type="button" className={b.reset} aria-label={`Remove ${chip.label}`} onClick={() => onFilters(chip.clear)}>
                <X {...ICON_100_SM} className={b.iconSoft} />
              </button>
            </span>
          ))}
          <button type="button" className={cx(b.btn, b.ghost, b.sm)} onClick={() => onFilters({ ...NO_FILTERS, q: filters.q })}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
