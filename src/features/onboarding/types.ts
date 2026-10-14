import type { z } from "zod";
import type { SurveySubmissionSchema } from "./schema";

export type SurveySubmission = z.infer<typeof SurveySubmissionSchema>;

export interface OnboardingStatus {
  onboarded: boolean;
  surveyCompleted: boolean;
}

/** Survey → MCP connect → bring your agent (runtime sign-in) → name the home
 *  space. `agents` was inserted as step 3 on 2026-10-13 (Samuel). */
export type OnboardingStep = "survey" | "connect" | "agents" | "workspace";
