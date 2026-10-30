"use client";

/** Users: the figures for what is on screen, then find anyone, then one row per user. */
import { Download, SearchX, UserRoundX } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import b from "../_design/base.module.css";
import { cx, ICON_100 } from "../_design/components";
import o from "../_design/surfaces.module.css";
import tokens from "../_design/tokens.module.css";
import { NO_FILTERS, useCalls, usePortal, useUsers, type SavedView, type UserFilters } from "../_components/portal-store";
import { WEEK, activeWithin } from "../_components/stats";
import { testDelivery } from "../_components/test-delivery";
import { fmt } from "../_components/ui";
import { hasIssues, hasStale, needsRelink, userDeliveries, userRate } from "../_data/users";
import { UserSheet } from "./users-sheet";
import { UsersTable } from "./users-table";
import { UsersToolbar } from "./users-toolbar";
import { inQuick, matches, sortUsers, usersCsv, type Quick, type Sort } from "./users-model";
import s from "./users.module.css";

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
    <div className={cx(s.root, tokens.scope, tokens.u100)}>
      <div className={s.scroller}>
        <div className={s.inner}>
          <header className={b.between}>
            <div className={b.row}>
              <h1 className={b.title}>Users</h1>
              {state.env === "test" && <span className={cx(b.badge, b.badgeWarn)}>Test data</span>}
            </div>
            <button type="button" className={cx(b.btn, rows.length === 0 && b.off)} onClick={exportCsv} disabled={rows.length === 0}>
              <Download {...ICON_100} />
              Export
            </button>
          </header>

          <div className={s.stats}>
            <div className={cx(b.card, s.stat)}>
              <span className={b.muted}>Total users</span>
              <span className={b.big}>{fmt(rows.length)}</span>
              <span className={b.smallMuted}>{rows.length === users.length ? plans.map(([p, n]) => `${n} ${p[0].toUpperCase()}${p.slice(1)}`).join(", ") : `of ${fmt(users.length)}`}</span>
            </div>
            <div className={cx(b.card, s.stat)}>
              <span className={b.muted}>Active 7d</span>
              <span className={b.big}>{fmt(activeWithin(rows, WEEK))}</span>
              <span className={b.smallMuted}>{fmt(activeWithin(rows, 1440))} today</span>
            </div>
            <div className={cx(b.card, s.stat)}>
              <span className={b.muted}>Devices per user</span>
              <span className={b.big}>{rows.length ? (devices.length / rows.length).toFixed(1) : "0"}</span>
              <span className={b.smallMuted}>
                {fmt(devices.length)} devices, {fmt(online)} online
              </span>
            </div>
            <button type="button" aria-pressed={quick === "attention"} className={cx(b.card, s.stat, s.statBtn, quick === "attention" && s.statOn)} onClick={() => pickQuick(quick === "attention" ? "all" : "attention")}>
              <span className={b.muted}>Users with issues</span>
              <span className={b.big}>{fmt(issues)}</span>
              <span className={b.smallMuted}>
                {relinks} relink, {stale} stale, {low} low success
              </span>
            </button>
          </div>

          <UsersToolbar users={users} filters={filters} quick={quick} views={state.savedViews} onFilters={patch} onQuick={pickQuick} onView={pickView} onSaveView={saveView} />

          {rows.length === 0 ? (
            <div className={b.card}>
              <div className={o.empty}>
                <span className={b.tile}>{hasFilter ? <SearchX {...ICON_100} /> : <UserRoundX {...ICON_100} />}</span>
                <span className={b.h3}>{hasFilter ? "No users match" : "No users yet"}</span>
                {hasFilter && (
                  <button
                    type="button"
                    className={b.btn}
                    onClick={() => {
                      setFilters(NO_FILTERS);
                      pickQuick("all");
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            </div>
          ) : (
            <UsersTable rows={rows} sort={sort} page={page} openId={openId} onSort={setSort} onPage={setPage} onOpen={setOpenId} />
          )}
        </div>
      </div>
      {open && <UserSheet user={open} calls={calls} onClose={closeSheet} onSendTest={sendTest} onRelink={relinkLink} />}
      {notice && (
        <div role="status" className={cx(o.toast, o.toastBlack, s.notice)}>
          <span className={b.onInk}>{notice}</span>
        </div>
      )}
    </div>
  );
}
