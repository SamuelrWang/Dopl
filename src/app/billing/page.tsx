/**
 * `/billing` — the segment-less entry to the billing surface.
 *
 * Resolves the caller's DEFAULT workspace and forwards, query intact, to
 * `/billing/{segment}`. It exists for the builders that genuinely have no
 * workspace segment in hand: the 402/403 `upgrade_url` envelopes (read by
 * API-first clients, MCP agents included, which follow the link literally and
 * are reached from contexts holding a workspace id at best) and the public
 * `/pricing` page. Same job `src/app/canvas/page.tsx` did for the app tree —
 * which is precisely why it could not keep doing it: that page is on the RETIRE
 * list (docs/migration-research/website-retirement-plan.md).
 *
 * NO ONBOARDING DETOUR, deliberately, and that is the one way this differs from
 * `/canvas`. Somebody arriving here is trying to pay or to manage a
 * subscription; putting a first-run survey in front of that is a checkout
 * abandoned. `/onboarding` is on the RETIRE list too.
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
  // Query-preserving, like the segment page: this is the URL a signed-out
  // first-time payer follows out of a 402, and `?billing=upgrade` has to
  // survive the sign-in round trip.
  if (!user) {
    redirect(
      `/login?redirectTo=${encodeURIComponent(billingSelfPath(null, query))}`
    );
  }

  const workspace = await ensureDefaultWorkspace(user.id);
  redirect(billingSelfPath(workspaceSegment(workspace), query));
}
