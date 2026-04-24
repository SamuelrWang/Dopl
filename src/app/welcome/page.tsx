/**
 * /welcome — first-run onboarding page.
 *
 * Server component. Guards:
 *   - No session         → /login?redirectTo=/welcome
 *   - Already onboarded  → /canvas
 *   - Fresh user         → renders the animated flow
 *
 * The flow itself (typewriter intro, MCP-connect step, prompt, canvas seeding)
 * lives in welcome-content.tsx so the server shell stays thin.
 */

import { redirect } from "next/navigation";
import { getServerClient, getUser } from "@/shared/supabase/server";
import { WelcomeContent } from "./welcome-content";

// Never cache this across users — the onboarded_at check is per-request.
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await getUser();
  if (!user) {
    redirect("/login?redirectTo=/welcome");
  }

  const supabase = await getServerClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded_at")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.onboarded_at) {
    redirect("/canvas");
  }

  return <WelcomeContent userId={user.id} />;
}
