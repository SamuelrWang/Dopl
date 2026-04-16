"use client";

import { useParams } from "next/navigation";
import { EntryPageClient } from "@/app/entries/[id]/entry-page-client";

/**
 * Canonical public entry URL: /e/<slug>
 * This is the URL the MCP server hands to AI clients, so UUIDs never leak
 * into user-facing hyperlinks. The same view is also reachable at
 * /entries/<id> (accepts slug or UUID) for backward compat with bookmarks
 * and skill files that hardcoded UUIDs.
 */
export default function EntryBySlugPage() {
  const params = useParams();
  const slug = params.slug as string;
  return <EntryPageClient entryKey={slug} />;
}
