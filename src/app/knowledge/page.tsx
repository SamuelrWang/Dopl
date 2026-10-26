import type { Metadata } from "next";
import { KnowledgeStagingPage } from "@/features/knowledge-staging/knowledge-staging-page";

export const metadata: Metadata = {
  title: "Knowledge (staging) — Dopl",
  robots: { index: false, follow: false },
};

/**
 * UI STAGING: desktop /home → Knowledge on fake data, inside the landing demo's window. No auth,
 * no fetch. See `src/features/knowledge-staging/PORTING.md`.
 */
export default function KnowledgeStagingRoute() {
  return <KnowledgeStagingPage />;
}
