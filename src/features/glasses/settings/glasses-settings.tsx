"use client";

import { SectionShell } from "@/shared/layout/settings-modal/sections/section-shell";
import { GlassesDeviceRow } from "./glasses-device-row";
import { PairGlasses } from "./pair-glasses";
import { useGlassesDevices } from "./use-glasses";

/**
 * Settings → Glasses: pair a pair of glasses by the code on its lens, then manage each device.
 * Account-scoped (no workspace header), and reached over `apiRequest`, so the web and desktop
 * bindings of the settings modal mount this one component.
 */
export function GlassesSettings() {
  const devices = useGlassesDevices();
  return (
    <SectionShell title="Glasses">
      <PairGlasses />
      {devices.length > 0 && (
        <ul aria-label="Paired glasses" className="space-y-1.5">
          {devices.map((d) => (
            <GlassesDeviceRow key={d.id} device={d} />
          ))}
        </ul>
      )}
    </SectionShell>
  );
}
