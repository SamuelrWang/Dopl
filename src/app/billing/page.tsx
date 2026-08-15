/**
 * `/billing` — segment-less entry. Resolves the caller's DEFAULT workspace and forwards, query
 * intact, to `/billing/{segment}`. Exists for callers holding no workspace segment: the 402/403
 * `upgrade_url` envelopes (MCP agents follow them literally) and the public `/pricing` page.
 *
 * ⚠ NO ONBOARDING DETOUR: somebody arriving here is trying to pay, and a first-run survey in
 * front of that is an abandoned checkout.
 */

import { redirect } from "next/navigation";
import { billingSelfPath } from "@/features/billing/url";
import { ensureDefaultWorkspace } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import { getUser } from "@/shared/supabase/server";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BillingDefaultWorkspacePage({
  searchParams,
}: PageProps) {
  const query = await searchParams;

  const user = await getUser();
  // ⚠ Query-preserving: `?billing=upgrade` must survive the sign-in round trip.
  if (!user) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(billingSelfPath(null, query))}`
    );
  }

  const workspace = await ensureDefaultWorkspace(user.id);
  redirect(billingSelfPath(workspaceSegment(workspace), query));
}
