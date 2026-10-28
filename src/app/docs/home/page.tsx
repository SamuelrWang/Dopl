import type { Metadata } from "next";

import { DocsHome } from "@/features/marketing/docs/components/docs-home";

/** The docs home. Bare `/docs` 308s here (`next.config.ts › redirects`). Static content. */
export const dynamic = "force-static";

export const metadata: Metadata = { title: "Dopl Docs" };

export default function DocsHomeRoute() {
  return <DocsHome />;
}
