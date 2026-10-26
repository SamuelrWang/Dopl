/**
 * STUB of `apps/desktop-ui/src/pages/home/home-settings-control.tsx › openHomeSettings`. The
 * desktop opens the Settings modal on a section through a one-slot registry; here the call fires
 * a window event the staging page answers by opening `StagingSettingsModal` on that section.
 */
export const STAGING_OPEN_SETTINGS_EVENT = "overview-staging:open-settings";

export type SettingsSection = "billing" | "profile" | "general";

export function openHomeSettings(section: SettingsSection): void {
  window.dispatchEvent(
    new CustomEvent<SettingsSection>(STAGING_OPEN_SETTINGS_EVENT, { detail: section })
  );
}
