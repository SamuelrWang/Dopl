import { z } from "zod";

/**
 * ⚠ Answers land in conversion_events.metadata VERBATIM — this is the only
 * validation layer between form and analytics table, so bound every field.
 */
export const SurveySubmissionSchema = z.object({
  entityType: z.enum(["solo", "team", "company"]),
  descriptors: z.array(z.string().min(1).max(80)).min(1).max(20),
  // Slider — team/company only, absent for solo.
  size: z.enum(["1-2", "2-10", "10-50", "50-100", "100-1000", "1000+"]).optional(),
});

export const CompleteOnboardingSchema = z.object({
  mcpConnected: z.boolean(),
  // Blank name → server auto-name ("{FirstName}'s Workspace"). ⚠ Caps mirror
  // CreateWorkspaceSchema (120 / 2000) — keep in sync. Trimmed here so the
  // service sees what the user would.
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  // Deep-link passthrough (invite URLs). Re-validated server-side by
  // safeRedirect before echo.
  redirectTo: z.string().max(2000).optional(),
});
