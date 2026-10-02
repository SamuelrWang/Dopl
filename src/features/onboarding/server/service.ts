import "server-only";
import {
  logConversionEvent,
  hasFiredEvent,
} from "@/features/analytics/server/conversion-events";
import {
  HOME_SPACE_DEFAULT_NAME,
  renameHomeSpaceIfPlaceholder,
} from "@/features/workspaces/server/service";
import { workspaceSegment } from "@/features/workspaces/url";
/**
 * ⚠ Hand copy of `apps/desktop-ui/src/components/app-shell/account-rail.tsx ›
 * HOME_PATH` (server can't import the SPA). `./service.test.ts` pins it.
 */
const HOME_PATH = "/home";
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
 * Finish onboarding: name the caller's home space (ruling B10), stamp
 * onboarded_at, return the landing URL. Blank name → "Home" (Samuel,
 * 2026-09-06: "{FirstName}'s Workspace" was mistaken for a workspace).
 * ⚠ Every step idempotent so a retry after partial failure converges.
 *
 * 🔒 Lands on `/home` (2026-09-10): a `kind='home'` container is "a SHELF, not a
 * workspace" (`20260920120000_workspace_kind_personal.sql`) with no workspace
 * shell. The `kind` check states the rule; its else branch is unreachable today
 * (`ensureHomeSpace`) but keeps a named workspace on the workspace landing.
 *
 * ⚠ `/home` has NO segment — a ROOT route in `apps/desktop-ui/src/routes.tsx`.
 */
export async function completeOnboarding(
  userId: string,
  opts: { mcpConnected: boolean; name?: string; description?: string }
): Promise<{ redirectPath: string }> {
  const typedName = opts.name?.trim();
  const description = opts.description?.trim() || undefined;

  const workspaceName = typedName || HOME_SPACE_DEFAULT_NAME;

  const workspace = await renameHomeSpaceIfPlaceholder(
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

  if (workspace.kind === "home") return { redirectPath: HOME_PATH };
  return { redirectPath: `/${workspaceSegment(workspace)}/overview` };
}

/** Re-export for the auth-callback gate — keeps repository out of it. */
export async function isOnboarded(userId: string): Promise<boolean> {
  return (await findOnboardedAt(userId)) !== null;
}
