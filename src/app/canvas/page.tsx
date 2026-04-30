/**
 * /canvas — legacy redirect.
 *
 * Resolves the user's default workspace + main canvas and redirects
 * there. Kept around so all the historic `redirect("/canvas")` and
 * `<Link href="/canvas">` references in marketing / pricing / welcome
 * pages keep working without having to thread a workspace slug through
 * every call site. New code should link directly to
 * `/{workspaceSlug}/{canvasSlug}` instead of relying on this redirect.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { ensureDefaultCanvas } from "@/features/workspaces/server/canvases";

export const dynamic = "force-dynamic";

export default async function CanvasLegacyRedirectPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  const workspace = await ensureDefaultWorkspace(user.id);
  const canvas = await ensureDefaultCanvas(workspace.id);
  redirect(`/${workspace.slug}/${canvas.slug}`);
}
