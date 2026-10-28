import { Fragment, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { EmptyState } from "@/shared/ui/empty-state";
import { NAKED_ICON_BUTTON } from "@/shared/ui/naked-icon-button";
import { pillButton } from "@/shared/ui/pill-button";
import { DeviceKindIcon } from "@/features/devices/components/device-glyph";
import { EMPTY_PREVIEW_LIST, type OverviewPreview, type PreviewPresence } from "@/features/home/preview-types";
import { deviceViews, onlineCount, type DeviceView } from "@/features/home/components/overview/overview-devices";
import { GhostRows } from "@/features/home/components/overview/overview-skeleton";
import type { HomeOverviewReads } from "@/features/home/components/overview/use-home-overview-reads";
import { Section } from "./proposed-section";
import styles from "./proposed.module.css";

const PRESENCE_WORD: Record<PreviewPresence, string> = { online: "Online", away: "Away", offline: "Offline" };

/** The row's one state word. Only Away is coloured; Online and In use are plain text. */
function stateOf(view: DeviceView): { word: string; attention: boolean } {
  if (view.inUse) return { word: "In use", attention: false };
  if (view.status) return { word: PRESENCE_WORD[view.status], attention: view.status === "away" };
  return { word: view.presence, attention: false };
}

function DeviceRow({ view }: { view: DeviceView }) {
  const state = stateOf(view);
  return (
    <li className={styles.row}>
      <span className={styles.slot} data-shape="tile" aria-hidden="true">
        <DeviceKindIcon kind={view.kind} size={13} strokeWidth={1.8} />
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowTitle}>
          <span className="truncate">{view.name}</span>
          {view.current && <span className={styles.tag}>This computer</span>}
        </span>
        {view.meta && <span className={styles.rowMeta}>{view.meta}</span>}
      </span>
      {view.battery !== undefined && <span className={styles.num}>{view.battery}%</span>}
      <span className={styles.state} data-tone={state.attention ? "attention" : undefined}>
        {state.word}
      </span>
    </li>
  );
}

/** The order a message walks when the device in hand does not answer: one line, truncated. */
function ReachOrder({ order, waitSeconds }: { order: readonly string[]; waitSeconds: number }) {
  return (
    <p className={styles.reach} aria-label={`Reach order: ${order.join(", then ")}, ${waitSeconds} seconds apart`}>
      <span className={styles.reachLabel}>Reach</span>
      {order.map((name, i) => (
        <Fragment key={`${name}-${i}`}>
          {i > 0 && <span className={styles.reachWait}>→ {waitSeconds}s →</span>}
          {name}
        </Fragment>
      ))}
    </p>
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
    <div className={styles.add} role="group" aria-label="Add a device">
      <div className={styles.kinds}>
        {ADD_KINDS.map((option) => (
          <button
            key={option.kind}
            type="button"
            className={styles.kind}
            aria-pressed={kind === option.kind}
            onClick={() => setKind(option.kind)}
          >
            <DeviceKindIcon kind={option.kind} size={13} strokeWidth={1.8} />
            {option.label}
          </button>
        ))}
        <button type="button" className={cn(NAKED_ICON_BUTTON, "ml-auto p-1")} aria-label="Close add device" onClick={onClose}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {kind === "computer" && <p className={styles.note}>Sign in to Dopl on the new Mac.</p>}
      {kind && kind !== "computer" && (
        <div className={styles.kinds}>
          <span className={styles.note}>Pairing code</span>
          <span className={styles.code}>{pairingCode}</span>
          <button type="button" className={pillButton("outline", "sm")} onClick={onPair}>
            Pair
          </button>
        </div>
      )}
    </div>
  );
}

/** Every device the operator's agents reach them through; the one place device status shows. */
export function DevicesSection({
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
  const pairingCode = preview?.addDevice?.pairingCode;
  return (
    <Section
      title="Devices"
      count={views && !failed ? `${onlineCount(views)}/${views.length} online` : undefined}
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
        <ReachOrder order={preview.reachOrder} waitSeconds={preview.reachWaitSeconds ?? 30} />
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
    </Section>
  );
}
