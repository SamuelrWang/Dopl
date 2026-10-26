import type { Metadata } from "next";
import { PopupsCatalogPage } from "@/features/popups-staging/popups-catalog-page";

export const metadata: Metadata = {
  title: "Popups (staging) — Dopl",
  robots: { index: false, follow: false },
};

/**
 * UI STAGING: every desktop Settings pane and global popup/window on fake data, inside the landing
 * demo's window. No fetch. See `src/features/popups-staging/PORTING.md` and
 * `src/features/settings-staging/PORTING.md`.
 */
export default function PopupsStagingRoute() {
  return <PopupsCatalogPage />;
}
