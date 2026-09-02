/**
 * INVARIANT SUITE — MCP tool parity. Guards the "drift between parallel
 * declarations" bug class:
 *   1. a param validated server-side but MISSING from the published zod
 *      inputSchema, so agents cannot pass it → "handler reads only declared
 *      params" below;
 *   2. `WRITE_OPS` drifting from a tool's op enum after an op rename, a latent
 *      read-only-token write hole → WRITE_OPS ⊆ enum + completeness below.
 *
 * ⚠ Mechanism in `parity-harness.ts`: tools are captured through their real
 * registrars, and `WRITE_OPS` / `READ_ONLY_BLOCKED_TOOLS` are PARSED out of
 * source text so the tests check the REAL tables, not a copy that can drift.
 * `delete-block.test.ts` reads the same harness for HIDDEN_TOOLS and the
 * app-only-deletion suites.
 */

import { describe, it, expect } from "vitest";
// ⚠ ONE definition of the "which files make up one tool" scan, shared with
// `channel-deadlines.test.ts` — a hardcoded file list is silently truncated by
// the next module split.
import { toolGroupSource } from "./tool-group-files.js";
import {
  DELETE_BLOCKED_OPS,
  HIDDEN_TOOLS,
  READ_ONLY_BLOCKED_TOOLS,
  TOOLS,
  TOOL_BY_NAME,
  WRITE_OPS,
  isAdmin,
  opEnum,
} from "./parity-harness.js";

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
  // `opListChannels` calls only `getHomeChannels` (through the lock narrower).
  // ⚠ `create_channel` is NOT here — it is in `WRITE_OPS`.
  dopl_home: ["list_channels"],
  // `members` is a roster READ: `opMembers` calls only `listChannelMembers` and
  // renders it. Membership changes via op="invite" (gated as a write) and the
  // web UI. ⚠ "who may call it" and "does it write" are different questions —
  // answering the second with the first is how a write op becomes callable
  // from a read-only token.
  dopl_channel: [
    "list",
    "read",
    "await",
    "members",
    "list_threads",
    "get_thread",
    // `opReadSessions` calls only `listChannelSessions` — own-scoped, no write.
    // ⚠ The desktop WRITE that feeds it posts straight to the route from the
    // main process and must NOT become an MCP op: an external agent does not
    // get to say what a session on somebody's machine is doing.
    "read_sessions",
    // `opReadDirections` calls only `listAgentDirections` — own-scoped at the
    // server (`operator_user_id = ctx.userId` in the SQL predicate), no write.
    // ⚠ THE TWO DESKTOP WRITES ON THAT LANE — claim and decide — ARE NOT MCP OPS
    // AND MUST NEVER BECOME ONE. They are how a MACHINE reports what it did with
    // a direction; an external agent does not get to say that a direction was
    // delivered, still less to write the `reply` an operator will read as its own
    // agent's words. They are unbound on `@dopl/client` for the same reason.
    "read_directions",
  ],
};

// KNOWN DRIFT ledger — write ops absent from WRITE_OPS (read-only-token write
// holes) get listed here until fixed. Empty; the tripwire below keeps it empty.
const KNOWN_WRITE_OPS_DRIFT: Record<string, string[]> = {};

const NON_ADMIN_OP_TOOLS = TOOLS.filter(
  (t) => !isAdmin(t.name) && opEnum(t) !== null,
);

// ── Sanity: capture worked ───────────────────────────────────────────

describe("tool capture", () => {
  it("registers the expected domain tools", () => {
    const names = TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        // MCP surface v2 wave A (2026-08-28): the template family joins.
        "dopl_agent",
        "dopl_agent_admin",
        // Wave B: `dopl_home` registers on the META path and is captured anyway —
        // it has an op enum, a WRITE op and a charge (see `parity-harness.ts`).
        "dopl_home",
        "dopl_channel",
        "dopl_chats",
        "dopl_chats_admin",
        "dopl_kb",
        "dopl_kb_admin",
        "dopl_map",
        "dopl_members",
        "dopl_ontology",
        "dopl_ontology_admin",
        "dopl_search",
        "dopl_skill",
        "dopl_skill_admin",
      ].sort(),
    );
  });

  it("parsed non-empty WRITE_OPS + READ_ONLY_BLOCKED_TOOLS tables", () => {
    expect(Object.keys(WRITE_OPS).length).toBeGreaterThan(0);
    expect(READ_ONLY_BLOCKED_TOOLS.size).toBeGreaterThan(0);
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
          enumOps,
          `WRITE_OPS.${name} lists op="${op}" which is NOT in the tool's op enum (stale op — the WRITE_OPS.dopl_skill drift bug)`,
        ).toContain(op);
      }
    }
  });
});

// ── 1b. Write-op completeness (every op is classified) ───────────────

describe("write-op completeness", () => {
  it("every op is classified as write (WRITE_OPS) or read (allowlist)", () => {
    for (const tool of NON_ADMIN_OP_TOOLS) {
      const enumOps = opEnum(tool)!;
      const write = WRITE_OPS[tool.name] ?? new Set<string>();
      const read = new Set(READ_OPS[tool.name] ?? []);
      const knownDrift = new Set(KNOWN_WRITE_OPS_DRIFT[tool.name] ?? []);
      for (const op of enumOps) {
        const classified = write.has(op) || read.has(op) || knownDrift.has(op);
        expect(
          classified,
          `UNCLASSIFIED op "${op}" on ${tool.name}. If it writes, add it to WRITE_OPS in packages/mcp-server/src/server.ts. If it only reads, add it to READ_OPS in this test after confirming it in the source.`,
        ).toBe(true);
      }
    }
  });

  it("the discovered WRITE_OPS drift is EXACTLY the known set (tripwire for any change)", () => {
    // Enum ops neither gated by WRITE_OPS nor marked read. Grows when a new
    // write op is added un-gated, shrinks when the table is fixed — either way
    // this fails and forces constant and source back in sync.
    const computed: Record<string, string[]> = {};
    for (const tool of NON_ADMIN_OP_TOOLS) {
      const enumOps = opEnum(tool)!;
      const write = WRITE_OPS[tool.name] ?? new Set<string>();
      const read = new Set(READ_OPS[tool.name] ?? []);
      const drift = enumOps.filter((op) => !write.has(op) && !read.has(op));
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
    for (const op of [
      "agents",
      "summon_agent",
      "set_agent_status",
      "disengage_agent",
      "join_thread",
      "leave_thread",
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
    for (const tool of NON_ADMIN_OP_TOOLS) {
      const enumOps = opEnum(tool)!;
      const write = WRITE_OPS[tool.name] ?? new Set<string>();
      const read = new Set(READ_OPS[tool.name] ?? []);
      const ungated = enumOps.filter((op) => !write.has(op) && !read.has(op));
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

// ── 1d. Admin-tool gating (every op is destructive → wholesale-gated) ─

describe("admin tool gating", () => {
  it("every registered *_admin tool is in READ_ONLY_BLOCKED_TOOLS", () => {
    for (const tool of TOOLS) {
      if (!isAdmin(tool.name)) continue;
      expect(
        READ_ONLY_BLOCKED_TOOLS.has(tool.name),
        `${tool.name} is an admin tool but is NOT blocked for read-only sessions (missing from READ_ONLY_BLOCKED_TOOLS)`,
      ).toBe(true);
    }
  });

  it("every READ_ONLY_BLOCKED_TOOLS entry is a registered admin tool", () => {
    for (const name of READ_ONLY_BLOCKED_TOOLS) {
      expect(TOOL_BY_NAME.has(name), `READ_ONLY_BLOCKED_TOOLS lists ${name} which is not registered`).toBe(true);
      expect(isAdmin(name), `READ_ONLY_BLOCKED_TOOLS lists non-admin tool ${name}`).toBe(true);
    }
  });

  it("no admin tool is gated per-op via WRITE_OPS (they are wholesale-blocked instead)", () => {
    for (const tool of TOOLS) {
      if (!isAdmin(tool.name)) continue;
      expect(
        WRITE_OPS[tool.name],
        `${tool.name} is wholesale-blocked; it should not also appear in WRITE_OPS`,
      ).toBeUndefined();
    }
  });
});
