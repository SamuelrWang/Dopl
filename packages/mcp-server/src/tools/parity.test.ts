/**
 * INVARIANT SUITE — MCP tool parity. Guards the "drift between parallel
 * declarations" bug class:
 *   1. a param validated server-side but MISSING from the published zod
 *      inputSchema, so agents cannot pass it → "handler reads only declared
 *      params" below;
 *   2. `WRITE_OPS` drifting from a tool's op enum after an op rename, a latent
 *      read-only-token write hole → WRITE_OPS ⊆ enum + completeness below.
 *   3. the SAME drift on the other list. `READ_OPS` had the ⊆ half missing until
 *      2026-09-02 and carried `dopl_channel.get_thread` for a day after C15
 *      deleted that op — an allowlist entry for an op nobody serves fails
 *      nothing (completeness walks the ENUM), so it reads as a classification
 *      somebody made. Both lists are checked both ways now.
 *
 * ⚠ Mechanism in `parity-harness.ts`: tools are captured through their real
 * registrars, and `WRITE_OPS` is PARSED out of source text so the tests check
 * the REAL table, not a copy that can drift. `delete-block.test.ts` reads the
 * same harness for HIDDEN_TOOLS and the app-only-deletion suites.
 */

import { describe, it, expect } from "vitest";
// ⚠ ONE definition of the "which files make up one tool" scan, shared with
// `channel-deadlines.test.ts` — a hardcoded file list is silently truncated by
// the next module split.
import { toolGroupSource } from "./tool-group-files.js";
import {
  DELETE_BLOCKED_OPS,
  HIDDEN_TOOLS,
  TOOLS,
  TOOL_BY_NAME,
  WRITE_OPS,
  ACTIONS_BY_OP,
  actionEnum,
  classifies,
  gateKeys,
  isAdmin,
  opEnum,
  servesKey,
} from "./parity-harness.js";

// ── Sanity: capture worked ───────────────────────────────────────────

describe("tool capture", () => {
  it("registers the expected domain tools", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        // MCP surface v2 wave A (2026-08-28): the template family joins.
        // ⚠ THE FIVE `_admin` COMPANIONS LEFT ON 2026-09-02 — deleted, not
        // hidden: registrars, op handlers and descriptions are gone. The rule
        // they advertised is `sessionOnly` on the REST routes now.
        "dopl_agent",
        "dopl_channel",
        "dopl_chats",
        "dopl_kb",
        "dopl_map",
        "dopl_members",
        "dopl_ontology",
        "dopl_search",
        "dopl_skill",
      ].sort(),
    );
  });

  it("parsed a non-empty WRITE_OPS table", () => {
    expect(Object.keys(WRITE_OPS).length).toBeGreaterThan(0);
  });

  it("parsed the HIDDEN_TOOLS + DELETE_BLOCKED_OPS tables", () => {
    // ⚠ A parse silently returning {} makes every assertion below a vacuous
    // pass. DELETE_BLOCKED_OPS is checked by SIZE; HIDDEN_TOOLS cannot be
    // (legitimately empty), so the parse IS the assertion — `parseToolSet`
    // THROWS when the constant is missing or renamed.
    expect(HIDDEN_TOOLS).toBeInstanceOf(Set);
    expect(Object.keys(DELETE_BLOCKED_OPS).length).toBeGreaterThan(0);
  });
});


// ── 1a. WRITE_OPS ⊆ op enum (kills the stale-op class) ───────────────

// ⚠ CURATED READ-OPS ALLOWLIST — THE SECURITY REVIEW. Per tool, the ops that
// ONLY read (no client write call in the handler), derived by reading every op
// handler. Every enum op must be classified as WRITE (gating.ts WRITE_OPS) or
// read (here); an op in neither fails the completeness test, and that failure
// IS the security review for the new op. Human-audit against the sources.
const READ_OPS: Record<string, string[]> = {
  dopl_kb: ["list_bases", "get_tree", "list_dir", "read_file", "search"],
  dopl_skill: ["list", "get", "read", "authoring_guide"],
  dopl_chats: ["list", "get", "folders", "guide"],
  dopl_members: ["whoami", "list", "get", "teams", "get_team", "access_matrix", "my_access"],
  dopl_ontology: ["map", "anchor", "resolve", "get"],
  // `opList` calls only `listAgentTemplates`; `opGet` resolves a ref through
  // the same list and then `getAgentTemplate`. Neither writes.
  dopl_agent: ["list", "get"],
  // `members` is a roster READ: `opMembers` calls only `listChannelMembers` and
  // renders it. Membership changes via op="invite" (gated as a write) and the
  // web UI. ⚠ "who may call it" and "does it write" are different questions —
  // answering the second with the first is how a write op becomes callable
  // from a read-only token.
  // ⚠ **KEYED BY `op.action` WHERE THE OP TAKES ONE** (2026-09-02, slice B8).
  // Twenty-three ops became five, and the five are not five classifications:
  // `rooms` is four reads and four writes, so this list names the four reads and
  // `gating.ts › WRITE_OPS` names the four writes.
  dopl_channel: [
    // `opRead` / `opReadAccount` / `opHold` call only read endpoints. ⚠ The HOLD
    // is the same op with `wait_ms` and is the same classification: a long-poll
    // is a read that waits, and it was refused to a read-only token by nothing
    // when it was its own op either.
    "read",
    // `opStatus` composes `listChannelSessions` (own-scoped) and
    // `listAgentDirections` (own-scoped at the server, `operator_user_id =
    // ctx.userId` in the SQL predicate). ⚠ THE TWO DESKTOP WRITES ON THE
    // DIRECTIONS LANE — claim and decide — ARE NOT MCP OPS AND MUST NEVER BECOME
    // ONE. They are how a MACHINE reports what it did with a direction; an
    // external agent does not get to say a direction was delivered, still less to
    // write the `reply` an operator will read as its own agent's words. They are
    // unbound on `@dopl/client` for the same reason.
    "status",
    // `opList` calls only `listChannels`.
    "rooms.list",
    // `opMembers` calls only `listChannelMembers` and renders it. Membership
    // changes via `rooms.invite` (gated as a write) and the web UI. ⚠ "who may
    // call it" and "does it write" are different questions — answering the second
    // with the first is how a write op becomes callable from a read-only token.
    "rooms.members",
    // `opListThreads` calls only `listChannelThreads`.
    "rooms.threads",
    // `rooms.help` RETURNS A CONSTANT AND MAKES NO REQUEST AT ALL — the same text
    // as the `dopl://doctrine/channels` MCP resource. It reads nothing, so it is
    // not merely "not a write": there is no client call in the handler to audit.
    "rooms.help",
    // ⚠ EIGHT NAMES STOOD HERE AND ARE GONE (2026-09-02, B8): `help`, `list`,
    // `await`, `members`, `list_threads`, `read_sessions`, `pings` and
    // `read_directions`, each folded into one of the five. A stale READ_OPS entry
    // is DEAD LAW THAT READS AS COVERAGE — the completeness walk only visits keys
    // the tool really serves, so an allowlist entry for an op nobody serves fails
    // nothing, and the next reader takes it for a classified op. The ⊆ assertion
    // below is what turns that into a failure.
  ],
};

// KNOWN DRIFT ledger — write ops absent from WRITE_OPS (read-only-token write
// holes) get listed here until fixed. Empty; the tripwire below keeps it empty.
const KNOWN_WRITE_OPS_DRIFT: Record<string, string[]> = {};

/**
 * Every captured tool that dispatches on an `op`. ⚠ It was `OP_TOOLS`
 * until 2026-09-02, when the last `*_admin` tool was deleted: with no wholesale
 * blocked tools left, EVERY op-carrying tool owes the write/read classification
 * below, and an exclusion here would be a hole rather than a scoping.
 */
const OP_TOOLS = TOOLS.filter((t) => opEnum(t) !== null);

describe("the `action` sub-verb is declared once and published whole", () => {
  it("the published enum is exactly the union of the per-op vocabularies", () => {
    // ⚠ THE PAIR THE DOTTED GATE KEYS REST ON. `action` is one FLAT enum a
    // client introspects, while the gate reasons per (op, action) — so a verb in
    // the map but not the enum is unreachable, and one in the enum but not the
    // map is unclassifiable. Either way a call arrives that no list describes.
    for (const [name, actions] of Object.entries(ACTIONS_BY_OP)) {
      const tool = TOOL_BY_NAME.get(name);
      expect(tool, `${name} declares actions but is not registered`).toBeDefined();
      const published = actionEnum(tool!);
      expect(published, `${name} declares actions but publishes no enum`).not.toBeNull();
      expect([...(published ?? [])].sort()).toEqual(
        Object.values(actions).flat().sort(),
      );
    }
  });

  it("the per-op vocabularies are DISJOINT, so one word never means two things", () => {
    // ⚠ Disjointness is what makes `rooms.open` unambiguous AND what lets the
    // registrar refuse `manage(action="open")` by naming the op that does take
    // the word. Overlapping verbs would make the refusal a guess.
    for (const [name, actions] of Object.entries(ACTIONS_BY_OP)) {
      const all = Object.values(actions).flat();
      expect(new Set(all).size, `${name} reuses an action name across ops`).toBe(
        all.length,
      );
    }
  });
});

describe("WRITE_OPS ⊆ op enum", () => {
  it("every WRITE_OPS entry names a registered tool", () => {
    for (const name of Object.keys(WRITE_OPS)) {
      expect(TOOL_BY_NAME.has(name), `WRITE_OPS references unknown tool ${name}`).toBe(true);
    }
  });

  it("every op listed in WRITE_OPS exists in that tool's op enum", () => {
    for (const [name, ops] of Object.entries(WRITE_OPS)) {
      const tool = TOOL_BY_NAME.get(name);
      const enumOps = tool ? opEnum(tool) : null;
      expect(enumOps, `${name} has no op enum but WRITE_OPS gates it`).not.toBeNull();
      for (const op of ops) {
        expect(
          servesKey(name, enumOps ?? [], op),
          `WRITE_OPS.${name} lists "${op}", which this tool does not serve — an op that left the enum, or an action that left its vocabulary (stale entry — the WRITE_OPS.dopl_skill drift bug)`,
        ).toBe(true);
      }
    }
  });
});

// ── 1a′. READ_OPS ⊆ op enum (the same class, the other list) ─────────

describe("READ_OPS ⊆ op enum", () => {
  it("every READ_OPS entry names a registered tool", () => {
    for (const name of Object.keys(READ_OPS)) {
      expect(TOOL_BY_NAME.has(name), `READ_OPS references unknown tool ${name}`).toBe(true);
    }
  });

  it("every op listed in READ_OPS exists in that tool's op enum", () => {
    // ⚠ THE MIRROR OF THE ASSERTION ABOVE, AND IT WAS MISSING. `READ_OPS` is a
    // SECURITY REVIEW — "these ops were read and they only read" — so an entry
    // that names nothing is a review of an op that does not exist, sitting in the
    // list a human audits. It also silently pre-classifies the name: an op
    // RE-ADDED under an old spelling would be waved through as already-read.
    for (const [name, ops] of Object.entries(READ_OPS)) {
      const tool = TOOL_BY_NAME.get(name);
      const enumOps = tool ? opEnum(tool) : null;
      expect(enumOps, `${name} has no op enum but READ_OPS classifies it`).not.toBeNull();
      for (const op of ops) {
        expect(
          servesKey(name, enumOps ?? [], op),
          `READ_OPS.${name} lists "${op}", which this tool does not serve — delete the entry rather than leaving a review of a call nobody can make`,
        ).toBe(true);
      }
    }
  });
});

// ── 1b. Write-op completeness (every op is classified) ───────────────

describe("write-op completeness", () => {
  it("every op is classified as write (WRITE_OPS) or read (allowlist)", () => {
    for (const tool of OP_TOOLS) {
      const enumOps = opEnum(tool)!;
      const write = WRITE_OPS[tool.name] ?? new Set<string>();
      const read = new Set(READ_OPS[tool.name] ?? []);
      const knownDrift = new Set(KNOWN_WRITE_OPS_DRIFT[tool.name] ?? []);
      // ⚠ THE WALK IS OVER GATE KEYS, NOT OVER OPS. On a tool whose op takes an
      // `action`, the unit that gets refused is the PAIR — so the pair is the
      // unit that owes a classification, and walking ops alone would let four
      // room writes ride in on one classified op.
      for (const key of gateKeys(tool, enumOps)) {
        const classified =
          classifies(write, key) ||
          classifies(read, key) ||
          classifies(knownDrift, key);
        expect(
          classified,
          `UNCLASSIFIED "${key}" on ${tool.name}. If it writes, add it to WRITE_OPS in packages/mcp-server/src/gating.ts. If it only reads, add it to READ_OPS in this test after confirming it in the source.`,
        ).toBe(true);
      }
    }
  });

  it("the discovered WRITE_OPS drift is EXACTLY the known set (tripwire for any change)", () => {
    // Enum ops neither gated by WRITE_OPS nor marked read. Grows when a new
    // write op is added un-gated, shrinks when the table is fixed — either way
    // this fails and forces constant and source back in sync.
    const computed: Record<string, string[]> = {};
    for (const tool of OP_TOOLS) {
      const enumOps = opEnum(tool)!;
      const write = WRITE_OPS[tool.name] ?? new Set<string>();
      const read = new Set(READ_OPS[tool.name] ?? []);
      const drift = gateKeys(tool, enumOps).filter(
        (key) => !classifies(write, key) && !classifies(read, key),
      );
      if (drift.length > 0) computed[tool.name] = drift.sort();
    }
    const expected: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(KNOWN_WRITE_OPS_DRIFT)) {
      expected[k] = [...v].sort();
    }
    expect(computed).toEqual(expected);
  });

  it("SECURITY: the removed agent-state ops are gone from BOTH gate lists", () => {
    // ⚠ A stale WRITE_OPS entry for a non-existent op is dead law that reads as
    // coverage. ⚠ BOTH assertions must read PRODUCTION source: `WRITE_OPS` is
    // parsed out of gating.ts, and the second check goes against the tool's OWN
    // op enum — asserting against `READ_OPS` (a literal in this file) cannot
    // fail and cannot notice an op coming back.
    const write = WRITE_OPS.dopl_channel ?? new Set<string>();
    const channelEnum = opEnum(
      TOOLS.find((t) => t.name === "dopl_channel")!,
    )!;
    // ⚠ SIX, NOT SEVEN, SINCE 2026-09-01. `rename_agent` IS BACK IN THE ENUM and
    // IS gated as a write — a DIFFERENT verb (a local display label, never an
    // address; see `channel-law.test.ts › REMOVED_VOCABULARY`). It therefore
    // cannot be asserted absent here, and the case below — every enum op is
    // classified write-or-read — is what covers it, which is the check that
    // actually closes the read-only-token hole this block is about.
    // ⚠ **THE TWENTY-TWO RETIRED NAMES JOIN THE SIX (2026-09-02, B8), AND FOR
    // THE SAME REASON RATHER THAN A NEW ONE.** They parsed for one release so
    // their one-line redirects could run; slice B16 deleted the redirects, so
    // they now parse nowhere. Either way a retired name reappearing in the enum
    // would be the collapse silently coming undone, and one in `WRITE_OPS` would
    // be a gate on a call no handler can reach.
    for (const op of [
      "agents",
      "summon_agent",
      "set_agent_status",
      "disengage_agent",
      "join_thread",
      "leave_thread",
      "post",
      "milestone",
      "escalate",
      "ping",
      "pings",
      "create_thread",
      "list",
      "open",
      "invite",
      "members",
      "list_threads",
      "set_thread_mode",
      "update",
      "launch_agent",
      "end_agent",
      "rename_agent",
      "set_agent_mode",
      "direct_agent",
      "read_directions",
      "read_sessions",
      "await",
      "help",
    ]) {
      expect(write.has(op), `dopl_channel op="${op}" is still gated as a write`).toBe(
        false,
      );
      expect(
        channelEnum.includes(op),
        `dopl_channel op="${op}" is back in the tool's op enum — it was dropped outright in the channels rollback §1`,
      ).toBe(false);
    }
  });

  it("SECURITY: no read-only-token write holes — every op is gated as write or read", () => {
    for (const tool of OP_TOOLS) {
      const enumOps = opEnum(tool)!;
      const write = WRITE_OPS[tool.name] ?? new Set<string>();
      const read = new Set(READ_OPS[tool.name] ?? []);
      const ungated = gateKeys(tool, enumOps).filter(
        (key) => !classifies(write, key) && !classifies(read, key),
      );
      expect(ungated, `${tool.name} has un-gated write ops: ${ungated.join(", ")}`).toEqual([]);
    }
  });
});

// ── 1c. Schema / description parity ──────────────────────────────────

// KNOWN DRIFT ledger: enum ops missing from the tool description. Empty set
// enforced by the test below.
const KNOWN_DESCRIPTION_DRIFT: Record<string, string[]> = {};

describe("schema / description parity", () => {
  it("undocumented-op drift is EXACTLY the known set (tripwire for any change)", () => {
    const computed: Record<string, string[]> = {};
    for (const tool of TOOLS) {
      const enumOps = opEnum(tool);
      if (!enumOps) continue;
      const missing = enumOps.filter((op) => !tool.description.includes(`"${op}"`));
      if (missing.length > 0) computed[tool.name] = missing.sort();
    }
    const expected: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(KNOWN_DESCRIPTION_DRIFT)) {
      expected[k] = [...v].sort();
    }
    expect(computed).toEqual(expected);
  });

  it("every op in the enum is documented in the tool description", () => {
    for (const tool of TOOLS) {
      const enumOps = opEnum(tool);
      if (!enumOps) continue;
      for (const op of enumOps) {
        expect(
          tool.description.includes(`"${op}"`),
          `${tool.name} op="${op}" is in the enum but not mentioned in the description string`,
        ).toBe(true);
      }
    }
  });

  it("every declared schema param is referenced in the tool's source", () => {
    for (const tool of TOOLS) {
      // ⚠ Scan the registrar AND its split-out modules — a param consumed only
      // in a sibling handler still counts as used.
      const src = toolGroupSource(tool.sourceFile);
      for (const key of Object.keys(tool.schema)) {
        if (key === "op") continue;
        const referenced = new RegExp(`\\b${key}\\b`).test(src);
        expect(
          referenced,
          `${tool.name} declares schema param "${key}" that is never referenced in ${tool.sourceFile} or its split-out modules (described-but-dead param)`,
        ).toBe(true);
      }
    }
  });

  it("every param the handler reads (args.X) is a declared schema param", () => {
    // ⚠ No handler may read an arg the schema does not publish. `keysByFile` is
    // keyed by the REGISTRAR file; the union of its tools' schema keys is the
    // allowed set for the whole group, including split-out modules scanned via
    // `toolGroupSource`.
    const keysByFile = new Map<string, Set<string>>();
    for (const tool of TOOLS) {
      const set = keysByFile.get(tool.sourceFile) ?? new Set<string>();
      for (const key of Object.keys(tool.schema)) set.add(key);
      set.add("op");
      keysByFile.set(tool.sourceFile, set);
    }
    for (const [file, allowed] of keysByFile) {
      const src = toolGroupSource(file);
      const accessed = [...src.matchAll(/\bargs\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map(
        (m) => m[1],
      );
      for (const id of accessed) {
        expect(
          allowed.has(id),
          `${file} (or a split-out sibling module) reads args.${id} but no tool in that group declares "${id}" as a schema param (get_tree entry_limit bug class)`,
        ).toBe(true);
      }
    }
  });
});

// ── 1d. There is no admin surface, and it must not grow back ─────────

describe("no `*_admin` tool exists", () => {
  it("no registrar registers one", () => {
    // ⚠ THE REGROWTH GUARD, and it replaces the three "every admin tool is
    // wholesale-blocked" cases those tools needed (2026-09-02). An `_admin`
    // tool was destructive by construction and every op on all five was refused
    // unconditionally — 9,295 served chars to publish a refusal. A new one is
    // therefore not a gap in a gate, it is a tool that should not be written:
    // deletion is app-only and fenced at the REST route.
    const admins = TOOLS.map((t) => t.name).filter(isAdmin);
    expect(
      admins,
      "an `*_admin` tool is registered again. Deletion is app-only and enforced by `sessionOnly` on the REST route; a tool that exists only to refuse does not need to exist",
    ).toEqual([]);
  });

  it("WRITE_OPS gates no admin tool", () => {
    expect(Object.keys(WRITE_OPS).filter(isAdmin)).toEqual([]);
  });
});
