"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { SMALL_PILL_BUTTON, SMALL_PILL_ICON } from "@/shared/ui/small-action-button";
import {
  SettingsCard,
  SettingsPanel,
  SettingsRow,
  SettingsRows,
  SettingsRowsEmpty,
  SettingsRowsSkeleton,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { GlassesDeviceRow } from "@/features/glasses/settings/glasses-device-row";
import { PairGlasses } from "@/features/glasses/settings/pair-glasses";
import { deviceMeta } from "../merge";
import type { ConnectedDevice } from "../types";
import { ComputerRow } from "./computer-row";
import { DeviceGlyph } from "./device-glyph";
import { useConnectedDevices } from "./use-devices";

/**
 * DEVICES — the hardware the caller's agents reach them through: computers running Dopl (they
 * register themselves) and paired glasses, one list. The glasses controls are the glasses
 * feature's own row; a kind with no row of its own renders the generic one.
 */
export function DevicesPanel() {
  const { devices, failed } = useConnectedDevices();
  const [pairing, setPairing] = useState(false);

  return (
    <SettingsPanel
      id="settings-connect-devices"
      label="Devices"
      action={
        <button
          type="button"
          onClick={() => setPairing((open) => !open)}
          aria-expanded={pairing}
          className={SMALL_PILL_BUTTON}
        >
          <Plus size={SMALL_PILL_ICON} aria-hidden="true" />
          Pair glasses
        </button>
      }
    >
      {pairing && (
        <SettingsCard label="Pair glasses">
          <PairGlasses />
        </SettingsCard>
      )}
      <SettingsRows label="Devices">
        {devices === null ? (
          <SettingsRowsSkeleton />
        ) : devices.length === 0 ? (
          <SettingsRowsEmpty failed={failed && "Couldn’t load your devices."}>
            No devices yet.
          </SettingsRowsEmpty>
        ) : (
          devices.map((device) => <DeviceRow key={`${device.kind}:${device.id}`} device={device} />)
        )}
      </SettingsRows>
    </SettingsPanel>
  );
}

function DeviceRow({ device }: { device: ConnectedDevice }) {
  if (device.kind === "computer") return <ComputerRow device={device} />;
  if (device.glasses) return <GlassesDeviceRow device={device.glasses} />;
  return (
    <SettingsRow
      leading={<DeviceGlyph kind={device.kind} />}
      title={device.name}
      meta={deviceMeta(device, formatRelativeTime(device.lastSeen))}
    />
  );
}
