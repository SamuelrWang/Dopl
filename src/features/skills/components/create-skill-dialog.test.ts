import { describe, expect, it } from "vitest";
import { SkillCreateSchema } from "@/features/skills/schema";

/**
 * ⚠ Pins a coupling invisible from either file: the dialog collects exactly
 * the three fields `SkillCreateSchema` requires that `SkillView` cannot edit
 * afterwards. A new required field makes every submission a silent 400;
 * relaxing one leaves the dialog asking for something unneeded.
 */

const FIELDS_THE_DIALOG_COLLECTS = ["description", "name", "whenToUse"];

/** A field is required when the schema rejects it being absent. */
function requiredKeys(): string[] {
  return Object.entries(SkillCreateSchema.shape)
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key)
    .sort();
}

describe("create-skill dialog ↔ SkillCreateSchema", () => {
  it("asks for every required field, and no more", () => {
    expect(requiredKeys()).toEqual(FIELDS_THE_DIALOG_COLLECTS);
  });

  it("accepts exactly the payload the dialog builds", () => {
    const parsed = SkillCreateSchema.safeParse({
      name: "Draft a release note",
      description: "Turns a diff into a release note.",
      whenToUse: "When shipping a version.",
      status: "draft",
    });
    expect(parsed.success).toBe(true);
  });

  it("would reject the placeholder-free shortcut of creating an empty skill", () => {
    // `POST /api/skills` cannot mint a blank skill, so "click + and open the
    // editor" would require inventing text the user can't fix in-app.
    const parsed = SkillCreateSchema.safeParse({ name: "Untitled skill" });
    expect(parsed.success).toBe(false);
  });

  it("keeps the draft status the dialog sends valid", () => {
    expect(
      SkillCreateSchema.safeParse({
        name: "n",
        description: "d",
        whenToUse: "w",
        status: "nope",
      }).success
    ).toBe(false);
  });
});
