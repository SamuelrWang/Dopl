import type { z } from "zod";
import type {
  SurveySubmissionSchema,
  CompleteOnboardingSchema,
} from "./schema";

export type SurveySubmission = z.infer<typeof SurveySubmissionSchema>;
export type CompleteOnboardingInput = z.infer<typeof CompleteOnboardingSchema>;

export interface OnboardingStatus {
  onboarded: boolean;
  surveyCompleted: boolean;
}

export type OnboardingStep = "survey" | "connect";
