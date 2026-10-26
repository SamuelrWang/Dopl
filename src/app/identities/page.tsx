import type { Metadata } from "next";
import { IdentitiesStagingPage } from "@/features/identities-staging/identities-staging-page";

export const metadata: Metadata = {
  title: "Identities (staging) — Dopl",
  robots: { index: false, follow: false },
};

/**
 * UI STAGING: desktop /home → Identities on fake data, inside the landing demo's window. No auth,
 * no fetch. See `src/features/identities-staging/PORTING.md`.
 */
export default function IdentitiesStagingRoute() {
  return <IdentitiesStagingPage />;
}
