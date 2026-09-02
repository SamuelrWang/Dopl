// THE FOURTH PROFILE — `channel_agent` (2026-09-02, Samuel's ruling B7), and the freeze that
// keeps it off a runtime that does not ship (ruling X0).
//
// THE RULING, IN ONE SENTENCE. *A session launched into a SHARED channel runs at `full` MINUS
// `Bash` — defense in depth: with a shell AND its own bearer, an agent can reach the REST API
// over loopback directly and every fence that lives at the MCP layer stops mattering.*
//
// ⚠ WHAT THIS FILE ASSERTS IS THE WIRE, NOT THE DERIVATION (C7's precedent). Every name is
// checked BY NAME against the structure a launch really hands the SDK / the gate — never by
// reading `CHANNEL_AGENT_BUILTIN_BOUND` back out of the module that computed it. A derivation
// that quietly stopped subtracting would still read correctly from its own constant.
//
// ⚠ AND THE DELTA IS ASSERTED IN BOTH DIRECTIONS. "Bash is denied" is half a test: the ruling is
// `full` MINUS the shell, so what must also hold is that NOTHING ELSE moved — the offer, the
// pre-approvals, the Dopl policy and the rest of the floor are `full`'s, exactly. A fourth
// hand-list would pass the first half and fail the second, which is the failure this shape is
// aimed at.
//
// ⚠ X0 IS A FREEZE AND NOT AN OMISSION. Cursor's `descriptor.session.interrupt` is `'unverified'`
// — *"Dopl cannot own a session it cannot stop"* — so its containment table stays at three
// profiles and `contract.js › LAUNCH_BLOCKING[1]` refuses a launch at the fourth. Pinned here so
// the freeze cannot rot into a silent fall-through to `full`'s config.
//
// Run: `node --test dopl-desktop-app/test/channel-agent-profile.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { boot, WS, CH, row } from "./_launch-directive-harness.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const MAIN = join(HERE, "..", "main");
const M = (...p) => require(join(MAIN, ...p));
const readMain = (...p) => readFileSync(join(MAIN, ...p), "utf8");

const PROFILES = M("tool-profiles.js");
const CLAUDE = M("runtime", "claude", "tools.js");
const CODEX = M("runtime", "codex", "tools.js");
const CURSOR = M("runtime", "cursor", "tools.js");
const REGISTRY = M("runtime", "index.js");
const capability = REGISTRY.capability;
const parkOnClaim = M("session-park-on-claim.js");
const WIN = M("targeting-window.js");

const SHELL = ["Bash", "BashOutput", "KillShell"];
/** Set difference as a sorted array — what one config offers/denies and the other does not. */
const minus = (a, b) => a.filter((n) => b.indexOf(n) === -1).sort();

// ── 1. THE CLAUDE LANE — the wire, by name, both directions ──────────────────────────────────

test("SDK: `channel_agent` denies the whole shell BY NAME, on the list the gate reads first", () => {
  // ⚠ `disallowedTools` is `grantDecision` step 1 — the one verdict no task grant and no
  // `bypass` mode can open. A shell name absent from HERE is a shell an Axis-A floor can reopen.
  const cfg = CLAUDE.buildSessionToolConfig("channel_agent");
  for (const name of SHELL) {
    assert.ok(cfg.disallowedTools.includes(name), `channel_agent must hard-deny ${name}`);
  }
});

test("SDK: the shell is not OFFERED either — absent from the positive built-in bound", () => {
  // ⚠ THE OTHER HALF, AND IT IS NOT REDUNDANT. `builtinTools` is L0: a name absent from it is
  // never in the model's context at all, so the three tool schemas stop being paid for as well
  // as stop being runnable. Denying without un-offering leaves context nobody can use.
  const cfg = CLAUDE.buildSessionToolConfig("channel_agent");
  for (const name of SHELL) {
    assert.equal(cfg.builtinTools.includes(name), false, `channel_agent must not offer ${name}`);
  }
  assert.ok(cfg.builtinTools.length > 0, "it is still a POSITIVE bound, not an empty one");
});

test("SDK: the delta from `full` is EXACTLY the shell, and nothing else moved", () => {
  // ⚠ THE RULING IS A SUBTRACTION. This is the assertion a fourth hand-list fails: it would deny
  // the shell (case 1) while quietly differing somewhere else.
  const full = CLAUDE.buildSessionToolConfig("full");
  const ca = CLAUDE.buildSessionToolConfig("channel_agent");
  assert.deepEqual(minus(full.builtinTools, ca.builtinTools), SHELL.slice().sort(),
    "the offer loses the shell");
  assert.deepEqual(minus(ca.builtinTools, full.builtinTools), [],
    "and gains nothing full did not already offer");
  assert.deepEqual(minus(ca.disallowedTools, full.disallowedTools), SHELL.slice().sort(),
    "the floor gains the shell");
  assert.deepEqual(minus(full.disallowedTools, ca.disallowedTools), [],
    "and loses nothing from the universal floor");
  assert.deepEqual(ca.preApproved, full.preApproved, "the pre-approvals are full's, unchanged");
  assert.equal(ca.doplToolsPolicy, null, "the Dopl surface is full's — the ruling removes a SHELL");
});

test("SDK: the shell is REMOVED, not merely gated — no Axis-A mode can reopen it", () => {
  // The stakes, pinned so the profile cannot drift into folklore. `bypass` is the widest mode and
  // it classifies the shell (ESCALATION_TOOLS), so under `full` these run; under `channel_agent`
  // the name is on the deny list `grantDecision` checks BEFORE Axis A is consulted at all.
  for (const name of SHELL) {
    assert.equal(CLAUDE.toolModeAllows("bypass", name), true,
      `${name} really is classified at the widest mode — otherwise this profile proves nothing`);
  }
});

test("G18: WebFetch / WebSearch SURVIVE — the residual is narrowed, not closed", () => {
  // ⚠ RECORDED, NOT GLOSSED. The ruling is "full minus Bash"; web reads are a separate per-profile
  // group, so one outbound path that does not cross the approve-out gate remains. Asserting it
  // keeps the ledger honest — if this ever goes red the guardrail row changed and should be said.
  const ca = CLAUDE.buildSessionToolConfig("channel_agent");
  for (const name of ["WebFetch", "WebSearch"]) {
    assert.ok(ca.builtinTools.includes(name), `${name} is still offered under channel_agent`);
    assert.equal(ca.disallowedTools.includes(name), false, `${name} is not denied`);
  }
});

// ── 2. THE HEADLESS LANE ─────────────────────────────────────────────────────────────────────

test("HEADLESS: `channel_agent` is `full`'s ONE FLAG over `full`'s floor plus the shell", () => {
  const args = PROFILES.buildRestrictionArgs("channel_agent", "/tmp/scoped.json");
  assert.deepEqual(args.slice(0, 1), ["--disallowedTools"],
    "one flag, exactly like full: no --tools, no --allowedTools, no --settings, no --strict-mcp-config");
  assert.equal(args.length, 2);
  const denied = args[1].split(",");
  for (const name of SHELL) assert.ok(denied.includes(name), `headless must deny ${name}`);
  for (const name of PROFILES.UNIVERSAL_HARD_DENY) {
    assert.ok(denied.includes(name), `the universal floor still applies: ${name}`);
  }
  assert.deepEqual(minus(denied, PROFILES.buildRestrictionArgs("full").slice(1)[0].split(",")),
    SHELL.slice().sort(), "and the delta from full's flag is exactly the shell");
});

test("HEADLESS: it emits NO positive bound and NO allow list — it narrows by deny", () => {
  // ⚠ Pre-approving a subset would SHADOW those names past the gate, which is a widening dressed
  // as a restriction. `full`'s shape, deliberately.
  assert.deepEqual(PROFILES.buildBuiltinTools("channel_agent"), []);
  assert.deepEqual(PROFILES.buildAllowedTools("channel_agent"), []);
});

// ── 3. THE FLOOR AND THE OTHER THREE PROFILES ARE UNCHANGED ──────────────────────────────────

test("the hard-deny floor did not move: 9 names, and `full` still carries exactly them", () => {
  // §11's number, and the whole point of the fourth profile is that it is ADDITIVE.
  assert.equal(PROFILES.UNIVERSAL_HARD_DENY.length, 9);
  assert.deepEqual(CLAUDE.buildSessionToolConfig("full").disallowedTools,
    PROFILES.UNIVERSAL_HARD_DENY.slice());
  assert.deepEqual(PROFILES.buildDeniedTools("full"), PROFILES.UNIVERSAL_HARD_DENY.slice());
});

test("`read_only` and `dopl_only` are untouched by the fourth profile", () => {
  for (const p of ["read_only", "dopl_only"]) {
    const denied = PROFILES.buildDeniedTools(p);
    for (const name of PROFILES.DENIED_BUILTINS) {
      assert.ok(denied.includes(name), `${p} still hard-denies ${name}`);
    }
    for (const name of SHELL) assert.ok(denied.includes(name), `${p} still hard-denies ${name}`);
  }
  assert.deepEqual(PROFILES.buildBuiltinTools("read_only"), PROFILES.READ_BUILTINS.slice());
  assert.deepEqual(PROFILES.buildBuiltinTools("dopl_only"),
    PROFILES.READ_BUILTINS.concat(PROFILES.WEB_TOOLS));
});

test("the shell group is spelled ONCE and every reader derives from it", () => {
  // ⚠ THE ANTI-DUPLICATION PIN. `DENIED_BUILTINS`, `CHANNEL_AGENT_HARD_DENY` and the Claude
  // adapter's `ESCALATION_TOOLS` all compose `SHELL_BUILTINS`; a fourth shell verb must be one
  // edit. The probe is on the SOURCE because a second literal would still produce equal arrays.
  assert.deepEqual(PROFILES.SHELL_BUILTINS, SHELL);
  assert.deepEqual(PROFILES.CHANNEL_AGENT_HARD_DENY,
    PROFILES.UNIVERSAL_HARD_DENY.concat(SHELL));
  assert.deepEqual(CLAUDE.ESCALATION_TOOLS, SHELL.concat(PROFILES.WEB_TOOLS));
  const claudeSrc = readMain("runtime", "claude", "tools.js");
  assert.equal(/'BashOutput'/.test(claudeSrc), false,
    "the adapter must not restate a shell name — it composes SHELL_BUILTINS");
});

// ── 4. THE VOCABULARY ────────────────────────────────────────────────────────────────────────

test("KNOWN_PROFILES is the four, and an unknown value still fails closed", () => {
  assert.deepEqual(PROFILES.KNOWN_PROFILES,
    ["read_only", "dopl_only", "channel_agent", "full"]);
  assert.equal(PROFILES.normalizeProfile("channel_agent"), "channel_agent");
  for (const bogus of [undefined, null, "", "channel-agent", "CHANNEL_AGENT", 7, {}]) {
    assert.equal(PROFILES.normalizeProfile(bogus), "read_only", String(bogus));
  }
});

test("the DURABLE record's profile set is held EQUAL to the table's", () => {
  // ⚠ `session-park.js` carries a second copy (its PURE block may not `require`), and a profile
  // missing there does not fail loudly — it silently RECREATES every parked session carrying it
  // at `read_only`. Source-probed, because that copy is a literal inside an extracted block.
  const src = readMain("session-park.js");
  const m = /const KNOWN_PROFILES = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(m, "session-park.js must declare KNOWN_PROFILES as a Set over a literal array");
  const parked = m[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
  assert.deepEqual(parked.slice().sort(), PROFILES.KNOWN_PROFILES.slice().sort());
});

test("the label and the hint exist for it — a consent card must never fall back to full's", () => {
  // `profileLabel` / `profileHint` fall back to `read_only`'s copy for an unknown name, so a
  // missing entry here reads as a card that lies in the OTHER direction.
  assert.equal(PROFILES.profileLabel("channel_agent"), "Shared-channel");
  assert.notEqual(PROFILES.profileHint("channel_agent"), PROFILES.profileHint("read_only"));
  assert.notEqual(PROFILES.profileHint("channel_agent"), PROFILES.profileHint("full"));
});

test("the wire value is exactly `channel_agent`, and the server's shape check accepts it", () => {
  // ⚠ THE SIBLING SLICE (`v2/b-profile-header`) TREATS AN UNKNOWN VALUE AS THE NARROWEST, so the
  // spelling is the contract. The regex is compiled from the server's own source, not copied.
  const headerSrc = readFileSync(
    join(HERE, "..", "..", "src", "shared", "auth", "tool-profile-header.ts"), "utf8");
  const m = /const TOOL_PROFILE_RE = (\/.*\/);/.exec(headerSrc);
  assert.ok(m, "tool-profile-header.ts must define TOOL_PROFILE_RE");
  const re = new Function(`return ${m[1]};`)();
  assert.match("channel_agent", re);
  assert.equal(PROFILES.normalizeProfile("channel_agent"), "channel_agent",
    "…and the stamp sends what normalizeProfile answered, so this IS the stamped value");
});

// ── 5. THE CODEX LANE — the same profile, in Codex's own words ───────────────────────────────

test("CODEX: `channel_agent` denies the shell AND the escape that reaches it, by name", () => {
  const cfg = CODEX.buildSessionToolConfig("channel_agent");
  assert.ok(cfg.disallowedTools.includes(CODEX.COMMAND_ITEM), "commandExecution — the shell");
  assert.ok(cfg.disallowedTools.includes("sandbox_approval"),
    "…and the sandbox escape, or the fence has a gate beside it");
});

test("CODEX: the delta from `full` is EXACTLY that pair, and `native` stays full's null", () => {
  const full = CODEX.buildSessionToolConfig("full");
  const ca = CODEX.buildSessionToolConfig("channel_agent");
  assert.deepEqual(minus(ca.disallowedTools, full.disallowedTools),
    CODEX.ESCALATION_ITEMS.slice().sort());
  assert.deepEqual(minus(full.disallowedTools, ca.disallowedTools), []);
  assert.equal(ca.native, null, "the ruling removes the shell, not the operator's Axis-A pick");
  assert.equal(ca.doplToolsPolicy, null);
  assert.deepEqual(ca.preApproved, [], "nothing is pre-approved on this runtime, on any profile");
});

test("CODEX: `fileChange` is NOT denied — this is `full` minus the shell, not a sandbox", () => {
  // The negative that keeps the profile honest: it is not "read_only with extras".
  const ca = CODEX.buildSessionToolConfig("channel_agent");
  assert.equal(ca.disallowedTools.includes(CODEX.FILE_ITEM), false);
});

// ── 6. BOTH SHIPPING DESCRIPTORS DECLARE IT; CURSOR IS FROZEN (X0) ───────────────────────────

test("the two SHIPPING runtimes declare the profile, and it is launchable on both", () => {
  // ⚠ `contract.js › mirrorProblems` already held the declaration equal to what `toolConfigFor`
  // ENFORCES at seal time — the registry loaded, so that passed. What this adds is that the entry
  // EXISTS: a profile the descriptor does not name is one `canLaunchProfile` refuses.
  for (const id of ["claude", "codex"]) {
    const d = REGISTRY.descriptorFor(id);
    assert.ok(d.containment.profiles.channel_agent, `${id} declares channel_agent`);
    assert.equal(capability.canLaunchProfile(d, "channel_agent"), true, id);
    assert.equal(capability.profileRefusal(d, "channel_agent"), null, id);
  }
});

test("CURSOR is FROZEN at three profiles, and X0 is why", () => {
  const d = REGISTRY.descriptorFor("cursor");
  assert.equal(d.session.interrupt, "unverified",
    "X0: Dopl cannot own a session it cannot stop — this is the hold");
  assert.deepEqual(Object.keys(d.containment.profiles).sort(),
    ["dopl_only", "full", "read_only"], "no fourth profile on a runtime that does not ship");
});

test("CURSOR refuses a channel_agent launch through the EXISTING contract rule", () => {
  // ⚠ `contract.js › LAUNCH_BLOCKING[1]` — a profile with no deny list in this runtime's
  // vocabulary has no enforcement, so it is refused at launch WITH A SENTENCE. No new branch was
  // added to the frozen adapter; the rule that was already there does the work.
  const d = REGISTRY.descriptorFor("cursor");
  assert.equal(capability.canLaunchProfile(d, "channel_agent"), false);
  assert.match(String(capability.profileRefusal(d, "channel_agent")), /channel_agent/);
  assert.match(String(capability.profileRefusal(d, "channel_agent")), /no deny list/);
});

test("CURSOR's table has NO channel_agent branch — the freeze is in the source too", () => {
  // Without this the freeze could rot into a silent fall-through: `normalizeProfile` accepts the
  // name, and an adapter with no branch for it would hand back `full`'s config under a narrower
  // label. Pinned so the day X0 clears, the branch and this line move together.
  const src = readMain("runtime", "cursor", "tools.js");
  const table = src.slice(src.indexOf("function buildSessionToolConfig"));
  assert.equal(/p === 'channel_agent'/.test(table), false);
  assert.match(src, /ruling X0/, "and the freeze names the ruling that holds it");
  // The fall-through it therefore has, said out loud rather than discovered later.
  assert.deepEqual(CURSOR.buildSessionToolConfig("channel_agent"),
    CURSOR.buildSessionToolConfig("full"),
    "an un-declared profile falls through to full HERE — which is why the launch is refused above");
});

// ── 7. THE SELECTION RULE — shared ROOMS get it by default ───────────────────────────────────

test("SELECTION: a SHARED room narrows `full` to `channel_agent`", () => {
  assert.equal(PROFILES.profileForChannel("full", true), "channel_agent");
});

test("SELECTION: the operator's explicit `full` still means `full` on their OWN channel", () => {
  // A solo room is the operator's own primary agent surface — no second audience to bound.
  assert.equal(PROFILES.profileForChannel("full", false), "full");
});

test("SELECTION: it NARROWS and can never widen", () => {
  for (const shared of [true, false]) {
    for (const p of ["read_only", "dopl_only", "channel_agent"]) {
      assert.equal(PROFILES.profileForChannel(p, shared), p,
        `${p} must survive shared=${shared} untouched`);
    }
  }
  // …and an unresolvable value still fails closed, in both worlds.
  for (const shared of [true, false]) {
    assert.equal(PROFILES.profileForChannel("nonsense", shared), "read_only");
  }
});

test("SELECTION: only a literal `true` counts as shared — no truthy coercion", () => {
  for (const notShared of [undefined, null, 0, "", "yes", 1, {}]) {
    assert.equal(PROFILES.profileForChannel("full", notShared), "full", String(notShared));
  }
});

// ── 8. THE SHARED/SOLO FACT — the ROOM's member count (F-513 ruling) ─────────────────────────
//
// ⚠ THE FACT MOVED, THE RULE DID NOT (2026-09-02, Samuel's ruling on F-513). This slice first
// read `session-park-on-claim.js › isSharedContainer` — `kind === 'link' && memberCount !== 1` —
// which called a nine-member `standard` workspace SOLO, so the busiest rooms in the product were
// the ones that kept a shell under a ruling whose stated reason is "a session launched into a
// SHARED channel". A room is shared when more than one person is in it, whatever container it
// sits in. The container predicate keeps its own meaning for its own two readers (the credential
// lock and the park-on-claim stop, both about the CLAIM lane) and no longer has a third.

test("SHARED: a room with more than one member is shared, in ANY container kind", () => {
  assert.equal(WIN.isSharedChannel({ memberCount: 2 }), true);
  assert.equal(WIN.isSharedChannel({ memberCount: 9 }), true);
  // ⚠ THE CASE THE RULING TURNED OVER: a `standard` workspace channel. There is no container
  // field on this input at all, which is the point — the kind cannot be consulted by accident.
  assert.equal(WIN.isSharedChannel({ memberCount: 9, kind: "standard" }), true);
});

test("SHARED: exactly one member is solo — the operator's own room", () => {
  assert.equal(WIN.isSharedChannel({ memberCount: 1 }), false);
  assert.equal(WIN.isSharedChannel({ memberCount: 1, kind: "link" }), false);
});

test("SHARED: unknown fails CLOSED — an absent or unusable count is not solo", () => {
  // Same inverted stale-field direction the rest of this machine takes: the only thing this
  // answer can do is REMOVE the shell, so "solo" is the expensive guess.
  for (const bad of [undefined, null, {}, { memberCount: null }, { memberCount: "2" },
                     { memberCount: 0 }]) {
    assert.equal(WIN.isSharedChannel(bad), true, JSON.stringify(bad));
  }
});

// ── 9. THE LANE, DRIVEN ──────────────────────────────────────────────────────────────────────

/** The profile the directive lane really hands the engine for this channel. */
async function launchedProfile({ toolProfile, memberCount = 1 }) {
  const h = boot({ watched: { id: CH, name: "General", toolProfile, memberCount } });
  await h.api.handle(row(), WS);
  assert.ok(h.cfg.lastSpec, "the launch must actually happen — otherwise nothing was resolved");
  return h.cfg.lastSpec.toolProfile;
}

test("LANE: a directive into a SHARED room launches at `channel_agent`", async () => {
  assert.equal(await launchedProfile({ toolProfile: "full", memberCount: 3 }), "channel_agent");
});

test("LANE: the same directive into a SOLO room still launches at `full`", async () => {
  assert.equal(await launchedProfile({ toolProfile: "full", memberCount: 1 }), "full");
});

test("LANE: a channel already set NARROWER keeps its own profile in a shared room",
  async () => {
    assert.equal(await launchedProfile({ toolProfile: "dopl_only", memberCount: 3 }), "dopl_only");
    assert.equal(await launchedProfile({ toolProfile: "read_only", memberCount: 3 }), "read_only");
  });

test("LANE: the narrowing is the TABLE's rule, not a second literal in the spawn", () => {
  // The C-11 shape: one definition of what a profile resolves to. A ternary beside the resolver
  // is how the two lanes came to answer differently for one channel (F-267).
  const src = readMain("launch-directive-spawn.js");
  const body = src.slice(src.indexOf("async function spawn("));
  assert.match(body, /toolProfile: targeting\.resolveLaunchToolProfile\(channel\),/);
  assert.equal(/'channel_agent'/.test(body), false,
    "the spawn must not spell a profile name — the vocabulary is tool-profiles.js's");
  // ⚠ AND IT MUST NOT SPELL THE FACT EITHER (F-510). The rule and its input were two arguments
  // written out at this call site, and the other two launch lanes wrote out neither.
  assert.equal(/isShared|memberCount/.test(body), false,
    "the spawn must not re-derive shared/solo — targeting-window.js owns both halves");
});

test("LANE: the DIRECTIVE still supplies no containment input, profile included", async () => {
  // The safety argument this lane's docblock makes, re-asserted over the new field: a row that
  // asks for `full` in a shared room gets `channel_agent` like every other row.
  const h = boot({ watched: { id: CH, name: "General", toolProfile: "full", memberCount: 3 } });
  await h.api.handle(row({ tool_profile: "full", profile: "full" }), WS);
  assert.equal(h.cfg.lastSpec.toolProfile, "channel_agent");
});
