"use client";

import { DeleteAccount } from "./delete-account";
import { AccountSectionCore } from "./account-section-core";

/**
 * Account section — the web binding. The pane lives in
 * `./account-section-core`; this file supplies the danger zone, which is
 * web-only (it signs out through the Supabase browser client and redirects
 * with `next/navigation`).
 */
export function AccountSection() {
  return <AccountSectionCore dangerZone={<DeleteAccount />} />;
}
