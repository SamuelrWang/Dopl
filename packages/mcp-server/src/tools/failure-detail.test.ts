/**
 * `failureDetail` — upstream failure text rendered as a VALUE (a code span), never as prose, in
 * the chats and skills tools. Both modules export it (`chats-render.ts`, `skills-shared.ts`); since
 * cleanup M04 both re-export the one copy in `failure-detail.ts`, and these cases pin that each
 * entry point still answers identically.
 *
 * MUTATION-VERIFY (each alone turns cases red):
 *  - read `String(e)` only (drop the `.message` branch) → "an Error's message".
 *  - change the fallback to "`no detail`" → "blank".
 */

import { describe, expect, it } from "vitest";
import { failureDetail as fromChats } from "./chats-render";
import { failureDetail as fromSkills } from "./skills-shared";

const CASES: Array<[string, unknown, string]> = [
  ["an Error's message", new Error("boom"), "`boom`"],
  ["an api-error-shaped object's message", { message: "SKILL_NOT_FOUND: gone", status: 404 }, "`SKILL_NOT_FOUND: gone`"],
  ["a thrown string", "plain", "`plain`"],
  ["blank", new Error("   "), "`no detail reported`"],
];

describe.each([
  ["chats-render", fromChats],
  ["skills-shared", fromSkills],
])("failureDetail via %s", (_name, failureDetail) => {
  it.each(CASES)("%s", (_label, input, expected) => {
    expect(failureDetail(input)).toBe(expected);
  });

  it("a backtick in the text cannot close the span early", () => {
    const out = failureDetail(new Error("a`b"));
    expect(out).toBe(fromChats(new Error("a`b")));
    expect(out.startsWith("`")).toBe(true);
    expect(out).not.toBe("`a`b`");
  });
});
