"use client";

// ⚠ Deep import, NOT a barrel — barrels drag sibling components the desktop renderer doesn't need.
import { DevicesPanel } from "@/features/devices/components/devices-panel";
import { SettingsPane } from "./settings-panel";

/**
 * DEVICES (Samuel, 2026-10-02) — every computer and pair of glasses connected to the caller's
 * agents. Was the second half of the deleted Connect tab. Account-scoped: `/api/devices` and
 * `/api/glasses/devices` read no workspace.
 */
export function DevicesSectionCore() {
  return (
    <SettingsPane>
      <DevicesPanel />
    </SettingsPane>
  );
}
