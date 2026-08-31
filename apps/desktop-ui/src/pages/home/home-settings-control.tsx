import { useState } from "react";
import { Avatar, type AvatarPerson } from "@/shared/ui/avatar";
import { useApiQuery } from "#/hooks/use-api-query";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
import type { BootPayload } from "#/pages/boot/use-boot-state";

/**
 * THE SETTINGS ENTRY /home NEVER HAD (Samuel, live review 2026-08-30) — the
 * operator's own face in the left column, opening the SAME modal the workspace
 * sidebar's gear opens.
 *
 * ⚠ WHY /home HAD NONE. Settings is reached from the app sidebar, and this page
 * has no sidebar: it is the ACCOUNT surface, one panel wide, whose left column
 * is the channel list. So the entry goes where a person's own identity already
 * belongs — the top of that column, above the rows, on the list's own `px-3`
 * inset so the face lines up with every avatar under it.
 *
 * ⚠ ITS OWN FILE, not thirty lines inside `index.tsx`. That page is at the
 * 500-line cap (INVARIANTS §1) and this is one coherent responsibility: a
 * profile read, a control, and a modal that only this control opens. The page
 * hands it the boot payload it already has and knows nothing else about it.
 */
export function HomeSettingsControl({
  identity,
  onWorkspaceChanged,
}: {
  identity: BootPayload;
  /** A rename or an icon change lands in the account RAIL, which is the page's
   *  `/api/workspaces` read — this control does not own it, so it says so. */
  onWorkspaceChanged: () => void;
}) {
  // Section state seeded, not defaulted on open: Escape-then-reopen must not
  // flash the wrong pane. Same reason `components/app-shell/app-shell.tsx`
  // holds it — this is that page's mechanism, reused rather than re-invented.
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("account");

  // ⚠ THE FACE COMES FROM THE PROFILE, NOT FROM BOOT. `POST /api/boot` answers
  // `userId` and nothing renderable — no display name, no avatar — so an
  // `Avatar` built off boot alone is a permanent "?" initial. This route is the
  // caller's own row (`withUserAuth`, no workspace, so /home may ask it) and
  // returns exactly the fields `AvatarPerson` takes.
  //
  // ⚠ NOT GATED ON `open`: it paints the control itself, not the modal.
  const profile = useApiQuery<HomeProfile>(PROFILE_PATH);

  /**
   * ⚠ SETTINGS NEEDS A WORKSPACE AND /home IS NOT ONE. Three of the modal's four
   * sections are workspace-scoped, so the control binds to the caller's DEFAULT
   * workspace — the one `POST /api/boot` already answered with on this page's
   * own cache key, so this costs no extra request.
   *
   * ⚠ NULL ⇒ NO CONTROL, not a control that opens empty panes. `workspace` is
   * null only for an account with nothing provisioned (boot's own docblock), and
   * there is nothing to configure then.
   */
  if (!identity.workspace || !identity.segment) return null;

  // The fallbacks are the point: this renders while the profile read is in
  // flight and on the day it fails, where `Avatar` degrades to its initials. A
  // face that is briefly an initial is fine; a control that pops into existence
  // after a network round trip is not.
  const me: AvatarPerson = {
    userId: identity.userId,
    email: profile.data?.email ?? null,
    displayName: profile.data?.display_name ?? null,
    avatarUrl: profile.data?.avatar_url ?? null,
  };

  return (
    <>
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Avatar person={me} size="sm" />
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

/** `GET /api/user/profile` — the three fields `AvatarPerson` needs off it. The
 *  route answers the row bare (no envelope); its other columns are the settings
 *  form's business, not this control's. */
const PROFILE_PATH = "/api/user/profile";
interface HomeProfile {
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}
