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

  // Colorway mirrors the knowledge-landing shell (app-shell.module.css).
  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#d6dee7] text-[#232a31]"
      style={{ fontFamily: "var(--font-geist-sans), system-ui, sans-serif" }}
    >
      <div className="min-h-full flex items-center justify-center px-6 py-12">
        <OnboardingFlow
          initialStep={status.surveyCompleted ? "connect" : "survey"}
          redirectTo={redirectTo}
        />
      </div>
    </div>
  );
}
