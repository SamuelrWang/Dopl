import { useEffect, useState } from "react";
import { IdentityFace } from "@/shared/ui/identity-face";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
import type { BootPayload } from "#/pages/boot/use-boot-state";

/** The operator as the Profile pill shows them, from `GET /api/user/profile`. */
export interface HomeViewer {
  displayName: string | null;
  avatarUrl: string | null;
}

const PROFILE_PILL =
  "white-card raise-pill flex h-9 cursor-pointer items-center gap-2 rounded-full pl-1 pr-3.5 text-small font-medium text-text-primary";

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
        {name?.split(/\s+/)[0] ?? "Profile"}
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
