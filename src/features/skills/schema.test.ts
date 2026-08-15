/** Locks the validation contract REST handlers and MCP tools both parse
 *  against: name/description/whenToUse caps, folder ≤ 80, slug shape, 1 MB
 *  body ceiling. ⚠ A cap change here is a contract change. */

import { describe, it, expect } from "vitest";
import {
  SkillCreateSchema,
  SkillUpdateSchema,
  SkillFileWriteSchema,
  SkillSlugSchema,
} from "./schema";

const validCreate = {
  name: "My Skill",
  description: "does a thing",
  whenToUse: "when the thing is needed",
};

describe("SkillCreateSchema caps", () => {
  it("accepts a minimal valid create", () => {
    expect(SkillCreateSchema.safeParse(validCreate).success).toBe(true);
  });

  it("name: 1..120 chars", () => {
    expect(SkillCreateSchema.safeParse({ ...validCreate, name: "" }).success).toBe(false);
    expect(SkillCreateSchema.safeParse({ ...validCreate, name: "a".repeat(120) }).success).toBe(true);
    expect(SkillCreateSchema.safeParse({ ...validCreate, name: "a".repeat(121) }).success).toBe(false);
  });

  it("description: 1..2000 chars", () => {
    expect(SkillCreateSchema.safeParse({ ...validCreate, description: "" }).success).toBe(false);
    expect(SkillCreateSchema.safeParse({ ...validCreate, description: "a".repeat(2000) }).success).toBe(true);
    expect(SkillCreateSchema.safeParse({ ...validCreate, description: "a".repeat(2001) }).success).toBe(false);
  });

  it("whenToUse: 1..2000 chars", () => {
    expect(SkillCreateSchema.safeParse({ ...validCreate, whenToUse: "" }).success).toBe(false);
    expect(SkillCreateSchema.safeParse({ ...validCreate, whenToUse: "a".repeat(2001) }).success).toBe(false);
  });

  it("folder: ≤ 80 chars, nullable", () => {
    expect(SkillCreateSchema.safeParse({ ...validCreate, folder: "a".repeat(80) }).success).toBe(true);
    expect(SkillCreateSchema.safeParse({ ...validCreate, folder: "a".repeat(81) }).success).toBe(false);
    expect(SkillCreateSchema.safeParse({ ...validCreate, folder: null }).success).toBe(true);
  });
});

describe("SkillUpdateSchema", () => {
  it("folder ≤ 80 chars applies to updates too", () => {
    expect(SkillUpdateSchema.safeParse({ folder: "a".repeat(80) }).success).toBe(true);
    expect(SkillUpdateSchema.safeParse({ folder: "a".repeat(81) }).success).toBe(false);
  });

  it("teamIds require visibility public + accessMode teams", () => {
    expect(
      SkillUpdateSchema.safeParse({
        visibility: "public",
        accessMode: "teams",
        teamIds: ["550e8400-e29b-41d4-a716-446655440000"],
      }).success,
    ).toBe(true);
    // teamIds without the visibility/accessMode pairing is rejected.
    expect(
      SkillUpdateSchema.safeParse({
        teamIds: ["550e8400-e29b-41d4-a716-446655440000"],
      }).success,
    ).toBe(false);
  });
});

describe("SkillSlugSchema", () => {
  it("accepts kebab-case ≤ 80, rejects bad shapes and over-length", () => {
    expect(SkillSlugSchema.safeParse("my-skill-1").success).toBe(true);
    expect(SkillSlugSchema.safeParse("My_Skill").success).toBe(false);
    expect(SkillSlugSchema.safeParse("-leading").success).toBe(false);
    expect(SkillSlugSchema.safeParse("a".repeat(81)).success).toBe(false);
  });
});

describe("SkillFileWriteSchema body ceiling", () => {
  it("caps the body at 1 MB", () => {
    expect(SkillFileWriteSchema.safeParse({ body: "a".repeat(1_048_576) }).success).toBe(true);
    expect(SkillFileWriteSchema.safeParse({ body: "a".repeat(1_048_577) }).success).toBe(false);
  });
});
