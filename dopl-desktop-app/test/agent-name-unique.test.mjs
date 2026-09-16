// 🔒 NO TWO ADDRESSABLE AGENTS IN ONE CHANNEL WEAR THE SAME NAME (Samuel's ruling, 2026-09-15).
//
// Verbatim: *"I think we should enforce a rule where no two agents that are addressable can have
// the same name. … If a user launches an agent with the same name, let's just have the name
// auto-renamed to that name and -1. For example, you have coder. Let's say there's already an
// active coder agent. If a user launches another agent called coder, or if their agent launches an
// agent called coder, it will automatically auto-resolve to coder-1. It will auto-resolve to
// coder-2 and so on and so forth. Of course, this is only something that needs to be enforced for
// agents that are in the idle or working state. If an agent is ended, they can't be addressed
// anyway, so it won't matter. They can have duplicate names … It's basically only for addressable
// agents, right?"*
//
// ⚠ **WHAT THIS RULING REPLACED, AND WHY THE REPLACEMENT IS NOT A THIRD SPELLING OF THE SAME
// THING.** Two earlier answers lived in `src/features/channels/lib/agent-mentions.ts`, at RESOLVE
// time, over the live set:
//   • the 2026-09-07 MINT — `coder-1` computed on the fly, so when the agent holding `coder` ended
//     the next one moved up and `@coder-1` came to name a DIFFERENT agent than it did an hour ago;
//   • the 2026-09-15 FAIL-CLOSED — `@coder` reached neither, and the author was told to type an id.
// The suffix is STORED now, decided once at commit, projected to `channel_sessions.display_name`,
// and re-pointed for nobody. **An agent ending frees the bare name for the NEXT launch and
// renames nothing.** That durability is the property these cases exist to hold.
//
// ⚠ **THE PURE BLOCK IS REQUIRED DIRECTLY, not sliced**, because this module has no electron half
// to hide from: `agent-identity-commit.js` is the live wiring and it injects nothing. The one
// thing worth slicing IS checked below — the slugger against `agent-handles.js`'s copy, since a
// naming rule that spells a name differently from the PARSER is a silent "the agent ignored me".

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const MAIN = (f) => join(HERE, "..", "main", f);
const unique = require(MAIN("agent-name-unique.js"));
const handles = require(MAIN("agent-handles.js"));

const CH = "chan-1";
const row = (over = {}) => ({
  agentId: "a1b2c3d4",
  channelId: CH,
  state: "idle",
  displayName: null,
  ...over,
});
/** The siblings one agent competes with, for a launch of `agentId` into `CH`. */
const rivals = (rows, agentId = "zzzzzzzz") =>
  unique.addressableSiblings(rows, agentId, CH);

// ── 1. THE SUFFIX ─────────────────────────────────────────────────────────────

test("a free name is stored EXACTLY as asked — the ordinary launch sees no suffix", () => {
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Scout" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder");
});

test("a taken name becomes `-1`, then `-2`, and so on", () => {
  const one = [row({ agentId: "a1b2c3d4", displayName: "Coder" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(one)), "Coder-1");
  const two = [...one, row({ agentId: "e5f6g7h8", displayName: "Coder-1" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(two)), "Coder-2");
});

test("it takes the LOWEST free suffix, not the next one after the highest", () => {
  // ⚠ WITH `coder` AND `coder-2` RUNNING, THE GAP IS FREE AND IS THE SHORTEST THING TO TYPE —
  // and "the next number after the biggest" would leave a permanent hole every time one ended.
  const rows = [
    row({ agentId: "a1b2c3d4", displayName: "Coder" }),
    row({ agentId: "e5f6g7h8", displayName: "Coder-2" }),
  ];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder-1");
});

test("it compares by SLUG, because the slug is what is addressed", () => {
  // ⚠ Samuel: *"When people type the ads [@s], those should be the slugs."* "Bug Reviewer",
  // "bug reviewer" and "  Bug   Reviewer " are ONE address and therefore one collision; comparing
  // raw strings would let two agents claim `@bug-reviewer` while looking distinct on a card.
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Bug Reviewer" })];
  for (const asked of ["bug reviewer", "BUG REVIEWER", "  Bug   Reviewer  "]) {
    assert.equal(
      unique.nameSlug(unique.uniqueAgentName(asked, rivals(rows))),
      unique.nameSlug(asked) + "-1",
      asked
    );
  }
});

test("`New Agent` collides like any other name", () => {
  // ⚠ IT IS A NAME, NOT A PLACEHOLDER (Samuel: *"just give it the name, New Agent"*), so two
  // blank launches produce `New Agent` and `New Agent-1` rather than two identical cards.
  const rows = [row({ agentId: "a1b2c3d4", displayName: "New Agent" })];
  assert.equal(unique.uniqueAgentName("New Agent", rivals(rows)), "New Agent-1");
});

test("an EMPTY name is returned unchanged — `''` is the CLEAR gesture, not a rename", () => {
  // ⚠ SUFFIXING IT WOULD TURN "unname this agent" INTO A RENAME TO `-1`
  // (`agent-self-ops.js › applyRenameTo` reads `''` as clear).
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder" })];
  for (const blank of ["", "   ", null, undefined]) {
    assert.equal(unique.uniqueAgentName(blank, rivals(rows)), "", JSON.stringify(blank));
  }
});

/**
 * 🔒 **THE SUFFIX MAKES ROOM FOR ITSELF — `agent-names.js › sanitizeName` REFUSES, IT DOES NOT
 * TRIM** (2026-09-15).
 *
 * ⚠ **WITHOUT THE CAP A LEGAL NAME BECAME NO NAME AT ALL.** 60 is `MAX_NAME`, and it is also what
 * `channel-ops-launch-name.ts` invites ("1-60 characters") and what
 * `20261006120000_channel_launch_directives_agent_name.sql` admits — so a caller may send exactly
 * 60. Suffixing that to 62 made `sanitizeName` answer `null`, which
 * `agent-self-ops.js › applyRenameTo` turns into `{ ok: false, reason: 'bad-name' }`: on the
 * launch lane `launch-directive-spawn.js` reports `appliedAgentName: null` and the agent runs
 * NAMELESS, on the rename lane the operator is refused a string they were entitled to.
 */
test("🔒 a name at the 60-char cap still gets a suffix — the stem makes room", () => {
  const base = "x".repeat(60);
  const rows = [row({ agentId: "a1b2c3d4", displayName: base })];
  const out = unique.uniqueAgentName(base, rivals(rows), 60);
  assert.equal(out.length, 60, "the suffixed name must still fit MAX_NAME");
  assert.equal(out, "x".repeat(58) + "-1");
});

test("the cap only bites when it has to — a short name is never trimmed", () => {
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows), 60), "Coder-1");
});

test("no cap is the default — every caller that holds no store is unchanged", () => {
  const base = "x".repeat(60);
  const rows = [row({ agentId: "a1b2c3d4", displayName: base })];
  assert.equal(unique.uniqueAgentName(base, rivals(rows)).length, 62);
});

/** ⚠ A STEM TRIMMED AWAY TO NOTHING WOULD MAKE `-1` THE WHOLE NAME — a handle nobody can type. */
test("an absurd cap never yields a bare suffix", () => {
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder" })];
  const out = unique.uniqueAgentName("Coder", rivals(rows), 2);
  assert.ok(out.replace(/-\d+$/, "").length > 0, `stem must survive: ${out}`);
});

// ── 2. WHO COUNTS AS A RIVAL ──────────────────────────────────────────────────

test("🔒 an ENDED agent neither collides nor is renamed — its name is REUSABLE", () => {
  // ⚠ Samuel: *"If an agent is ended, they can't be addressed anyway, so it won't matter. They
  // can have duplicate names."* This is also what makes the STORED suffix durable: a name freed
  // by an agent stopping goes to the NEXT launch, and nothing already named is rewritten.
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder", state: "ended" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder");
});

test("a WORKING agent collides, like an idle one — 'addressable' is the condition", () => {
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder", state: "working" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder-1");
});

test("an UNRECOGNISED state collides too — the safe direction for a naming rule", () => {
  // ⚠ `ended` IS EXCLUDED BY NAME rather than the two that count being listed, so a FOURTH pill
  // would not silently stop competing.
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder", state: "parked" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder-1");
});

test("another CHANNEL's agent is not a rival — a tag resolves per channel", () => {
  const rows = [row({ agentId: "a1b2c3d4", channelId: "chan-2", displayName: "Coder" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder");
});

test("🔒 the agent ITSELF is not a rival — a no-op save must not walk to `-1`", () => {
  const rows = [row({ agentId: "a1b2c3d4", displayName: "Coder" })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows, "a1b2c3d4")), "Coder");
  // …twice, because the real failure is a rename that creeps one suffix per save.
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows, "a1b2c3d4")), "Coder");
});

test("an UNNAMED sibling contests nothing — it claims no slug", () => {
  const rows = [row({ agentId: "a1b2c3d4", displayName: null }), row({ agentId: "e5f6g7h8", displayName: "  " })];
  assert.equal(unique.uniqueAgentName("Coder", rivals(rows)), "Coder");
});

// ── 3. THE SLUGGER MATCHES THE PARSER ─────────────────────────────────────────

test("🔒 `nameSlug` agrees with `agent-handles.js › agentSlug`, fixture for fixture", () => {
  // ⚠ **A NAMING RULE THAT SPELLS A NAME DIFFERENTLY FROM THE PARSER IS A SILENT "the agent
  // ignored me".** This file's copy exists because `agent-handles.js` declares itself the MENTION
  // PARSER and a writer must not become a dependency of it — but a hand copy with no shared
  // fixture is a drift bomb, so the parser's own contract table is what drives both.
  for (const name of handles.PARITY_NAMES) {
    assert.equal(unique.nameSlug(name), handles.agentSlug(name), JSON.stringify(name));
  }
  assert.ok(handles.PARITY_NAMES.length >= 5, "the fixture table must not be emptied to pass");
});

// ── 4. THE ONE DOOR — every lane goes through the rule because it goes through `commitRename` ──

test("🔒 `commitRename` is where the rule runs, so every launch AND rename lane gets it", () => {
  // ⚠ **THIS IS A SOURCE SWEEP AND IT IS THE STRONGEST THING THIS FILE ASSERTS.** Samuel asked
  // for the rule on *"a user launches an agent … or if their agent launches an agent"* AND on a
  // rename — five call sites between them. What makes that one rule rather than five is that they
  // all already funnel through `agent-identity-commit.js › commitRename`
  // (`launch-directive-agent-ops.test.mjs` pins the three rename lanes by file), so putting the
  // uniqueness check THERE is what makes "every path" true rather than remembered.
  const commit = readFileSync(join(HERE, "..", "main", "agent-identity-commit.js"), "utf8");
  assert.match(commit, /agent-name-unique/, "the rule is reached from the one commit door");
  assert.match(
    commit,
    /uniqueFor\(agentId, value\)/,
    "…and it wraps the value on its way INTO applyRenameTo, not after"
  );
  // ⚠ **AND THE LAUNCH LANE COMMITS THROUGH THAT DOOR TOO** — an agent-filed launch names its
  // agent by calling `commitRename` once the id exists, which is the only moment there is
  // something to key a name to.
  const spawn = readFileSync(join(HERE, "..", "main", "launch-directive-spawn.js"), "utf8");
  assert.match(spawn, /commitRename\(res\.agentId/, "the directive lane names through the door");
  // ⚠ **AND REPORTS BACK WHAT IT GOT**, which is what lets an orchestrator tag the right agent
  // after the rule appended a `-1`.
  assert.match(spawn, /appliedAgentName/, "the applied name is echoed to the launcher");
});

test("🔒 the rule NEVER blocks a rename — a naming rule may not fail a launch", () => {
  // ⚠ `uniqueFor` CATCHES EVERYTHING AND RETURNS THE WANTED NAME. Two agents sharing a tag is a
  // resolvable annoyance; a spawn that did not happen because a string could not be chosen is not.
  const commit = readFileSync(join(HERE, "..", "main", "agent-identity-commit.js"), "utf8");
  assert.match(commit, /catch \(err\)/, "the uniqueness read is guarded");
  assert.match(commit, /return value;/, "…and the fail-open answer is the name as asked");
});
