import type { Metadata } from "next";
import { OverviewStagingPage } from "@/features/overview-staging/overview-staging-page";

export const metadata: Metadata = {
  title: "Overview (staging) — Dopl",
  robots: { index: false, follow: false },
};

/**
 * UI STAGING: desktop /home → Overview on fake data, inside the
 * landing demo's window. No auth, no fetch. See `src/features/overview-staging/PORTING.md`.
 */
export default function OverviewStagingRoute() {
  return <OverviewStagingPage />;
}
