import { useState } from "react";
import { ArrowRight, Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusPill } from "@/shared/ui/status-pill";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import type { ConnectedDevice } from "@/features/devices/types";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { pillButton } from "@/shared/ui/pill-button";
import { devicePresence } from "@/features/devices/merge";
import {
  EMPTY_PREVIEW_LIST,
  type OverviewPreview,
  type PreviewDevice,
  type PreviewPresence,
} from "@/features/home/preview-types";
import { Presence } from "./overview-agents";
import { OverviewCard } from "./overview-card";
import { GhostRows } from "./overview-skeleton";
import type { HomeOverviewReads } from "./use-home-overview-reads";
import styles from "./overview.module.css";
import parts from "./overview-preview.module.css";

/** One Devices row: a real device with any preview detail laid over it, or a preview-only one. */
export interface DeviceView {
  key: string;
  kind: string;
  name: string;
  meta: string;
  current: boolean;
  inUse: boolean;
  battery: number | undefined;
  /** A preview presence replaces the real one. */
  status: PreviewPresence | undefined;
  online: boolean;
  presence: string;
}

function metaOf(model: string | undefined, through: string | undefined): string {
  return [model, through ? `through ${through}` : null].filter(Boolean).join(" · ");
}

/** The real list, each row dressed by the preview entry naming its id or name; unmatched entries
 *  with a kind follow as their own rows. */
export function deviceViews(
  devices: readonly ConnectedDevice[],
  detail: readonly PreviewDevice[]
): DeviceView[] {
  const used = new Set<PreviewDevice>();
  const views = devices.map((device): DeviceView => {
    const extra = detail.find((entry) => entry.device === device.id || entry.device === device.name);
    if (extra) used.add(extra);
    const ownMeta = [device.platformLabel, device.appVersion ? `Dopl ${device.appVersion}` : null]
      .filter(Boolean)
      .join(" · ");
    return {
      key: `${device.kind}:${device.id}`,
      kind: device.kind,
      name: device.name,
      meta: extra?.model || extra?.through ? metaOf(extra.model ?? ownMeta, extra.through) : ownMeta,
      current: Boolean(device.current),
      inUse: Boolean(extra?.inUse),
      battery: extra?.battery,
      status: extra?.status,
      online: device.online,
      presence: devicePresence(device, formatRelativeTime(device.lastSeen)),
    };
  });
  const extras = detail
    .filter((entry) => !used.has(entry) && entry.kind)
    .map(
      (entry): DeviceView => ({
        key: `preview:${entry.device}`,
        kind: entry.kind ?? "other",
        name: entry.device,
        meta: metaOf(entry.model, entry.through),
        current: false,
        inUse: Boolean(entry.inUse),
        battery: entry.battery,
        status: entry.status ?? "offline",
        online: entry.status === "online",
        presence: "",
      })
    );
  return [...views, ...extras];
}

export function onlineCount(views: readonly DeviceView[]): number {
  return views.filter((view) => (view.status ? view.status === "online" : view.online)).length;
}

function DeviceRow({ view }: { view: DeviceView }) {
  return (
    <li className={styles.row}>
      <span className={styles.mark} data-shape="tile" aria-hidden="true">
        <DeviceKindIcon kind={view.kind} size={13} strokeWidth={1.8} />
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          {view.name}
          {view.current && <span className={styles.tag}>This computer</span>}
          {view.inUse && <span className={cn(styles.tag, parts.live)}>In use</span>}
        </span>
        {view.meta && <span className={styles.rowMeta}>{view.meta}</span>}
      </span>
      {view.battery !== undefined && <span className={styles.mono}>{view.battery}%</span>}
      {view.status ? (
        <Presence status={view.status} />
      ) : (
        <StatusPill bare dot tone={view.online ? "live" : "neutral"}>
          {view.presence}
        </StatusPill>
      )}
    </li>
  );
}

function ReachOrder({ order, waitSeconds, views }: { order: readonly string[]; waitSeconds: number; views: readonly DeviceView[] }) {
  return (
    <ol className={parts.chain} aria-label="Reach order">
      {order.map((name, i) => (
        <li key={`${name}-${i}`} className={parts.step} data-first={i === 0 || undefined}>
          {i > 0 && (
            <span className={parts.wait} aria-label={`after ${waitSeconds} seconds`}>
              <ArrowRight size={11} aria-hidden="true" />
              {waitSeconds}s
            </span>
          )}
          <span className={styles.mark} data-shape="tile" aria-hidden="true">
            <DeviceKindIcon kind={views.find((view) => view.name === name)?.kind ?? "other"} size={13} strokeWidth={1.8} />
          </span>
          <span className={parts.stepName}>{name}</span>
        </li>
      ))}
    </ol>
  );
}

const ADD_KINDS = [
  { kind: "computer", label: "Mac" },
  { kind: "glasses", label: "Glasses" },
  { kind: "phone", label: "Phone" },
  { kind: "other", label: "Other" },
] as const;

/** The kind picker; a non-computer kind shows the account's pairing code and opens pairing. */
function AddDevice({ pairingCode, onPair, onClose }: { pairingCode: string; onPair: () => void; onClose: () => void }) {
  const [kind, setKind] = useState<string | null>(null);
  return (
    <div className={parts.add} role="group" aria-label="Add a device">
      <div className={parts.kinds}>
        {ADD_KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className={parts.kind}
            aria-pressed={kind === option.kind}
            onClick={() => setKind(option.kind)}
          >
            <span className={styles.mark} data-shape="tile" aria-hidden="true">
              <DeviceKindIcon kind={option.kind} size={13} strokeWidth={1.8} />
            </span>
            {option.label}
          </button>
        ))}
        <button type="button" className={cn(NAKED_ICON_BUTTON, "ml-auto p-1")} aria-label="Close add device" onClick={onClose}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {kind === "computer" && <p className={styles.note}>Sign in to Dopl on the new Mac.</p>}
      {kind && kind !== "computer" && (
        <div className={parts.pair}>
          <span className={styles.note}>Pairing code</span>
          <span className={parts.code}>{pairingCode}</span>
          <button type="button" className={pillButton("outline", "sm")} onClick={onPair}>
            Pair
          </button>
        </div>
      )}
    </div>
  );
}

/** Every device the operator's agents reach them through. Pairing lives in Settings › Devices. */
export function DevicesCard({
  devices: { devices, failed },
  preview,
  onAddDevice,
}: {
  devices: HomeOverviewReads["devices"];
  preview: OverviewPreview | null;
  onAddDevice: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const views = devices ? deviceViews(devices, preview?.devices ?? EMPTY_PREVIEW_LIST) : null;
  const online = views ? onlineCount(views) : 0;
  const pairingCode = preview?.addDevice?.pairingCode;
  return (
    <OverviewCard
      title="Devices"
      count={views && !failed ? `${online}/${views.length} online` : undefined}
      aside={
        <button
          type="button"
          className={pillButton("outline", "sm")}
          aria-expanded={pairingCode ? adding : undefined}
          onClick={pairingCode ? () => setAdding((open) => !open) : onAddDevice}
        >
          <Plus size={12} aria-hidden="true" />
          Add device
        </button>
      }
    >
      {adding && pairingCode && (
        <AddDevice pairingCode={pairingCode} onPair={onAddDevice} onClose={() => setAdding(false)} />
      )}
      {failed && <p className={styles.note}>Couldn&apos;t load your computers.</p>}
      {views && preview?.reachOrder && (
        <ReachOrder order={preview.reachOrder} waitSeconds={preview.reachWaitSeconds ?? 30} views={views} />
      )}
      {views === null ? (
        <GhostRows count={2} leading="square" />
      ) : views.length === 0 ? (
        !failed && <EmptyState variant="outline" title="No devices yet" />
      ) : (
        <ul className={styles.rows}>
          {views.map((view) => (
            <DeviceRow key={view.key} view={view} />
          ))}
        </ul>
      )}
    </OverviewCard>
  );
}
