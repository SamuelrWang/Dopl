// The survey schema validates exactly what the survey UI can send: every identity and every size
// bucket the form offers (constants.ts) passes, and nothing else does.
import { describe, expect, it } from "vitest";
import { ENTITY_OPTIONS, SIZE_BUCKETS } from "./constants";
import { SurveySubmissionSchema } from "./schema";

const base = { entityType: "team", descriptors: ["engineering"] } as const;

describe("SurveySubmissionSchema agrees with the survey form's options", () => {
  it("accepts every identity the form offers, and no other", () => {
    expect(ENTITY_OPTIONS.length).toBeGreaterThan(0);
    for (const { value } of ENTITY_OPTIONS) {
      expect(SurveySubmissionSchema.safeParse({ ...base, entityType: value }).success, value).toBe(true);
    }
    expect(SurveySubmissionSchema.safeParse({ ...base, entityType: "agency" }).success).toBe(false);
  });

  it("accepts every size bucket the slider offers, and no other", () => {
    expect(SIZE_BUCKETS.length).toBeGreaterThan(0);
    for (const size of SIZE_BUCKETS) {
      expect(SurveySubmissionSchema.safeParse({ ...base, size }).success, size).toBe(true);
    }
    expect(SurveySubmissionSchema.safeParse({ ...base, size: "5-9" }).success).toBe(false);
    expect(SurveySubmissionSchema.safeParse({ ...base }).success, "size is optional").toBe(true);
  });
});
