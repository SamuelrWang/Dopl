/**
 * 🔒 **THE MCP PACKAGE'S HAND-MIRRORED KNOWLEDGE CAPS, PINNED TO THEIR SOURCES.**
 *
 * `packages/mcp-server` cannot import `src/`, so it restates two numbers: the
 * `dopl_kb` input shape's `body` max, and the limits its `write_file` refusals
 * quote (`tools/knowledge-validation.ts`). Its own comment said a
 * `knowledge-validation.test.ts` pinned the pair; no such file ever existed
 * (cleanup K05). A refusal quoting a number BELOW the server's real bound
 * refuses a legal write, so a drift here is a wrong answer, not a cosmetic one.
 *
 * ⚠ BEHAVIOURAL, not a source-text probe (Brief): the cases run the real
 * package code — the registered `dopl_kb` schema parses bodies at the bound,
 * and the real refusal mapper renders the limit it quotes.
 *
 * MUTATION-VERIFY (each alone turns the named case red):
 *  - `MB_LIMIT_CHARS = 1_000_000` in knowledge-validation.ts → "body refusal".
 *  - `KB_TEXT_FIELD_MAX = 200` → "excerpt refusal".
 *  - `body: z.string().max(2_000_000)` in knowledge.ts → "input shape".
 */

import { describe, expect, it } from "vitest";
import { z, type ZodRawShape } from "zod";

import { DESCRIPTION_MAX } from "@/config";
import { MAX_BODY_BYTES } from "./schema";
import { registerKnowledgeTools } from "../../../packages/mcp-server/src/tools/knowledge";
import { writeFileValidationError } from "../../../packages/mcp-server/src/tools/knowledge-validation";
import type { RegisterTool } from "../../../packages/mcp-server/src/tools/respond";

/** The real `dopl_kb` input shape, as the package registers it. */
function kbShape(): ZodRawShape {
  let shape: ZodRawShape | null = null;
  const register: RegisterTool = (name, _d, schema) => {
    if (name === "dopl_kb") shape = schema;
  };
  registerKnowledgeTools(register, {} as never, undefined, {} as never);
  expect(shape, "control: dopl_kb was registered").not.toBeNull();
  return shape!;
}

/** The text an agent reads for a 400 naming `field`. */
function refusalFor(field: string): string {
  const res = writeFileValidationError({
    status: 400,
    code: "VALIDATION_FAILED",
    details: [{ path: [field] }],
  });
  expect(res, `control: a ${field} failure is recognised`).not.toBeNull();
  return res!.content[0].text;
}

describe("packages/mcp-server knowledge caps mirror the server's", () => {
  it("input shape: dopl_kb accepts a body of exactly MAX_BODY_BYTES and refuses one more", () => {
    // `ZodRawShape` types its values as zod/v4/core's `$ZodType`, which has no `.safeParse`; the
    // package registers classic schemas, so narrow to the classic type (no runtime change).
    const body = z.object(kbShape()).shape.body as z.ZodType;
    expect(body.safeParse("x".repeat(MAX_BODY_BYTES)).success).toBe(true);
    expect(body.safeParse("x".repeat(MAX_BODY_BYTES + 1)).success).toBe(false);
  });

  it("body refusal quotes schema.ts › MAX_BODY_BYTES", () => {
    expect(refusalFor("body")).toContain(`field=body limit=${MAX_BODY_BYTES} `);
  });

  it("excerpt refusal quotes config › DESCRIPTION_MAX", () => {
    expect(refusalFor("excerpt")).toContain(`field=excerpt limit=${DESCRIPTION_MAX} `);
  });
});
