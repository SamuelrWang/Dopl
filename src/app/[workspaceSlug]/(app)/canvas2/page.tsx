/**
 * /[workspaceSlug]/canvas2 — muscle-memory alias. The graph view was
 * promoted to the primary `/canvas` tab; this permanently redirects the
 * old path there, preserving the workspace segment.
 */

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Canvas2AliasPage({ params, searchParams }: PageProps) {
  const { workspaceSlug } = await params;

  // Forward the query string so links that carried params to the old path
  // (e.g. Stripe billing return params the app shell reads) survive the alias.
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") search.set(key, value);
  }
  const query = search.size > 0 ? `?${search.toString()}` : "";
  redirect(`/${workspaceSlug}/canvas${query}`);
}
