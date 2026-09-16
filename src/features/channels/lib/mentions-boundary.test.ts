import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mentionHandleOf, mentionTokensOf } from "./mentions";

/**
 * INVARIANT SUITE — **WHERE A TAG MAY BEGIN, IN EVERY TREE THAT PARSES ONE** (F-706, 2026-09-16).
 *
 * 🔒 **AN `@` INSIDE A WORD STARTS NO TOKEN.** `MENTION_TOKEN_RE` had no boundary before the
 * `@`, so `sam@example.com` produced the handle `example.com` — which no roster and no agent
 * index answers to. On the write path that is not a harmless non-match: an UNRESOLVED handle is
 * how `server/service-wake-verdict.ts › namedButUnresolved` knows the author named somebody, so
 * it turned RR3 off and stored `delivery='unreachable'`. **An ordinary email address in a
 * message woke nobody and reported a miss that had not happened.**
 *
 * ⚠ **THREE TREES CARRY THE RULE AND NONE CAN IMPORT ANOTHER**, so this file drives all three
 * over ONE fixture table:
 *   1. `lib/mentions.ts › MENTION_TOKEN_RE` — the web/server parser. **It wins.**
 *   2. `dopl-desktop-app/main/agent-handles.js › TOKEN_RE` — main's hand copy, read as SOURCE
 *      (that tree is not in this vitest project's module graph — the seam
 *      `agent-color-schema.test.ts` takes, for its reason).
 *   3. `dopl-desktop-app/main/session-dispatch.js › mentionedAgentIds` — the id-form parser,
 *      which has carried `(?<![a-z0-9-])` since it was written and is the reason the DESKTOP
 *      never had this bug. It is asserted here so the three cannot drift apart again.
 *
 * ⚠ `packages/mcp-server` carries no tokenizer — `channel-post-guidance.ts › AGENT_HANDLE_RE` is
 * an anchored whole-string test, not a scanner — so there is no fourth copy to pin.
 */

const MAIN = (f: string) =>
  readFileSync(join(process.cwd(), "dopl-desktop-app", "main", f), "utf8");

/** One regex literal, lifted out of a main-process module by name. */
function mainRegex(file: string, name: string): RegExp {
  const src = MAIN(file);
  const m = src.match(new RegExp(`const ${name} = (/.*/[gimsuy]*);`));
  expect(m, `${file} › ${name} not found`).toBeTruthy();
  return new Function(`return ${m![1]};`)() as RegExp;
}

/** `[body, the handles it should yield]` — one table, three parsers. */
const FIXTURES: Array<[string, string[]]> = [
  // ── THE DEFECT ────────────────────────────────────────────────────────────
  ["email me at sam@example.com", []],
  ["sam@example.com", []],
  ["reply-to: a.b+c@sub.example.co.uk please", []],
  ["v2@thing", []],
  // ── EVERY WRAPPER THAT MUST STILL TAG ─────────────────────────────────────
  // ⚠ `_` IS NOT IN THE CLASS — see MENTION_TOKEN_RE. A local part ending in `_` is the price
  // of `__@diana__` still tagging, and emphasis is how people write.
  ["sam_@example.com", ["example.com"]],
  ["@diana", ["diana"]],
  ["__@diana__", ["diana"]],
  ["_@diana_", ["diana"]],
  ["hey @diana", ["diana"]],
  ["**@diana**", ["diana"]],
  ["(@diana)", ["diana"]],
  ["<b>@diana</b>", ["diana"]],
  ["line one\n@diana", ["diana"]],
  ["ship it @here", ["here"]],
  ["@agent-k3v7d2mq go", ["agent-k3v7d2mq"]],
  ["@diana and @prime", ["diana", "prime"]],
];

describe("a tag begins a word, or begins the line", () => {
  for (const [body, expected] of FIXTURES) {
    it(`🔒 ${JSON.stringify(body)} → ${JSON.stringify(expected)}`, () => {
      expect(mentionTokensOf(body).map(mentionHandleOf)).toEqual(expected);
    });
  }

  /**
   * 🔒 **MAIN'S HAND COPY ANSWERS THE SAME TABLE.** It has no `mentionHandleOf` here, so the
   * comparison is on the TOKENS — which is where the boundary lives; the trailing-punctuation
   * strip is pinned separately in that tree's own suite.
   */
  it("🔒 `main/agent-handles.js › TOKEN_RE` matches the same spans", () => {
    const tokenRe = mainRegex("agent-handles.js", "TOKEN_RE");
    for (const [body] of FIXTURES) {
      expect(body.match(new RegExp(tokenRe.source, "g")) ?? [], body).toEqual(
        mentionTokensOf(body)
      );
    }
  });

  /** ⚠ THE MASK BLANKS WITH SPACES, NEVER WITH LETTERS — so a handle straight after a masked
   *  region still tags, and the boundary cannot silently eat one. */
  it("🔒 a handle straight after a code span still tags", () => {
    expect(mentionTokensOf("`code` @diana").map(mentionHandleOf)).toEqual(["diana"]);
  });

  /** 🔒 **THE DESKTOP'S ID PARSER ALREADY HAD THIS BOUNDARY**, which is why only the server was
   *  affected. Pinned so the three copies cannot drift apart again. */
  it("🔒 `main/session-dispatch.js › mentionedAgentIds` carries its own boundary", () => {
    expect(MAIN("session-dispatch.js")).toContain("(?<![a-z0-9-])@(?:agent-)?");
  });
});
