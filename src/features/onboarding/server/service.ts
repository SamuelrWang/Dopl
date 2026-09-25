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
 * ⚠ **A FOURTH HAND COPY OF THE SPA's `HOME_PATH`, AND IT CANNOT BE AN IMPORT.**
 * `apps/desktop-ui/src/components/app-shell/account-rail.tsx › HOME_PATH` is the
 * source; server code is a different npm workspace with `#/` aliases and pulling
 * it in drags every page component along. `./service.test.ts` reads the SPA's
 * route table and compares, exactly as it already does for `WORKSPACE_HOME_PATH`.
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
 * Finish onboarding: name the caller's HOME — their home space, which
 * is what ruling B10 leaves for a first-run survey to name — stamp
 * onboarded_at, return the URL to land on. Blank name → "Home" (Samuel,
 * 2026-09-06: the home space is every user's default space and must
 * never carry a name that reads as a workspace — "{FirstName}'s Workspace"
 * was mistaken for one). ⚠ Every step idempotent so a retry after partial
 * failure converges.
 *
 * 🔒 **THE LANDING IS `/home` (2026-09-10, the new-user flow), NOT
 * `/{segment}/overview`.** What onboarding names is a `kind='home'`
 * container, and that container has no workspace shell: `/home` is its surface
 * and the account rail's pinned tile is how it is reached. The old path took a
 * brand-new user THROUGH the workspace shell — sidebar, channels tree, the
 * workspace Overview — for a row that is *"a SHELF, not a workspace"*
 * (`20260920120000_workspace_kind_personal.sql`). It resolved and rendered, which
 * is why nothing caught it; it was simply the wrong room.
 *
 * ⚠ **THE `kind` CHECK IS NOT DEFENSIVE PROSE, IT IS THE STATEMENT OF WHY.** The
 * container is personal by construction here (`renameHomeSpaceIfPlaceholder`
 * goes through `ensureHomeSpace`), so the else branch is unreachable
 * today — and keeping it is what makes the rule READ as "a home space
 * lands on /home" rather than "onboarding hardcodes /home". A workspace
 * onboarding ever names keeps the workspace landing, for free.
 *
 * ⚠ `/home` has NO segment and that is the point — do not re-prefix it. It is a
 * ROOT route in `apps/desktop-ui/src/routes.tsx` (`HOME_PATH`), a sibling of
 * `/:workspaceSegment` rather than a child, because it mounts its own frame.
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
