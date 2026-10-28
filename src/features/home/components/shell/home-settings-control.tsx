import { useEffect, useState } from "react";
import { firstNameOf } from "@/shared/lib/person-name";
import { cn } from "@/shared/lib/utils";
import { IdentityFace } from "@/shared/ui/identity-face";
import { pillButton } from "@/shared/ui/pill-button";
import type { Role, Workspace } from "@/features/workspaces/types";
import { SettingsModal } from "@/shared/layout/settings-modal/desktop-settings-modal";
import type { SettingsSection } from "@/shared/layout/settings-modal/settings-modal-core";

/** The operator as the Profile pill shows them, from `GET /api/user/profile`. */
export interface HomeViewer {
  displayName: string | null;
  avatarUrl: string | null;
}

/** What /home knows about the operator from boot (the SPA's `BootPayload` satisfies it). */
export interface HomeIdentity {
  userId: string;
  /** Null until the operator is onboarded (nothing provisioned). */
  workspace: Workspace | null;
  /** Canonical `{slug}-{publicId}` of that workspace. */
  segment: string | null;
  role: Role | null;
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
  onNavigate,
}: {
  identity: HomeIdentity;
  viewer: HomeViewer | null;
  /** A rename or icon change lands in the account rail, which is the page's read. */
  onWorkspaceChanged: () => void;
  /** The host router's navigate, for the modal's workspace switches. */
  onNavigate: (path: string) => void;
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
        onNavigate={onNavigate}
      />
    </>
  );
}
