"use client";

/** Users: the figures for what is on screen, then find anyone, then one row per user. */
import { Download, SearchX, UserRoundX } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DAY_MS, activeWithin, hasIssues, hasStale, needsRelink, userDeliveries, userRate, LOW_RATE, type PortalUser } from "@/features/device-sdk/portal/view";
import { Button, ICON, StatCard } from "../_design/ui";
import { EmptyState, Page, PageHeader, StatRow } from "../_design/ui-page";
import { downloadCsv, fmt, portalNow } from "../_components/format";
import { usePortal } from "../_components/portal-store";
import { UserSheet } from "./users-sheet";
import { UsersTable } from "./users-table";
import { UsersToolbar } from "./users-toolbar";
import { NO_FILTERS, inQuick, matches, sortUsers, usersCsv, type Quick, type Sort, type UserFilters } from "./users-model";

export function UsersSection({ users }: { users: PortalUser[] }) {
  const { test } = usePortal();
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [quick, setQuick] = useState<Quick>("all");
  const [sort, setSort] = useState<Sort>({ key: "delivery", dir: -1 });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => sortUsers(users.filter((u) => matches(u, filters) && inQuick(u, quick)), sort), [users, filters, quick, sort]);
  const open = openId ? (users.find((u) => u.id === openId) ?? null) : null;
  const closeSheet = useCallback(() => setOpenId(null), []);
  const patch = (next: Partial<UserFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };
  const pickQuick = (next: Quick) => {
    setQuick(next);
    setPage(1);
  };

  const now = portalNow();
  const devices = rows.flatMap((u) => u.devices);
  const online = devices.filter((d) => d.state === "online").length;
  const relinks = rows.filter(needsRelink).length;
  const stale = rows.filter(hasStale).length;
  const low = rows.filter((u) => userDeliveries(u) > 0 && userRate(u) < LOW_RATE).length;
  const hasFilter = quick !== "all" || Object.entries(filters).some(([k, v]) => v !== NO_FILTERS[k as keyof UserFilters]);

  return (
    <Page fit overlays={open && <UserSheet user={open} onClose={closeSheet} />}>
      <PageHeader
        title="Users"
        test={test}
        action={
          <Button variant="ink" disabled={rows.length === 0} onClick={() => downloadCsv("users.csv", usersCsv(rows))}>
            <Download {...ICON} />
            Export
          </Button>
        }
      />

      <StatRow>
        <StatCard label="Total users" value={fmt(rows.length)} hint={rows.length === users.length ? "In this environment" : `of ${fmt(users.length)}`} />
        <StatCard label="Active 7d" value={fmt(activeWithin(rows, 7 * DAY_MS, now))} hint={`${fmt(activeWithin(rows, DAY_MS, now))} today`} />
        <StatCard label="Devices per user" value={rows.length ? (devices.length / rows.length).toFixed(1) : "0"} hint={`${fmt(devices.length)} devices, ${fmt(online)} online`} />
        <StatCard label="Users with issues" value={fmt(rows.filter(hasIssues).length)} hint={`${relinks} relink, ${stale} stale, ${low} low delivery`} pressed={quick === "attention"} onClick={() => pickQuick(quick === "attention" ? "all" : "attention")} />
      </StatRow>

      <UsersToolbar users={users} filters={filters} quick={quick} onFilters={patch} onQuick={pickQuick} />

      {rows.length === 0 ? (
        <EmptyState
          icon={hasFilter ? SearchX : UserRoundX}
          title={hasFilter ? "No users match" : "No users yet"}
          action={
            hasFilter && (
              <Button
                onClick={() => {
                  setFilters(NO_FILTERS);
                  pickQuick("all");
                }}
              >
                Clear filters
              </Button>
            )
          }
        />
      ) : (
        <UsersTable fill rows={rows} sort={sort} page={page} openId={openId} onSort={setSort} onPage={setPage} onOpen={setOpenId} />
      )}
    </Page>
  );
}
