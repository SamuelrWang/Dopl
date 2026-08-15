import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  logConversionEvent,
  hasFiredEvent,
} from "@/features/analytics/server/conversion-events";
import { renameDefaultWorkspaceIfUntitled } from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import type { OnboardingStatus, SurveySubmission } from "../types";
import {
  findDisplayName,
  findOnboardedAt,
  hasActiveMcpToken,
  markOnboarded,
} from "./repository";

export async function getOnboardingStatus(
  userId: string
): Promise<OnboardingStatus> {
  const [onboardedAt, surveyCompleted] = await Promise.all([
    findOnboardedAt(userId),
    hasFiredEvent(userId, "onboarding_survey_submitted"),
  ]);
  return { onboarded: onboardedAt !== null, surveyCompleted };
}

/** Survey answers → conversion event, once per user. Resubmit no-ops so the
 *  analytics row stays the first (real) submission. */
export async function submitSurvey(
  userId: string,
  input: SurveySubmission
): Promise<void> {
  const already = await hasFiredEvent(userId, "onboarding_survey_submitted");
  if (already) return;
  await logConversionEvent({
    userId,
    eventType: "onboarding_survey_submitted",
    metadata: input,
  });
}

export async function isMcpConnected(userId: string): Promise<boolean> {
  return hasActiveMcpToken(userId);
}

/**
 * Finish onboarding: name default workspace, stamp onboarded_at, return the
 * URL to land on. Blank name → "{FirstName}'s Workspace". ⚠ Every step
 * idempotent so a retry after partial failure converges.
 */
export async function completeOnboarding(
  userId: string,
  opts: { mcpConnected: boolean; name?: string; description?: string }
): Promise<{ redirectPath: string }> {
  const typedName = opts.name?.trim();
  const description = opts.description?.trim() || undefined;

  let workspaceName: string;
  if (typedName) {
    workspaceName = typedName;
  } else {
    const firstName = await resolveFirstName(userId);
    workspaceName = firstName ? `${firstName}'s Workspace` : "My Workspace";
  }

  const workspace = await renameDefaultWorkspaceIfUntitled(
    userId,
    workspaceName,
    description
  );

  const won = await markOnboarded(userId);
  if (won) {
    await logConversionEvent({
      userId,
      eventType: "onboarding_completed",
      metadata: { mcpConnected: opts.mcpConnected },
    });
  }

  return { redirectPath: `/${workspaceSegment(workspace)}/overview` };
}

/** Re-export for the auth-callback gate — keeps repository out of it. */
export async function isOnboarded(userId: string): Promise<boolean> {
  return (await findOnboardedAt(userId)) !== null;
}

/**
 * First name for workspace title: profiles.display_name →
 * user_metadata.full_name → user_metadata.name, first whitespace token.
 * ⚠ Never the email local-part — worse than the "My Workspace" fallback.
 */
async function resolveFirstName(userId: string): Promise<string | null> {
  const displayName = await findDisplayName(userId);
  let candidate = displayName?.trim();

  if (!candidate) {
    try {
      const { data } = await supabaseAdmin().auth.admin.getUserById(userId);
      const meta = data.user?.user_metadata as
        | Record<string, unknown>
        | undefined;
      const fullName = meta?.full_name ?? meta?.name;
      if (typeof fullName === "string") candidate = fullName.trim();
    } catch {
      // Best-effort; fall through to the generic name.
    }
  }

  if (!candidate) return null;
  const first = candidate.split(/\s+/)[0];
  return first || null;
}
