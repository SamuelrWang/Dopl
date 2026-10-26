// STAGING COPY of src/shared/layout/settings-modal/sections/devices-section-core.tsx (tree of 2026-10-22). Only import paths differ from the source (data hooks and
// desktop libs → src/features/settings-staging/stubs). See src/features/settings-staging/PORTING.md.
"use client";

// ⚠ Deep import, NOT a barrel — barrels drag sibling components the desktop renderer doesn't need.
import { DevicesPanel } from "@/features/settings-staging/features/devices/components/devices-panel";
import { SettingsPane } from "@/shared/layout/settings-modal/sections/settings-panel";

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
