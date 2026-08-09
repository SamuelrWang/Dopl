import { describe, expect, it } from "vitest";
import { SkillCreateSchema } from "@/features/skills/schema";

/**
 * The create dialog collects exactly THREE fields — name, description, when
 * to use — because those are the three `SkillCreateSchema` requires and the
 * three `SkillView` cannot edit afterwards (it edits the title, folder,
 * sharing and the SKILL.md body). That coupling is invisible from either
 * file, so it is pinned here:
 *
 *  - a NEW required field in the schema would make every dialog submission a
 *    silent 400;
 *  - dropping one of these to "optional" would leave the dialog asking for
 *    something the product no longer needs.
 *
 * Either way the dialog's field set has to move with the schema, and this
 * test fails until it does.
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
    // Why the dialog exists at all: `POST /api/skills` cannot mint a blank
    // skill, so "click + and open the editor" is not on the table without
    // inventing description/whenToUse text the user could never fix in-app.
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
