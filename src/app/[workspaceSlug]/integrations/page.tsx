import { redirect } from "next/navigation";

/**
 * Legacy URL — integrations are now user-scoped, so we redirect to
 * the global settings page. The /[workspaceSlug] segment is preserved
 * for muscle memory; previous bookmarks still land somewhere useful.
 */
export const dynamic = "force-dynamic";

export default function IntegrationsRedirect() {
  redirect("/settings/integrations");
}
