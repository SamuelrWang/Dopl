"use client";

import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/api-client";
import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { Role } from "@/features/workspaces/types";
import { Avatar } from "@/shared/ui/avatar";
import { PAGE_ACTION_BTN } from "@/shared/ui/page-action-button";
import { RAISED_INPUT } from "@/shared/ui/wells";
import { cn } from "@/shared/lib/utils";
import { SettingsCard, SettingsPane, SettingsPanel } from "./settings-panel";
import { AccountSubscription } from "./account-subscription";
import { AccountBillingHistory } from "./account-billing-history";

interface ProfileData {
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
}

const PROFILE_PATH = "/api/user/profile";

/**
 * Account section (`/api/user/profile`) — edit display name, view signed-in
 * email/avatar. Next-free core: everything below the form is platform-specific
 * (web deletes in place via Supabase + `next/navigation`; desktop signs out
 * over the bridge and links out), so it arrives as the `dangerZone` slot.
 *
 * ⚠ **`machineSection` IS THE SAME SLOT ARGUMENT FOR A SECOND REASON (2026-09-05):
 * SOME SETTINGS BELONG TO A MACHINE, AND THE WEB HAS NONE.** The desktop binding
 * fills it with per-machine controls held in `electron-store` behind
 * `appWindowOnly` IPC — deliberately not workspace columns, so no server-side
 * actor can reach them. Web passes nothing and renders nothing. ⚠ It sits ABOVE
 * `dangerZone` because the danger zone is by convention last.
 */
export function AccountSectionCore({
  workspaceId,
  role,
  machineSection,
  dangerZone,
}: {
  /** Workspace whose settings are open — its Team plan is cancellable here
   *  for an admin/owner (`./account-subscription`). Personal Pro needs neither. */
  workspaceId?: string;
  role?: Role;
  /** Desktop-only per-machine controls. Absent on web. */
  machineSection?: React.ReactNode;
  dangerZone?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const query = useApiQuery<ProfileData>(PROFILE_PATH);
  const profile = query.data ?? null;

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ⚠ Seed ONCE on first arrival; after that the field is user-owned and a
  // background refetch must not overwrite typing.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !query.data) return;
    seededRef.current = true;
    setDisplayName(query.data.display_name ?? "");
  }, [query.data]);

  const dirty = profile != null && displayName.trim() !== (profile.display_name ?? "");

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const updated = await apiRequest<ProfileData>(PROFILE_PATH, {
        method: "PATCH",
        body: { display_name: displayName.trim() || null },
      });
      queryClient.setQueryData([PROFILE_PATH, undefined, undefined], updated);
      setStatus("Saved.");
    } catch (err) {
      setError(userFacingMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsPane>
      <SettingsPanel id="settings-account-profile" label="Profile">
        <SettingsCard label="Profile">
          <div className="flex items-center gap-3">
            {/* The app's own avatar (bridged image on desktop, initials fallback). */}
            <Avatar
              size="md"
              person={{
                userId: "",
                email: profile?.email ?? null,
                displayName: displayName || profile?.display_name || null,
                avatarUrl: profile?.avatar_url ?? null,
              }}
            />
            <div className="min-w-0">
              <p className="truncate text-body font-medium text-text-primary">
                {profile?.display_name || "User"}
              </p>
              <p className="truncate text-caption text-text-muted">{profile?.email}</p>
            </div>
          </div>

          <div className="mt-4 flex max-w-md items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="text-caption font-medium text-text-secondary">Display name</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={cn(RAISED_INPUT, "px-2.5 py-1.5")}
              />
            </label>
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={handleSave}
              className={cn(PAGE_ACTION_BTN, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {error && <p className="mt-2 text-caption text-danger">{error}</p>}
          {status && <p className="mt-2 text-caption text-success">{status}</p>}
        </SettingsCard>
      </SettingsPanel>

      <AccountSubscription workspaceId={workspaceId} role={role} />
      <AccountBillingHistory workspaceId={workspaceId} role={role} />
      {machineSection}
      {dangerZone}
    </SettingsPane>
  );
}
