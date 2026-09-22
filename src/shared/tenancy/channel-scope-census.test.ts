/**
 * 🔒 **THE CHANNEL-SCOPE CENSUS** — every place in the tree that names a CHANNEL
 * as the scope of a resource, and the fence each one stands behind.
 *
 * Samuel's ruling, 2026-09-17: *"In workspaces, resource access is not scoped by
 * channels. It's instead scoped by teams."* The mechanism is not deleted — a
 * HOME channel is a `kind='link'` container holding one channel, and "share into
 * this channel" there IS the container grant. So the rule is a FENCE BY
 * CONTAINER KIND, and a fence spread over a dozen files is one somebody adds a
 * thirteenth site to.
 *
 * ── WHAT THIS ASSERTS, AND WHY IT IS EQUALITY ──────────────────────────────
 *
 *   1. The DISCOVERED set of files carrying a channel-scope arm **equals** the
 *      declared set below. ⚠ EQUALITY, not `includes` — the shape
 *      `scripts/check-rls-pair-gate.ts` and `tool-profile.test.ts` both use,
 *      because a subset check is how the thirteenth site ships unnoticed.
 *   2. Every file declared `fence: "kind"` actually REACHES a container-kind
 *      test — `channel-scope.ts`, `isStandardWorkspace`, or a literal `'link'` /
 *      `'standard'` kind comparison. A declaration is a claim; this checks it.
 *   3. Every file declared `fence: "exempt"` carries a WHY here, in one line.
 *
 * ⚠ **IT IS A GREP, AND A GREP CANNOT SEE A RULE — ONLY A REFERENCE.** It proves
 * that a kind test is present in the file, never that the right one runs on the
 * right path. That is what `channel-scope.test.ts`, `resource-grant-reach.test.ts`,
 * `shared/grants/service.test.ts` and `service-channel-grants.test.ts` prove, one
 * door at a time. This file's job is that the LIST does not grow in silence.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

/** The trees a channel-scope arm could live in. */
const SCANNED = ["src", join("apps", "desktop-ui", "src"), join("packages", "mcp-server", "src")];

/**
 * What counts as naming a channel AS A SCOPE. ⚠ Deliberately narrow: `channelId`
 * is everywhere and means nothing here. These are the four spellings the grant
 * table, its wire shape and the ontology share table are actually written in.
 */
const CHANNEL_SCOPE = [
  /scope_type[^\n]{0,40}["']channel["']/,
  /scopeType[^\n]{0,40}["']channel["']/,
  /scope:\s*["']channel["']/,
  /ontology_channel_shares/,
];

type Fence = "kind" | "exempt";

/**
 * ⚠ ONE ROW PER FILE, and the `why` on an `exempt` row is the whole value of
 * that row: an exemption with no reason is indistinguishable from an oversight.
 */
const DECLARED: Array<{ file: string; fence: Fence; why: string }> = [
  {
    file: "src/shared/tenancy/resource-grant-reach.ts",
    fence: "kind",
    why: "the READ arm: `channelsWhereScopeIsIgnored` drops standard-container channel rows",
  },
  {
    file: "src/shared/grants/service.ts",
    fence: "kind",
    why: "the WRITE door behind PUT /api/resource-grants and both MCP grant ops (fence 3b)",
  },
  {
    file: "src/shared/grants/schema.ts",
    fence: "exempt",
    why: "the zod SHAPE only — it mirrors the SQL CHECK, and `channel` stays a legal scope for home containers",
  },
  {
    file: "src/features/knowledge/server/repository-channel-grants.ts",
    fence: "exempt",
    why: "raw I/O with no auth opinion (§2); its ONE service caller `setChannelKnowledgeGrant` carries the fence",
  },
  {
    file: "src/features/knowledge/server/repository-audience.ts",
    fence: "kind",
    why: "the AGENT ceiling lane; `service-audience.ts › resolveAgentAudience` answers `unrestricted` for every kind but `link`",
  },
  {
    file: "src/features/ontology/server/repository-shares.ts",
    fence: "kind",
    why: "`findWorkspaceKind` is read here for `service-shares.ts`'s Q5 fence — home channels only, since 2026-09-09",
  },
  {
    file: "src/shared/supabase/rls-redteam-fixture.ts",
    fence: "exempt",
    why: "a TEST fixture that builds grant rows at every scope on purpose, including the refused one",
  },
  {
    file: "packages/mcp-server/src/tools/agent.ts",
    fence: "exempt",
    why: "an EXAMPLE string in a tool description; the op's own refusal is `grant.ts › channelScopeRefusal`",
  },
];
// ⚠ **ONE ENTRY LEFT THIS LIST ON 2026-09-22, AND IT LEFT WITH ITS FILE.**
// `apps/desktop-ui/src/pages/home/agent-share.tsx` ("the /home face, which only
// ever runs inside a `kind='link'` container") was DELETED when Samuel ruled the
// agent card's control a LAUNCH; the grant's only door is `dopl_agent(op="grant")`
// now, which this census already covers through `packages/mcp-server/src/tools/
// agent.ts` and `src/shared/grants/schema.ts`. A declaration outliving its file
// is what the EXACTLY in this suite's name exists to catch, in both directions.

/** A container-kind test, in any of the spellings the tree uses. */
const KIND_TEST =
  /channel-scope|isStandardWorkspace|findWorkspaceKind|["']standard["']|["']link["']/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** ⚠ Line-level, so a match inside a `//` or ` * ` comment does not count — the
 *  census is about ARMS, and the docblocks in this tree talk about channel
 *  scope constantly. A file whose ONLY mention is prose is not a site. */
function carriesChannelScopeArm(source: string): boolean {
  return source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .some((line) => CHANNEL_SCOPE.some((re) => re.test(line)));
}

const discovered = SCANNED.flatMap((tree) => walk(join(ROOT, tree)))
  .filter((file) => carriesChannelScopeArm(readFileSync(file, "utf8")))
  .map((file) => relative(ROOT, file).split(sep).join("/"))
  .sort();

describe("🔒 the channel-scope census (Samuel's ruling 2026-09-17)", () => {
  it("discovers EXACTLY the declared set of channel-scope sites", () => {
    // ⚠ A NEW SITE FAILS HERE UNTIL IT DECLARES ITS FENCE. That is the gate: the
    // rule is spread across features, and nothing else notices a thirteenth one.
    expect(discovered).toEqual(DECLARED.map((d) => d.file).sort());
  });

  it("every `fence: \"kind\"` site actually REACHES a container-kind test", () => {
    for (const row of DECLARED.filter((d) => d.fence === "kind")) {
      const source = readFileSync(join(ROOT, row.file), "utf8");
      expect(KIND_TEST.test(source), `${row.file} — ${row.why}`).toBe(true);
    }
  });

  it("every exemption carries a reason, and no row is blank", () => {
    for (const row of DECLARED) {
      expect(row.why.length, row.file).toBeGreaterThan(20);
    }
  });

  it("🔒 the two DOORS of the rule are both `kind`-fenced", () => {
    // ⚠ Named individually rather than counted: these are the write door and the
    // read arm, and a census that only counted rows would let either become
    // `exempt` with a plausible sentence.
    const byFile = new Map(DECLARED.map((d) => [d.file, d.fence]));
    expect(byFile.get("src/shared/grants/service.ts")).toBe("kind");
    expect(byFile.get("src/shared/tenancy/resource-grant-reach.ts")).toBe("kind");
  });

  it("🔒 `channel-scope.ts` is NOT a site, and that is the shape of the rule", () => {
    // ⚠ It never writes a `scope_type` literal of its own — it takes CHANNEL IDS
    // and answers about their CONTAINERS. A census row for it would be a fence
    // declaring itself fenced. What matters is that it still exists and still
    // spells the test positively, which `channel-scope.test.ts` proves.
    expect(discovered).not.toContain("src/shared/tenancy/channel-scope.ts");
    const source = readFileSync(
      join(ROOT, "src/shared/tenancy/channel-scope.ts"),
      "utf8"
    );
    expect(source).toMatch(/isStandardWorkspace\(/);
  });

  it("🔒 the knowledge write door calls the fence, though it names no scope string", () => {
    // ⚠ `service-channel-grants.ts` is NOT in the census — its channel-ness is in
    // the repository it calls, not in a `scope_type` literal of its own. It is
    // still a write door, so it is asserted by NAME here rather than trusted to
    // be found by a grep that cannot see it.
    const source = readFileSync(
      join(ROOT, "src/features/knowledge/server/service-channel-grants.ts"),
      "utf8"
    );
    expect(source).toMatch(/assertChannelScopeAllowedInContainer\(/);
  });
});
