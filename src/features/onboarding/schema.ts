import { z } from "zod";

/**
 * Survey answers land in conversion_events.metadata verbatim, so every
 * field is length-bounded — this is the only validation layer between
 * the form and the analytics table.
 */
export const SurveySubmissionSchema = z.object({
  role: z.string().min(1).max(80),
  roleOther: z.string().max(200).optional(),
  useCases: z.array(z.string().min(1).max(80)).min(1).max(10),
  useCasesOther: z.string().max(200).optional(),
  teamSize: z.enum(["solo", "small_team", "company"]),
  referralSource: z.string().min(1).max(80),
  referralOther: z.string().max(200).optional(),
});

export const CompleteOnboardingSchema = z.object({
  mcpConnected: z.boolean(),
  // Deep-link passthrough (e.g. invite URLs). Re-validated server-side
  // with safeRedirect before it's echoed back.
  redirectTo: z.string().max(2000).optional(),
});
