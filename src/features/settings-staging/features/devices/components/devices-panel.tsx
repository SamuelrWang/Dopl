// STAGING COPY of src/features/devices/components/devices-panel.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks and
// desktop libs → src/features/settings-staging/stubs). See src/features/settings-staging/PORTING.md.
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
import { GlassesDeviceRow } from "@/features/settings-staging/features/glasses/settings/glasses-device-row";
import { PairGlasses } from "@/features/settings-staging/features/glasses/settings/pair-glasses";
import { deviceMeta } from "@/features/devices/merge";
import type { ConnectedDevice } from "@/features/devices/types";
import { ComputerRow } from "./computer-row";
import { DeviceGlyph } from "@/features/devices/components/device-glyph";
import { useConnectedDevices } from "@/features/settings-staging/stubs/use-devices";

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
