"use client";

import { DeleteAccount } from "./delete-account";
import { AccountSectionCore } from "./account-section-core";

/**
 * Account section — web binding. Pane is `./account-section-core`; this file
 * only supplies the web-only danger zone (Supabase browser client sign-out +
 * `next/navigation` redirect).
 */
export function AccountSection() {
  return <AccountSectionCore dangerZone={<DeleteAccount />} />;
}
