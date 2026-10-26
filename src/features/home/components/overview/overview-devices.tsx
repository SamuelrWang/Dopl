import { Plus } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusPill } from "@/shared/ui/status-pill";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import type { ConnectedDevice } from "@/features/devices/types";
import { CARD_PILL, OverviewCard } from "./overview-card";
import { GhostRows } from "./overview-skeleton";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import styles from "./overview.module.css";

function DeviceRow({ device }: { device: ConnectedDevice }) {
  const meta = [device.platformLabel, device.appVersion ? `Dopl ${device.appVersion}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className={styles.row}>
      <span className={styles.mark} data-shape="tile" aria-hidden="true">
        <DeviceKindIcon kind={device.kind} size={13} strokeWidth={1.8} />
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          {device.name}
          {device.current && <span className={styles.tag}>This computer</span>}
        </span>
        {meta && <span className={styles.rowMeta}>{meta}</span>}
      </span>
      {device.online ? (
        <StatusPill bare dot tone="live">
          Online
        </StatusPill>
      ) : (
        <StatusPill bare dot>
          {device.lastSeen ? formatRelativeTime(device.lastSeen) : "Offline"}
        </StatusPill>
      )}
    </li>
  );
}

/** Every device the operator's agents reach them through. Pairing lives in Settings › Devices. */
export function DevicesCard({
  devices: { devices, failed },
  onAddDevice,
}: {
  devices: HomeOverviewReads["devices"];
  onAddDevice: () => void;
}) {
  const online = devices?.filter((device) => device.online).length ?? 0;
  return (
    <OverviewCard
      title="Devices"
      count={devices && !failed ? `${online}/${devices.length} online` : undefined}
      aside={
        <button type="button" className={CARD_PILL} onClick={onAddDevice}>
          <Plus size={12} aria-hidden="true" />
          Add device
        </button>
      }
    >
      {failed && <p className={styles.note}>Couldn&apos;t load your computers.</p>}
      {devices === null ? (
        <GhostRows count={2} leading="square" />
      ) : devices.length === 0 ? (
        !failed && <EmptyState variant="outline" title="No devices yet" />
      ) : (
        <ul className={styles.rows}>
          {devices.map((device) => (
            <DeviceRow key={`${device.kind}:${device.id}`} device={device} />
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}
