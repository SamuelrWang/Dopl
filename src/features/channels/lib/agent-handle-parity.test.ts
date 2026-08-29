/**
 * 🔒 ONE HANDLE CONVENTION, TWO TREES — the parity half of Samuel's F-350 ruling (2026-08-28).
 *
 * ⚠ THE COPY THIS GUARDS. `dopl-desktop-app/main/agent-handles.js › agentSlug` / `› handleOf` are
 * HAND COPIES of {@link mentionSlug} and {@link mentionHandleOf}, because main cannot import this
 * tree's TypeScript. A hand-copied convention is a drift bomb and this one's failure is silent and
 * indistinguishable from "the agent ignored me": the picker writes a handle, the transcript tints
 * it, and the machine that owns the agent quietly resolves nobody. That is F-350 exactly, and it
 * shipped once already.
 *
 * ⚠ IT RUNS THE REAL CODE, NOT A DESCRIPTION OF IT. The desktop file's `AGENT-HANDLES-PURE` block
 * is sliced out of source and evaluated here, then driven over the SAME fixture rows the desktop's
 * own `test/agent-handles.test.mjs` uses — the rows live in that file, so neither suite can quietly
 * test a different list. This is the `deep-link-target.js` / `routes.tsx` pairing, and the
 * `mentions-tint-parity.test.ts` idiom: two ends held against each other, because two suites each
 * agreeing with themselves is not the same thing.
 *
 * ⚠ WHAT IT DOES NOT DO: import from the desktop tree. `src/**` may not depend on
 * `dopl-desktop-app/**` — the two ship on different cadences — so this READS the file, the way
 * every source sweep in this repo does.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mentionHandleOf, mentionSlug } from "./mentions";
import { agentMentionHandle } from "./agent-mentions";

const DESKTOP_MODULE = path.join(
  import.meta.dirname,
  "..", "..", "..", "..",
  "dopl-desktop-app", "main", "agent-handles.js"
);

const SRC = readFileSync(DESKTOP_MODULE, "utf8");

/** The desktop's pure block, evaluated. ⚠ Sliced rather than `require`d so this suite proves the
 *  block really is self-contained — a `require` sneaking into it would throw here. */
function desktopHandles(): {
  agentSlug: (s: unknown) => string;
  handleOf: (t: unknown) => string;
  PARITY_NAMES: string[];
  PARITY_TOKENS: string[];
} {
  const begin = SRC.indexOf("// ─── BEGIN AGENT-HANDLES-PURE");
  const end = SRC.indexOf("// ─── END AGENT-HANDLES-PURE");
  expect(begin, "the desktop pure block's BEGIN sentinel is gone").toBeGreaterThan(-1);
  expect(end, "the desktop pure block's END sentinel is gone").toBeGreaterThan(begin);
  const block = SRC.slice(begin, end);
  return new Function(
    `${block}\n return { agentSlug, handleOf, PARITY_NAMES, PARITY_TOKENS };`
  )() as ReturnType<typeof desktopHandles>;
}

const desktop = desktopHandles();

describe("the desktop's slug rule IS this tree's", () => {
  it("reads a real fixture table (a silent empty sweep passes forever)", () => {
    // ⚠ THE LENGTHS ARE ASSERTED ON BOTH SIDES, so deleting a row to make a parity failure go
    // away fails the desktop suite instead.
    expect(desktop.PARITY_NAMES).toHaveLength(7);
    expect(desktop.PARITY_TOKENS).toHaveLength(15);
  });

  it.each(["Research Bot", "  RESEARCH   Bot  ", "Scout", "deploy bot 2", "", "   "])(
    "slugs %j identically",
    (name) => {
      expect(desktop.agentSlug(name)).toBe(mentionSlug(name));
    }
  );

  it("agrees on EVERY shared fixture name", () => {
    for (const name of desktop.PARITY_NAMES) {
      expect(desktop.agentSlug(name), `slug drift on ${JSON.stringify(name)}`).toBe(
        mentionSlug(name)
      );
    }
  });

  it("tolerates what TypeScript's types forbid, and answers the same for it", () => {
    // ⚠ MAIN TAKES ITS INPUT OFF A STORE, so it must survive null/undefined where `mentionSlug`
    // is typed `string`. It must answer `""` — never `"null"`, which would be a claimable handle.
    expect(desktop.agentSlug(null)).toBe("");
    expect(desktop.agentSlug(undefined)).toBe("");
  });
});

describe("the desktop's token strip IS this tree's", () => {
  it("agrees on EVERY shared fixture token", () => {
    for (const token of desktop.PARITY_TOKENS) {
      // ⚠ `mentionHandleOf` answers `null` for "not a handle"; the desktop answers `""`. That is
      // the ONE deliberate signature difference — main has no null-handling caller — so the
      // comparison normalises it rather than pretending the shapes match.
      expect(desktop.handleOf(token), `token drift on ${JSON.stringify(token)}`).toBe(
        mentionHandleOf(token) ?? ""
      );
    }
  });

  it("agrees on the F-266 emphasis characters specifically", () => {
    // ⚠ NAMED SEPARATELY BECAUSE THEY ARE THE ROW THAT COST A WAVE. `**@x**` tints; a punctuation
    // class without `*` `_` `~` stamps nobody. If the desktop copy ever loses them, the name door
    // reopens the exact defect the id door already had.
    for (const token of ["@research-bot**", "@research-bot__", "@research-bot~~"]) {
      expect(desktop.handleOf(token)).toBe(mentionHandleOf(token) ?? "");
      expect(desktop.handleOf(token)).toBe("research-bot");
    }
  });

  it("agrees that leading punctuation is NOT stripped", () => {
    expect(desktop.handleOf("@(research-bot")).toBe(mentionHandleOf("@(research-bot") ?? "");
    expect(desktop.handleOf("@(research-bot")).toBe("(research-bot");
  });
});

describe("the round trip the ruling is about", () => {
  it("what THIS tree's picker inserts is what the DESKTOP's parser reads back", () => {
    // ⚠ THE WHOLE OF F-350 IN ONE ASSERTION, from the real renderer function. `agentMentionHandle`
    // is what `composer-mentions.tsx › mentionSuggestions` puts in the draft; the desktop's
    // `handleOf` is what `session-dispatch.js › mentionedAgentIds` looks up. They must produce the
    // same string, or the operator's blue token reaches nobody.
    const renamed = { agentId: "k3v7d2mq", displayName: "Research Bot" };
    const handle = agentMentionHandle(renamed);
    expect(handle).toBe("research-bot");
    expect(desktop.handleOf(`@${handle}`)).toBe(handle);
    // ⚠ AND THE DESKTOP MUST DERIVE THE SAME HANDLE FROM THE NAME ALONE, which is what lets it
    // build its index without ever seeing what the picker wrote.
    expect(desktop.agentSlug(renamed.displayName)).toBe(handle);
  });

  it("holds for an UNRENAMED agent, which takes the id door instead", () => {
    const handle = agentMentionHandle({ agentId: "zzzzzzzz", displayName: null });
    expect(handle).toBe("agent-zzzzzzzz");
    // ⚠ THE ID DOOR IS THE DISPATCH REGEX'S, not the slug index's — so the right assertion here is
    // that the slug rule claims NOTHING for an unnamed agent and cannot shadow it.
    expect(desktop.agentSlug(null)).toBe("");
  });

  it("holds through a name that needs slugging AND a token that needs stripping", () => {
    const handle = agentMentionHandle({ agentId: "k3v7d2mq", displayName: "Deploy Bot 2" });
    expect(handle).toBe("deploy-bot-2");
    // As it would appear at the end of a sentence, bolded — both strips, both trees.
    expect(desktop.handleOf(`@**${handle}**.`)).toBe(mentionHandleOf(`@**${handle}**.`) ?? "");
  });
});
