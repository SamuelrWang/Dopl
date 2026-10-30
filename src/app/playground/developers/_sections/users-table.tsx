"use client";

/** One row per user: who they are, what they own, how delivery is going. Row opens the sheet. */
import { ArrowDown, ArrowUp, Bot, Car, ChevronLeft, ChevronRight, ChevronsUpDown, Glasses, Home, Monitor, Smartphone, type LucideIcon } from "lucide-react";
import { createElement } from "react";
import b from "../_design/base.module.css";
import { cx, ICON_100, ICON_100_SM, Initials } from "../_design/components";
import o from "../_design/surfaces.module.css";
import { modelById, type CategoryId } from "../_data/catalog";
import { ownedDevice, userDeliveries, userRate, type DeviceState, type OwnedDevice, type PortalUser } from "../_data/users";
import { since } from "../_components/ui";
import { FIRST_DIR, STATUS_LABELS, categoryIdOf, devicesInOrder, initialsOf, statusOf, type Sort, type SortKey, type Status } from "./users-model";
import s from "./users.module.css";

export const PAGE_SIZE = 10;
const GLYPH: Record<CategoryId, LucideIcon> = { glasses: Glasses, desktop: Monitor, phone: Smartphone, vehicle: Car, home: Home, robots: Bot };

export function DeviceGlyph({ device, size }: { device: OwnedDevice; size: typeof ICON_100 | typeof ICON_100_SM }) {
  return createElement(GLYPH[categoryIdOf(device.modelId)], { ...size, className: b.iconSoft });
}

export const DOT: Record<DeviceState, string> = { online: s.dotOnline, offline: s.dotOffline, stale: s.dotWarn, needs_relink: s.dotError };
const BADGE: Record<Status, string | undefined> = { online: b.badgeOk, offline: undefined, stale: b.badgeWarn, relink: b.badgeError };

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={cx(b.badge, BADGE[status])}>
      <span className={b.dot} />
      {STATUS_LABELS[status]}
    </span>
  );
}

function DeviceChip({ device }: { device: OwnedDevice }) {
  return (
    <span className={s.deviceChip} title={device.name}>
      <DeviceGlyph device={device} size={ICON_100_SM} />
      <span className={s.deviceChipName}>{modelById(device.modelId).name}</span>
      <span className={cx(s.stateDot, DOT[device.state])} />
    </span>
  );
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "User" },
  { key: "devices", label: "Devices" },
  { key: "active", label: "Active device" },
  { key: "delivery", label: "Last delivery" },
  { key: "success", label: "Success" },
  { key: "status", label: "Status" },
];

function Row({ user, open, onOpen }: { user: PortalUser; open: boolean; onOpen: () => void }) {
  const active = user.activeDeviceId ? ownedDevice(user.activeDeviceId) : null;
  const delivered = userDeliveries(user) > 0;
  const rate = userRate(user);
  const devices = devicesInOrder(user);
  return (
    <tr className={cx(s.row, open && s.rowOpen)} onClick={onOpen}>
      <td className={s.td}>
        <div className={b.row}>
          <Initials text={initialsOf(user.name)} />
          <div className={b.tight}>
            <button type="button" className={cx(b.reset, b.strong, s.name)} aria-haspopup="dialog">
              {user.name}
            </button>
            <span className={cx(b.smallMuted, s.ellipsis)}>{user.id}</span>
          </div>
        </div>
      </td>
      <td className={s.td}>
        <div className={s.devices}>
          {devices.slice(0, 2).map((d) => (
            <DeviceChip key={d.id} device={d} />
          ))}
          {devices.length > 2 && <span className={s.moreChip}>+{devices.length - 2}</span>}
          {devices.length === 0 && <span className={b.faint}>None</span>}
        </div>
      </td>
      <td className={s.td}>
        <span className={cx(active ? b.text : b.faint, s.ellipsis)}>{active ? active.name : "None"}</span>
      </td>
      <td className={s.td}>
        <span className={cx(b.text, b.nowrap)}>{since(user.lastDeliveryAt)}</span>
      </td>
      <td className={s.td}>
        {delivered ? (
          <div className={s.success}>
            <span className={cx(b.strong, b.num)}>{rate}%</span>
            <span className={o.bar}>
              <span className={cx(o.barFill, rate < 90 && s.barLow)} style={{ width: `${rate}%` }} />
            </span>
          </div>
        ) : (
          <span className={b.faint}>None</span>
        )}
      </td>
      <td className={s.td}>
        <StatusBadge status={statusOf(user)} />
      </td>
      <td className={cx(s.td, s.tdEnd)}>
        <ChevronRight {...ICON_100} className={b.iconSoft} />
      </td>
    </tr>
  );
}

function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) {
  const near = Array.from({ length: pages }, (_, i) => i + 1).filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1);
  return (
    <nav className={o.pager} aria-label="Pages">
      <button type="button" className={cx(o.page, o.pageBtn, o.pageRing, page === 1 && o.pageOff)} disabled={page === 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>
        <ChevronLeft {...ICON_100} />
      </button>
      {near.map((p, i) => (
        <span key={p} className={b.row}>
          {i > 0 && p - near[i - 1] > 1 && <span className={o.page}>…</span>}
          <button type="button" aria-current={p === page ? "page" : undefined} className={cx(o.page, o.pageBtn, p === page && o.pageOn)} onClick={() => onPage(p)}>
            {p}
          </button>
        </span>
      ))}
      <button type="button" className={cx(o.page, o.pageBtn, o.pageRing, page === pages && o.pageOff)} disabled={page === pages} aria-label="Next page" onClick={() => onPage(page + 1)}>
        <ChevronRight {...ICON_100} />
      </button>
    </nav>
  );
}

export function UsersTable({
  rows,
  sort,
  page,
  openId,
  onSort,
  onPage,
  onOpen,
}: {
  rows: PortalUser[];
  sort: Sort;
  page: number;
  openId: string | null;
  onSort: (sort: Sort) => void;
  onPage: (page: number) => void;
  onOpen: (id: string) => void;
}) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const first = (current - 1) * PAGE_SIZE;
  const visible = rows.slice(first, first + PAGE_SIZE);
  return (
    <div className={cx(b.card, b.flush)}>
      <table className={s.table}>
        <colgroup>
          <col className={s.colUser} />
          <col className={s.colDevices} />
          <col className={s.colActive} />
          <col className={s.colDelivery} />
          <col className={s.colSuccess} />
          <col className={s.colStatus} />
          <col className={s.colEnd} />
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map(({ key, label }) => {
              const on = sort.key === key;
              const Icon = !on ? ChevronsUpDown : sort.dir === 1 ? ArrowUp : ArrowDown;
              return (
                <th key={key} scope="col" className={s.th} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" className={cx(s.sortBtn, on && s.sortOn)} onClick={() => onSort({ key, dir: on ? (sort.dir === 1 ? -1 : 1) : FIRST_DIR[key] })}>
                    {label}
                    <Icon {...ICON_100_SM} className={on ? b.iconInk : b.iconSoft} />
                  </button>
                </th>
              );
            })}
            <th scope="col" className={s.th} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {visible.map((u) => (
            <Row key={u.id} user={u} open={openId === u.id} onOpen={() => onOpen(u.id)} />
          ))}
        </tbody>
      </table>
      <div className={s.tableFoot}>
        <span className={cx(b.muted, b.num)}>
          {first + 1} to {first + visible.length} of {rows.length}
        </span>
        {pages > 1 && <Pager page={current} pages={pages} onPage={onPage} />}
      </div>
    </div>
  );
}
