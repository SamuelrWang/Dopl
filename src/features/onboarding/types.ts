import type { z } from "zod";
import type { SurveySubmissionSchema } from "./schema";

export type SurveySubmission = z.infer<typeof SurveySubmissionSchema>;

export interface OnboardingStatus {
  onboarded: boolean;
  surveyCompleted: boolean;
}

export type OnboardingStep = "survey" | "connect" | "workspace";
