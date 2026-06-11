/**
 * /onboarding — first-run flow for new signups: survey → MCP connect →
 * auto-named workspace. Gated by profiles.onboarded_at; completed users
 * bounce straight to their workspace via the /canvas legacy resolver.
 */

import { redirect } from "next/navigation";
import { getUser } from "@/shared/supabase/server";
import { getOnboardingStatus } from "@/features/onboarding/server/service";
import { OnboardingFlow } from "@/features/onboarding/components";
import { safeRedirect } from "@/shared/lib/url/safe-redirect";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ redirectTo?: string }>;
}

export default async function OnboardingPage({ searchParams }: PageProps) {
  const user = await getUser();
  if (!user) redirect("/login");

  const status = await getOnboardingStatus(user.id);
  if (status.onboarded) redirect("/canvas");

  const params = await searchParams;
  // Validate early so a hostile redirectTo never reaches the client.
  const redirectTo = params.redirectTo
    ? safeRedirect(params.redirectTo)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[var(--bg-base)] px-6 py-12">
      <div className="absolute inset-0 overflow-hidden" aria-hidden>
        <div className="login-orb login-orb-1" />
        <div className="login-orb login-orb-2" />
        <div className="login-orb login-orb-3" />
      </div>
      <div className="relative z-10 flex w-full justify-center">
        <OnboardingFlow
          initialStep={status.surveyCompleted ? "connect" : "survey"}
          redirectTo={redirectTo}
        />
      </div>
    </div>
  );
}
