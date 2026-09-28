"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { formatRelativeTime } from "@/shared/lib/format-time";
import { OpenScaleButton, OPEN_SCALE_ICON } from "@/shared/ui/open-scale-button";
import {
  SettingsCard,
  SettingsEmpty,
  SettingsPanel,
  SettingsRow,
  SettingsRows,
} from "@/shared/layout/settings-modal/sections/settings-panel";
import { GlassesDeviceRow } from "@/features/glasses/settings/glasses-device-row";
import { PairGlasses } from "@/features/glasses/settings/pair-glasses";
import { useGlassesDevices } from "@/features/glasses/settings/use-glasses";
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
  const glasses = useGlassesDevices();
  const [pairing, setPairing] = useState(false);

  return (
    <SettingsPanel
      id="settings-connect-devices"
      label="Devices"
      action={
        <OpenScaleButton onClick={() => setPairing((open) => !open)} aria-expanded={pairing}>
          <Plus size={OPEN_SCALE_ICON} aria-hidden="true" />
          Pair glasses
        </OpenScaleButton>
      }
    >
      {pairing && (
        <SettingsCard label="Pair glasses">
          <PairGlasses />
        </SettingsCard>
      )}
      <SettingsRows label="Devices">
        {devices === null ? (
          <li className="py-2.5">
            <div className="h-8 animate-pulse rounded-[10px] bg-surface-raised-1" />
          </li>
        ) : devices.length === 0 ? (
          <li>
            <SettingsEmpty>
              {failed ? "Couldn’t load your devices." : "No devices yet."}
            </SettingsEmpty>
          </li>
        ) : (
          devices.map((device) => (
            <DeviceRow
              key={`${device.kind}:${device.id}`}
              device={device}
              glasses={glasses}
            />
          ))
        )}
      </SettingsRows>
    </SettingsPanel>
  );
}

function DeviceRow({
  device,
  glasses,
}: {
  device: ConnectedDevice;
  glasses: ReturnType<typeof useGlassesDevices>;
}) {
  if (device.kind === "computer") return <ComputerRow device={device} />;
  if (device.kind === "glasses") {
    const row = glasses.find((g) => g.id === device.id);
    if (row) return <GlassesDeviceRow device={row} />;
  }
  return (
    <SettingsRow
      leading={<DeviceGlyph kind={device.kind} />}
      title={device.name}
      meta={deviceMeta(device, formatRelativeTime(device.lastSeen))}
    />
  );
}
