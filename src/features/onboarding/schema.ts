import { z } from "zod";

/**
 * Survey answers land in conversion_events.metadata verbatim, so every
 * field is length-bounded — this is the only validation layer between
 * the form and the analytics table.
 */
export const SurveySubmissionSchema = z.object({
  entityType: z.enum(["solo", "team", "company"]),
  descriptors: z.array(z.string().min(1).max(80)).min(1).max(20),
  // Only present for team / company (the slider). Absent for solo.
  size: z.enum(["1-2", "2-10", "10-50", "50-100", "100-1000", "1000+"]).optional(),
});

export const CompleteOnboardingSchema = z.object({
  mcpConnected: z.boolean(),
  // Workspace naming from the final onboarding step. Both optional: a blank
  // name falls back to the auto-name ("{FirstName}'s Workspace") server-side.
  // Caps mirror CreateWorkspaceSchema (name 120, description 2000). Trimmed
  // here so the service sees the same value the user would after trimming.
  name: z.string().trim().max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  // Deep-link passthrough (e.g. invite URLs). Re-validated server-side
  // with safeRedirect before it's echoed back.
  redirectTo: z.string().max(2000).optional(),
});
