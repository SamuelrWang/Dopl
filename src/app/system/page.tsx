import type { Metadata } from "next";
import { SystemPage } from "@/features/ui-staging/system/system-page";

export const metadata: Metadata = {
  title: "Design system (staging) — Dopl",
  robots: { index: false, follow: false },
};

/** UI STAGING: the design system reference sheet, in the landing demo's window. No fetch. */
export default function SystemStagingRoute() {
  return <SystemPage />;
}
