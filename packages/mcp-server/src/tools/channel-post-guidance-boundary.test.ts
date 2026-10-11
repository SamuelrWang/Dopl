/**
 * 🔒 A TAG BEGINS A WORD, OR BEGINS THE LINE — the MCP copy of the mention scanner answers the
 * app's boundary table (`src/features/channels/lib/mentions-boundary.test.ts › FIXTURES`).
 *
 * `channel-post-guidance.ts › classifyMentions` is what `tags=<resolved>/<attempted>` counts the
 * ATTEMPTED half from. When the app's `lib/mentions.ts › MENTION_TOKEN_RE` gained its
 * `(?<![A-Za-z0-9])` boundary (ea066fea, 2026-09-16) this copy did not, so a body that merely
 * contained an email (`sam@example.com`) reported `tags=0/1` — "you tagged nobody" — over a
 * body the server parsed as tag-free (fixed 2026-10-11, cleanup M02).
 *
 * ⚠ WHAT IS PINNED IS THE SPAN COUNT, row for row, because that is what the boundary decides and
 * what `tags=` reports. The TOKEN TEXT differs from the app's `mentionHandleOf` by design
 * (`stripTrailing` keeps `_`, so `__@diana__` is `diana__` here); the plain rows also pin it.
 * Mirror this table if the app's ever changes.
 */
import { describe, expect, it } from "vitest";
import { classifyMentions } from "./channel-post-guidance";

/** `[body, how many handles the app's parser yields]` — the app's table, row for row. */
const FIXTURES: Array<[string, number]> = [
  // ── THE DEFECT: an address is not a tag ──────────────────────────────────
  ["email me at sam@example.com", 0],
  ["sam@example.com", 0],
  ["reply-to: a.b+c@sub.example.co.uk please", 0],
  ["v2@thing", 0],
  // ── EVERY WRAPPER THAT MUST STILL TAG (leading punctuation included) ─────
  ["sam_@example.com", 1],
  ["@diana", 1],
  ["__@diana__", 1],
  ["_@diana_", 1],
  ["hey @diana", 1],
  ["**@diana**", 1],
  ["(@diana)", 1],
  ["<b>@diana</b>", 1],
  ["line one\n@diana", 1],
  ["ship it @here", 1],
  ["@agent-k3v7d2mq go", 1],
  ["@diana and @prime", 2],
];

describe("classifyMentions answers the app's boundary table", () => {
  for (const [body, count] of FIXTURES) {
    it(`🔒 ${JSON.stringify(body)} → ${count} attempted`, () => {
      expect(classifyMentions(body)).toHaveLength(count);
    });
  }

  it("🔒 the plain rows keep their token and kind", () => {
    expect(classifyMentions("hey @diana")).toEqual([{ token: "diana", kind: "handle" }]);
    expect(classifyMentions("(@diana)")).toEqual([{ token: "diana", kind: "handle" }]);
    expect(classifyMentions("@agent-k3v7d2mq go")).toEqual([
      { token: "agent-k3v7d2mq", kind: "agent" },
    ]);
    expect(classifyMentions("see foo@bar and @agent-x2sz1ztt")).toEqual([
      { token: "agent-x2sz1ztt", kind: "agent" },
    ]);
  });
});
