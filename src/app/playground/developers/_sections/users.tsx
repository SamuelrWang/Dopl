"use client";

/** Users: the figures for what is on screen, then find anyone, then one row per user. */
import { Download, SearchX, UserRoundX } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Button, ICON, StatCard } from "../_design/ui";
import { EmptyState, Page, PageHeader, StatRow, Toast } from "../_design/ui-page";
import { NO_FILTERS, useCalls, usePortal, useUsers, type SavedView, type UserFilters } from "../_components/portal-store";
import { WEEK, activeWithin } from "../_components/stats";
import { testDelivery } from "../_components/test-delivery";
import { fmt } from "../_components/ui";
import { hasIssues, hasStale, needsRelink, userDeliveries, userRate } from "../_data/users";
import { UserSheet } from "./users-sheet";
import { UsersTable } from "./users-table";
import { UsersToolbar } from "./users-toolbar";
import { inQuick, matches, sortUsers, usersCsv, type Quick, type Sort } from "./users-model";

const LOW_SUCCESS = 90;

export function UsersSection() {
  const { state, update } = usePortal();
  const users = useUsers();
  const calls = useCalls();
  const [filters, setFilters] = useState<UserFilters>(NO_FILTERS);
  const [quick, setQuick] = useState<Quick>("all");
  const [sort, setSort] = useState<Sort>({ key: "delivery", dir: -1 });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => sortUsers(users.filter((u) => matches(u, filters) && inQuick(u, quick)), sort), [users, filters, quick, sort]);
  const open = openId ? (users.find((u) => u.id === openId) ?? null) : null;
  const closeSheet = useCallback(() => setOpenId(null), []);

  const say = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((now) => (now === text ? null : now)), 3200);
  };
  const patch = (next: Partial<UserFilters>) => {
    setFilters((f) => ({ ...f, ...next }));
    setPage(1);
  };
  const pickQuick = (next: Quick) => {
    setQuick(next);
    setPage(1);
  };
  const pickView = (view: SavedView) => {
    setFilters(view.filters);
    setQuick("all");
    setPage(1);
  };
  const saveView = () => {
    const n = state.savedViews.length + 1;
    update((st) => ({ ...st, savedViews: [...st.savedViews, { id: `view_${n}`, name: filters.q || `View ${n}`, filters }] }));
    say("View saved");
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([usersCsv(rows)], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "users.csv";
    link.click();
    URL.revokeObjectURL(url);
    say(`Exported ${rows.length} users`);
  };
  const sendTest = () => {
    if (!open) return;
    const target = open.devices.find((d) => d.id === open.activeDeviceId) ?? open.devices[0];
    const call = testDelivery(open, target, "Active device, seen within the online window");
    update((st) => ({ ...st, sentCalls: [call, ...st.sentCalls] }));
    say(`Sent to ${target?.name ?? open.name}`);
  };
  const relinkLink = () => {
    if (!open) return;
    void navigator.clipboard?.writeText(`https://connect.larkfield.example/r/${open.id}`);
    say("Relink link copied");
  };

  const devices = rows.flatMap((u) => u.devices);
  const online = devices.filter((d) => d.state === "online").length;
  const relinks = rows.filter(needsRelink).length;
  const stale = rows.filter(hasStale).length;
  const low = rows.filter((u) => userDeliveries(u) > 0 && userRate(u) < LOW_SUCCESS).length;
  const issues = rows.filter(hasIssues).length;
  const plans = (["team", "pro", "free"] as const).map((p) => [p, rows.filter((u) => u.plan === p).length] as const).filter(([, n]) => n > 0);
  const hasFilter = quick !== "all" || Object.entries(filters).some(([k, v]) => v !== NO_FILTERS[k as keyof UserFilters]);

  return (
    <Page
      fit
      overlays={
        <>
          {open && <UserSheet user={open} calls={calls} onClose={closeSheet} onSendTest={sendTest} onRelink={relinkLink} />}
          {notice && <Toast>{notice}</Toast>}
        </>
      }
    >
      <PageHeader
        title="Users"
        test={state.env === "test"}
        action={
          <Button disabled={rows.length === 0} onClick={exportCsv}>
            <Download {...ICON} />
            Export
          </Button>
        }
      />

      <StatRow>
        <StatCard label="Total users" value={fmt(rows.length)} hint={rows.length === users.length ? plans.map(([p, n]) => `${n} ${p[0].toUpperCase()}${p.slice(1)}`).join(", ") : `of ${fmt(users.length)}`} />
        <StatCard label="Active 7d" value={fmt(activeWithin(rows, WEEK))} hint={`${fmt(activeWithin(rows, 1440))} today`} />
        <StatCard label="Devices per user" value={rows.length ? (devices.length / rows.length).toFixed(1) : "0"} hint={`${fmt(devices.length)} devices, ${fmt(online)} online`} />
        <StatCard label="Users with issues" value={fmt(issues)} hint={`${relinks} relink, ${stale} stale, ${low} low success`} pressed={quick === "attention"} onClick={() => pickQuick(quick === "attention" ? "all" : "attention")} />
      </StatRow>

      <UsersToolbar users={users} filters={filters} quick={quick} views={state.savedViews} onFilters={patch} onQuick={pickQuick} onView={pickView} onSaveView={saveView} />

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
