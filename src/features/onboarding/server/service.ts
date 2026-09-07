import "server-only";
import {
  logConversionEvent,
  hasFiredEvent,
} from "@/features/analytics/server/conversion-events";
import {
  PERSONAL_CONTAINER_DEFAULT_NAME,
  renamePersonalContainerIfPlaceholder,
} from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
import type { OnboardingStatus, SurveySubmission } from "../types";
import {
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
 * Finish onboarding: name the caller's HOME — their personal container, which
 * is what ruling B10 leaves for a first-run survey to name — stamp
 * onboarded_at, return the URL to land on. Blank name → "Home" (Samuel,
 * 2026-09-06: the personal container is every user's default space and must
 * never carry a name that reads as a workspace — "{FirstName}'s Workspace"
 * was mistaken for one). ⚠ Every step idempotent so a retry after partial
 * failure converges.
 */
export async function completeOnboarding(
  userId: string,
  opts: { mcpConnected: boolean; name?: string; description?: string }
): Promise<{ redirectPath: string }> {
  const typedName = opts.name?.trim();
  const description = opts.description?.trim() || undefined;

  const workspaceName = typedName || PERSONAL_CONTAINER_DEFAULT_NAME;

  const workspace = await renamePersonalContainerIfPlaceholder(
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
