/**
 * /canvas — legacy redirect.
 *
 * Resolves the user's default workspace and redirects to its Canvas
 * tab. Kept around so all the historic `redirect("/canvas")` and
 * `<Link href="/canvas">` references in marketing / pricing / welcome
 * pages — plus Stripe checkout/portal return URLs — keep working
 * without threading a workspace slug through every call site. New code
 * should link directly to `/{workspaceSlug}/canvas` instead.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import { isOnboarded } from "@/features/onboarding/server/service";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function CanvasLegacyRedirectPage({ searchParams }: PageProps) {
  const user = await getUser();
  if (!user) redirect("/login");

  // First-run users finish onboarding before landing on a canvas —
  // covers tabs that bypass the auth-callback gate (closed mid-flow).
  if (!(await isOnboarded(user.id))) redirect("/onboarding");

  const workspace = await ensureDefaultWorkspace(user.id);

  // Forward the query string — Stripe checkout/portal return URLs point
  // here with `billing` params the app shell reads to open the settings
  // modal on the Plans & Billing pane.
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") params.set(key, value);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  redirect(`/${workspaceSegment(workspace)}/canvas${query}`);
}
