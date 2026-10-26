// STAGING COPY of apps/desktop-ui/src/pages/home/home-settings-control.tsx (tree of 2026-10-26). Only import paths differ from the source (data hooks,
// desktop libs and unstaged channel bodies → src/features/popups-staging/stubs). See src/features/popups-staging/PORTING.md.
import { useEffect, useState } from "react";
import { firstNameOf } from "@/shared/lib/person-name";
import { cn } from "@/shared/lib/utils";
import { IdentityFace } from "@/shared/ui/identity-face";
import { pillButton } from "@/shared/ui/pill-button";
import { SettingsModal, type SettingsSection } from "@/features/popups-staging/stubs/desktop-shell";
import type { BootPayload } from "@/features/popups-staging/stubs/desktop-shell";

/** The operator as the Profile pill shows them, from `GET /api/user/profile`. */
export interface HomeViewer {
  displayName: string | null;
  avatarUrl: string | null;
}

const PROFILE_PILL = cn(pillButton("white", "lg"), "gap-2 pl-1 pr-3.5");

/**
 * Opens /home's settings modal from anywhere on the page (the credit bar's "Upgrade" is a
 * caller). A one-slot registry rather than a lifted callback, so no component between the page
 * and that bar grows a prop. Sound because /home mounts one control; a no-op when none is
 * mounted (an account with no provisioned workspace renders none).
 */
type SettingsOpener = (section: SettingsSection) => void;
let liveOpener: SettingsOpener | null = null;

export function openHomeSettings(section: SettingsSection): void {
  liveOpener?.(section);
}

/**
 * The operator's Profile pill (their photo and first name) and the settings modal it opens: this
 * page has no sidebar, so this is its only way into settings.
 */
export function HomeSettingsControl({
  identity,
  viewer,
  onWorkspaceChanged,
}: {
  identity: BootPayload;
  viewer: HomeViewer | null;
  /** A rename or icon change lands in the account rail, which is the page's read. */
  onWorkspaceChanged: () => void;
}) {
  // Seeded, not defaulted on open: Escape-then-reopen must not flash the wrong pane.
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");

  // Registered after commit and cleared on unmount, so a stale opener cannot outlive the page.
  useEffect(() => {
    liveOpener = (next) => {
      setSection(next);
      setOpen(true);
    };
    return () => {
      liveOpener = null;
    };
  }, []);

  // Three of the modal's four sections are workspace-scoped, so it binds to boot's default
  // workspace; with nothing provisioned there is nothing to configure.
  if (!identity.workspace || !identity.segment) return null;

  const name = viewer?.displayName?.trim() || null;
  return (
    <>
      <button
        type="button"
        title="Profile"
        onClick={() => setOpen(true)}
        className={PROFILE_PILL}
      >
        <IdentityFace size={26} photo={viewer?.avatarUrl} name={name} />
        {firstNameOf(name, "Profile")}
      </button>
      <SettingsModal
        open={open}
        onOpenChange={setOpen}
        section={section}
        onSectionChange={setSection}
        workspaceSegment={identity.segment}
        workspaceId={identity.workspace.id}
        role={identity.role ?? "viewer"}
        onWorkspaceChanged={onWorkspaceChanged}
      />
    </>
  );
}
