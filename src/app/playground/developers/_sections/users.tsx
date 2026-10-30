"use client";

/** Users: an analytics strip over the filtered set, saved views, and one row per user. */
import { useMemo, useState } from "react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { pillButton } from "@/shared/ui/pill-button";
import { SearchField } from "@/shared/ui/search-field";
import { HierarchyFilter, matchesHierarchy } from "../_components/hierarchy-filter";
import { NO_FILTERS, usePortal, useUsers, type UserFilters } from "../_components/portal-store";
import { WEEK, activeWithin } from "../_components/stats";
import { Cell, Filter, PortalPage, RowList, Strip, fmt } from "../_components/ui";
import { UserHeaderRow, UserRow } from "../_components/user-row";
import { hasIssues, hasStale, needsRelink, type PortalUser } from "../_data/users";

function matches(u: PortalUser, f: UserFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !u.name.toLowerCase().includes(q) && !u.id.toLowerCase().includes(q) && !u.devices.some((d) => d.id.toLowerCase().includes(q))) return false;
  if (u.devices.length > 0 ? !u.devices.some((d) => matchesHierarchy(d.modelId, f)) : f.category !== "all" || f.integration !== "all" || f.model !== "all") return false;
  if (f.status === "online" && u.activeDeviceId === null) return false;
  if (f.status === "offline" && u.activeDeviceId !== null) return false;
  if (f.issues === "any" && !hasIssues(u)) return false;
  if (f.issues === "none" && hasIssues(u)) return false;
  if (f.issues === "relink" && !needsRelink(u)) return false;
  if (f.issues === "stale" && !hasStale(u)) return false;
  if (f.firmware !== "all" && !u.devices.some((d) => d.firmware === f.firmware)) return false;
  if (f.active === "today" && u.lastActiveMins > 1440) return false;
  if (f.active === "7d" && u.lastActiveMins > WEEK) return false;
  if (f.active === "over1d" && u.lastActiveMins <= 1440) return false;
  if (f.active === "over7" && u.lastActiveMins <= 2 * 1440) return false;
  return true;
}

export function UsersSection() {
  const { state, update } = usePortal();
  const users = useUsers();
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [view, setView] = useState("all");
  const set = (patch: Partial<UserFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setView("custom");
  };
  const rows = useMemo(() => users.filter((u) => matches(u, filters)), [users, filters]);
  const firmware = useMemo(() => [...new Set(users.flatMap((u) => u.devices.map((d) => d.firmware)))].sort().reverse(), [users]);
  const devices = rows.reduce((n, u) => n + u.devices.length, 0);
  const pick = (id: string) => {
    setView(id);
    setFilters(id === "all" ? NO_FILTERS : (state.savedViews.find((v) => v.id === id)?.filters ?? NO_FILTERS));
  };
  const saveView = () => {
    const id = `view_${state.savedViews.length + 1}`;
    const parts = [filters.model !== "all" ? filters.model : null, filters.issues !== "all" ? filters.issues : null, filters.status !== "all" ? filters.status : null].filter(Boolean);
    update((s) => ({ ...s, savedViews: [...s.savedViews, { id, name: parts.join(", ") || `View ${s.savedViews.length + 1}`, filters }] }));
    setView(id);
  };
  const views = [{ id: "all", name: "All users" }, ...state.savedViews];

  return (
    <PortalPage title="Users">
      <Strip label="Users analytics">
        <Cell label="Total users" value={fmt(rows.length)} of={rows.length !== users.length ? `of ${users.length}` : undefined} />
        <Cell label="Active, 7 days" value={fmt(activeWithin(rows, WEEK))} />
        <Cell label="Devices per user" value={rows.length ? (devices / rows.length).toFixed(1) : "0"} />
        <Cell label="Users with issues" value={fmt(rows.filter(hasIssues).length)} />
      </Strip>
      <div className="flex flex-wrap items-center gap-1.5">
        {views.map((v) => (
          <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => pick(v.id)} className={pillButton(view === v.id ? "ink" : "outline", "sm", { raise: false })}>
            {v.name}
          </button>
        ))}
        {view === "custom" && (
          <button type="button" className={cn(pillButton("quiet", "sm"))} onClick={saveView}>
            Save view
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <SearchField size="sm" value={filters.q} onChange={(q) => set({ q })} onClear={() => set({ q: "" })} placeholder="Search users" className="w-48" />
        <HierarchyFilter value={filters} onChange={(h) => set(h)} />
        <Filter label="Status" value={filters.status} options={[{ value: "all", label: "All" }, { value: "online", label: "Has a device online" }, { value: "offline", label: "All devices offline" }]} onChange={(status) => set({ status })} />
        <Filter
          label="Issues"
          value={filters.issues}
          options={[{ value: "all", label: "All" }, { value: "any", label: "Has issues" }, { value: "none", label: "No issues" }, { value: "relink", label: "Needs relink" }, { value: "stale", label: "Stale pairing" }]}
          onChange={(issues) => set({ issues })}
        />
        <Filter label="Firmware" value={filters.firmware} options={[{ value: "all", label: "All" }, ...firmware.map((f) => ({ value: f, label: f }))]} onChange={(fw) => set({ firmware: fw })} />
        <Filter
          label="Last active"
          value={filters.active}
          options={[{ value: "all", label: "All" }, { value: "today", label: "Today" }, { value: "7d", label: "Last 7 days" }, { value: "over1d", label: "Over a day ago" }, { value: "over7", label: "Over 2 days ago" }]}
          onChange={(active) => set({ active })}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState variant="outline" title="No users match these filters" />
      ) : (
        <div className="flex min-w-0 flex-col gap-1.5">
          <UserHeaderRow />
          <RowList>
            {rows.map((u) => (
              <UserRow key={u.id} user={u} />
            ))}
          </RowList>
        </div>
      )}
    </PortalPage>
  );
}
