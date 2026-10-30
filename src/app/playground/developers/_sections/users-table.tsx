"use client";

/** One row per user: who they are, what they own, how delivery is going. Row opens the sheet. */
import { ChevronRight } from "lucide-react";
import { Badge, Card, DataCell, DataRow, DataTable, ICON, ICON_SM, Initials, MeterFigure, StateDot, TwoLine, initialsOf, type Column, type Tone } from "../_design/ui";
import { Pager, PlainButton, TableFoot, Text } from "../_design/ui-page";
import { modelById } from "../_data/catalog";
import { ownedDevice, userDeliveries, userRate, type DeviceState, type OwnedDevice, type PortalUser } from "../_data/users";
import { CategoryGlyph } from "../_components/category-glyph";
import { since } from "../_components/ui";
import { FIRST_DIR, STATUS_LABELS, categoryIdOf, devicesInOrder, statusOf, type Sort, type SortKey, type Status } from "./users-model";

export const PAGE_SIZE = 10;

export function DeviceGlyph({ device, size }: { device: OwnedDevice; size: typeof ICON | typeof ICON_SM }) {
  return <CategoryGlyph id={categoryIdOf(device.modelId)} size={size} />;
}

export const DOT: Record<DeviceState, "ok" | "off" | "warn" | "error"> = { online: "ok", offline: "off", stale: "warn", needs_relink: "error" };
const STATUS_TONE: Record<Status, Tone> = { online: "ok", offline: "neutral", stale: "warn", relink: "error" };

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

function DeviceChip({ device }: { device: OwnedDevice }) {
  return (
    <Badge title={device.name}>
      <DeviceGlyph device={device} size={ICON_SM} />
      {modelById(device.modelId).name}
      <StateDot tone={DOT[device.state]} />
    </Badge>
  );
}

const COLUMNS: Column[] = [
  { key: "name", label: "User", width: "23%", sortable: true },
  { key: "devices", label: "Devices", width: "26%", sortable: true },
  { key: "active", label: "Active device", width: "15%", sortable: true },
  { key: "delivery", label: "Last delivery", width: "12%", sortable: true },
  { key: "success", label: "Success", width: "11%", sortable: true },
  { key: "status", label: "Status", width: "11%", sortable: true },
  { key: "open", srLabel: "Open", width: "calc(75 * var(--u))" },
];

function UserRow({ user, open, onOpen }: { user: PortalUser; open: boolean; onOpen: () => void }) {
  const active = user.activeDeviceId ? ownedDevice(user.activeDeviceId) : null;
  const delivered = userDeliveries(user) > 0;
  const rate = userRate(user);
  const devices = devicesInOrder(user);
  return (
    <DataRow selected={open} onClick={onOpen}>
      <DataCell>
        <Initials text={initialsOf(user.name)} />
        <TwoLine title={<PlainButton haspopup="dialog">{user.name}</PlainButton>} sub={user.id} />
      </DataCell>
      <DataCell>
        {devices.slice(0, 2).map((d) => (
          <DeviceChip key={d.id} device={d} />
        ))}
        {devices.length > 2 && <Badge tone="ring">+{devices.length - 2}</Badge>}
        {devices.length === 0 && <Text kind="faint">None</Text>}
      </DataCell>
      <DataCell>
        <Text kind={active ? "text" : "faint"} clip>
          {active ? active.name : "None"}
        </Text>
      </DataCell>
      <DataCell>
        <Text nowrap>{since(user.lastDeliveryAt)}</Text>
      </DataCell>
      <DataCell>{delivered ? <MeterFigure value={rate} low={rate < 90} /> : <Text kind="faint">None</Text>}</DataCell>
      <DataCell>
        <StatusBadge status={statusOf(user)} />
      </DataCell>
      <DataCell align="end">
        <ChevronRight {...ICON} aria-hidden="true" />
      </DataCell>
    </DataRow>
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
  const toggle = (key: string) => {
    const k = key as SortKey;
    onSort({ key: k, dir: sort.key === k ? (sort.dir === 1 ? -1 : 1) : FIRST_DIR[k] });
  };
  return (
    <Card flush>
      <DataTable columns={COLUMNS} sort={sort} onSort={toggle}>
        {visible.map((u) => (
          <UserRow key={u.id} user={u} open={openId === u.id} onOpen={() => onOpen(u.id)} />
        ))}
      </DataTable>
      <TableFoot>
        <Text kind="muted" num>
          {first + 1} to {first + visible.length} of {rows.length}
        </Text>
        {pages > 1 && <Pager page={current} pages={pages} onPage={onPage} />}
      </TableFoot>
    </Card>
  );
}
