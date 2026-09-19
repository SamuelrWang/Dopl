"use client";

import type { Role } from "@/features/workspaces/types";
import { DeleteAccount } from "./delete-account";
import { AccountSectionCore } from "./account-section-core";

/**
 * Account section — web binding. Pane is `./account-section-core`; this file
 * only supplies the web-only danger zone (Supabase browser client sign-out +
 * `next/navigation` redirect).
 */
export function AccountSection({
  workspaceId,
  role,
}: {
  workspaceId?: string;
  role?: Role;
}) {
  return (
    <AccountSectionCore
      workspaceId={workspaceId}
      role={role}
      dangerZone={<DeleteAccount />}
    />
  );
}
