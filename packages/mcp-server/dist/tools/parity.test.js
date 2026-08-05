"use strict";
/**
 * INVARIANT SUITE — MCP tool parity (packages/mcp-server).
 *
 * This suite mechanically guards the "drift between parallel declarations"
 * bug class that motivated the whole effort. Two real bugs it targets:
 *
 *   1. `dopl_kb` get_tree validated an `entry_limit` param server-side that
 *      was MISSING from the published zod inputSchema — agents couldn't
 *      call it. → guarded by "handler reads only declared params" below.
 *   2. `WRITE_OPS.dopl_skill` in server.ts drifted from the tool's op enum
 *      after an op rename (a latent read-only-token write hole). → guarded
 *      by the WRITE_OPS ⊆ enum + write-op-completeness tests below.
 *
 * Mechanism: every domain tool is captured by calling its registrar with a
 * recording `register` and a stub client (registration is all we need — the
 * client never runs). WRITE_OPS + READ_ONLY_BLOCKED_TOOLS are parsed out of
 * server.ts source text so the tests check the REAL gating tables, not a
 * copy that could itself drift.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
// The auto-discovering "which files make up one tool" scan. It lived here and
// moved to its own module when `channel-deadlines.test.ts` needed the same
// discovery (it had hardcoded its file list, which a §2 split would have
// silently truncated). ONE definition, two suites.
const tool_group_files_js_1 = require("./tool-group-files.js");
const zod_1 = require("zod");
const cluster_js_1 = require("./cluster.js");
const workflow_js_1 = require("./workflow.js");
const knowledge_js_1 = require("./knowledge.js");
const skills_js_1 = require("./skills.js");
const chats_js_1 = require("./chats.js");
const members_js_1 = require("./members.js");
const map_js_1 = require("./map.js");
const search_js_1 = require("./search.js");
const ontology_js_1 = require("./ontology.js");
const channel_js_1 = require("./channel.js");
const REGISTRARS = [
    { file: "cluster.ts", register: cluster_js_1.registerClusterTools },
    { file: "workflow.ts", register: workflow_js_1.registerWorkflowTools },
    { file: "knowledge.ts", register: knowledge_js_1.registerKnowledgeTools },
    { file: "skills.ts", register: skills_js_1.registerSkillTools },
    { file: "chats.ts", register: chats_js_1.registerChatTools },
    { file: "members.ts", register: members_js_1.registerMembersTool },
    { file: "map.ts", register: map_js_1.registerMapTool },
    { file: "search.ts", register: search_js_1.registerSearchTool },
    { file: "ontology.ts", register: ontology_js_1.registerOntologyTool },
    { file: "channel.ts", register: channel_js_1.registerChannelTool },
];
function captureTools() {
    const tools = [];
    const stubClient = {};
    for (const { file, register } of REGISTRARS) {
        const cap = (name, description, schema) => {
            tools.push({ name, description, schema, sourceFile: file });
        };
        register(cap, stubClient);
    }
    return tools;
}
const TOOLS = captureTools();
const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
// Vitest runs with cwd = the package root (this package's vitest.config.ts),
// so source files are addressed relative to it. This avoids both
// `import.meta` (disallowed in the package's CommonJS tsc target) and
// `__dirname` (not guaranteed under the ESM-transformed test).
//
// The param-drift scans below MUST read a tool's WHOLE file set, not just its
// registrar, or a handler that reads an undeclared arg (the get_tree
// `entry_limit` bug class) inside a split-out module slips past the guard.
// `toolGroupSource` is that scan — see `tool-group-files.ts`.
const SRC_DIR = node_path_1.default.resolve(process.cwd(), "src");
function opEnum(t) {
    const op = t.schema.op;
    if (op instanceof zod_1.z.ZodEnum)
        return op.options;
    return null;
}
function isAdmin(name) {
    return name.endsWith("_admin");
}
// ── Parse the REAL gating tables out of server.ts ────────────────────
function parseWriteOps(src) {
    const start = src.indexOf("const WRITE_OPS");
    if (start < 0)
        throw new Error("WRITE_OPS not found in server.ts");
    const block = src.slice(start, src.indexOf("};", start));
    const out = {};
    const entryRe = /(\w+):\s*new Set\(\[([^\]]*)\]\)/g;
    let m;
    while ((m = entryRe.exec(block)) !== null) {
        const ops = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
        out[m[1]] = new Set(ops);
    }
    return out;
}
function parseReadOnlyBlockedTools(src) {
    const marker = "READ_ONLY_BLOCKED_TOOLS = new Set([";
    const start = src.indexOf(marker);
    if (start < 0)
        throw new Error("READ_ONLY_BLOCKED_TOOLS not found in server.ts");
    const block = src.slice(start, src.indexOf("]);", start));
    return new Set([...block.matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}
const SERVER_SOURCE = (0, node_fs_1.readFileSync)(node_path_1.default.join(SRC_DIR, "server.ts"), "utf8");
const WRITE_OPS = parseWriteOps(SERVER_SOURCE);
const READ_ONLY_BLOCKED_TOOLS = parseReadOnlyBlockedTools(SERVER_SOURCE);
// ── Curated READ-OPS allowlist (THE SECURITY REVIEW) ─────────────────
// Per tool, the ops that ONLY read (no client write call in the handler).
// Derived by reading every op handler in the tool sources. Every op in a
// tool's enum must be classified as either a WRITE op (server.ts WRITE_OPS)
// or a read op (here). An op in neither fails the completeness test and
// forces a conscious classification — that failure IS the security review
// for the new op. Human-audit this list against the sources.
const READ_OPS = {
    dopl_cluster: ["list", "get"],
    dopl_workflow: ["list", "get", "step", "list_trash"],
    dopl_kb: ["list_bases", "get_tree", "list_dir", "read_file", "list_trash", "search"],
    dopl_skill: ["list", "get", "read", "authoring_guide"],
    dopl_chats: ["list", "get", "folders", "guide", "list_trash"],
    dopl_members: ["whoami", "list", "get", "teams", "get_team", "access_matrix", "my_access"],
    dopl_ontology: ["map", "anchor", "resolve", "get"],
    // `members` is a roster READ: `opMembers` calls only `listChannelMembers`
    // (GET /api/channels/[id]/members) and renders it. Channel membership is
    // changed by op="invite" (a write, gated below) and in the web UI.
    // `agents` is a roster READ, exactly like `members`: `opAgents` calls only
    // `listChannelAgents` (GET /api/channels/[id]/agents) plus the fail-soft
    // member-name enrichment, and renders them. The roster is CHANGED by
    // op="summon_agent" / "rename_agent" / "set_agent_status" /
    // "disengage_agent" — all gated as writes in server.ts.
    //
    // `disengage_agent` IS A WRITE despite being the one agent op a non-owner may
    // call: it PATCHes `channel_agents` (clearing `engaged_at` / `engaged_by`).
    // "who may call it" and "does it write" are different questions, and answering
    // the second with the first is how a write op ends up callable from a
    // read-only token.
    dopl_channel: [
        "list",
        "read",
        "await",
        "members",
        "list_threads",
        "get_thread",
        // read-session-state (rollback §3.5): `opReadSessions` calls only
        // `listChannelSessions` (GET /api/channels/sessions) and renders it —
        // own-scoped, no write. The desktop WRITE that feeds it is a separate,
        // flagged delivery gap, not an MCP op.
        "read_sessions",
    ],
};
// ── KNOWN DRIFT ledger ────────────────────────────────────────────────
// Write ops absent from server.ts WRITE_OPS (read-only-token write holes)
// discovered by this suite get listed here until fixed. 2026-07-11: the
// original three (dopl_chats.update_folder, dopl_ontology.set_template_field
// + remove_template_field) were fixed in server.ts — the set is empty and
// the security tripwire below enforces it stays empty.
const KNOWN_WRITE_OPS_DRIFT = {};
const NON_ADMIN_OP_TOOLS = TOOLS.filter((t) => !isAdmin(t.name) && opEnum(t) !== null);
// ── Sanity: capture worked ───────────────────────────────────────────
(0, vitest_1.describe)("tool capture", () => {
    (0, vitest_1.it)("registers the expected domain tools", () => {
        const names = TOOLS.map((t) => t.name).sort();
        (0, vitest_1.expect)(names).toEqual([
            "dopl_channel",
            "dopl_chats",
            "dopl_chats_admin",
            "dopl_cluster",
            "dopl_cluster_admin",
            "dopl_kb",
            "dopl_kb_admin",
            "dopl_map",
            "dopl_members",
            "dopl_ontology",
            "dopl_ontology_admin",
            "dopl_search",
            "dopl_skill",
            "dopl_skill_admin",
            "dopl_workflow",
            "dopl_workflow_admin",
        ].sort());
    });
    (0, vitest_1.it)("parsed non-empty WRITE_OPS + READ_ONLY_BLOCKED_TOOLS tables", () => {
        (0, vitest_1.expect)(Object.keys(WRITE_OPS).length).toBeGreaterThan(0);
        (0, vitest_1.expect)(READ_ONLY_BLOCKED_TOOLS.size).toBeGreaterThan(0);
    });
});
// ── 1a. WRITE_OPS ⊆ op enum (kills the stale-op class) ───────────────
(0, vitest_1.describe)("WRITE_OPS ⊆ op enum", () => {
    (0, vitest_1.it)("every WRITE_OPS entry names a registered tool", () => {
        for (const name of Object.keys(WRITE_OPS)) {
            (0, vitest_1.expect)(TOOL_BY_NAME.has(name), `WRITE_OPS references unknown tool ${name}`).toBe(true);
        }
    });
    (0, vitest_1.it)("every op listed in WRITE_OPS exists in that tool's op enum", () => {
        for (const [name, ops] of Object.entries(WRITE_OPS)) {
            const tool = TOOL_BY_NAME.get(name);
            const enumOps = tool ? opEnum(tool) : null;
            (0, vitest_1.expect)(enumOps, `${name} has no op enum but WRITE_OPS gates it`).not.toBeNull();
            for (const op of ops) {
                (0, vitest_1.expect)(enumOps, `WRITE_OPS.${name} lists op="${op}" which is NOT in the tool's op enum (stale op — the WRITE_OPS.dopl_skill drift bug)`).toContain(op);
            }
        }
    });
});
// ── 1b. Write-op completeness (every op is classified) ───────────────
(0, vitest_1.describe)("write-op completeness", () => {
    (0, vitest_1.it)("every op is classified as write (WRITE_OPS) or read (allowlist)", () => {
        for (const tool of NON_ADMIN_OP_TOOLS) {
            const enumOps = opEnum(tool);
            const write = WRITE_OPS[tool.name] ?? new Set();
            const read = new Set(READ_OPS[tool.name] ?? []);
            const knownDrift = new Set(KNOWN_WRITE_OPS_DRIFT[tool.name] ?? []);
            for (const op of enumOps) {
                const classified = write.has(op) || read.has(op) || knownDrift.has(op);
                (0, vitest_1.expect)(classified, `UNCLASSIFIED op "${op}" on ${tool.name}. If it writes, add it to WRITE_OPS in packages/mcp-server/src/server.ts. If it only reads, add it to READ_OPS in this test after confirming it in the source.`).toBe(true);
            }
        }
    });
    (0, vitest_1.it)("the discovered WRITE_OPS drift is EXACTLY the known set (tripwire for any change)", () => {
        // computedDrift = enum ops that are neither gated by WRITE_OPS nor
        // marked read in the allowlist. Must equal KNOWN_WRITE_OPS_DRIFT.
        // Grows if a new write op is added un-gated; shrinks when server.ts
        // is fixed — either way this fails and forces the constant/source in
        // sync.
        const computed = {};
        for (const tool of NON_ADMIN_OP_TOOLS) {
            const enumOps = opEnum(tool);
            const write = WRITE_OPS[tool.name] ?? new Set();
            const read = new Set(READ_OPS[tool.name] ?? []);
            const drift = enumOps.filter((op) => !write.has(op) && !read.has(op));
            if (drift.length > 0)
                computed[tool.name] = drift.sort();
        }
        const expected = {};
        for (const [k, v] of Object.entries(KNOWN_WRITE_OPS_DRIFT)) {
            expected[k] = [...v].sort();
        }
        (0, vitest_1.expect)(computed).toEqual(expected);
    });
    (0, vitest_1.it)("SECURITY: the removed agent-state ops are gone from BOTH gate lists", () => {
        // They were named explicitly here rather than left to the completeness scan
        // above, because the tempting mistake with `disengage_agent` was specific:
        // it was the only agent op the server allowed to somebody who did not own
        // the agent, which read like "not really a write" right up until a
        // read-only token cleared somebody's engagement. The ops are gone (channels
        // rollback §1), so what has to hold now is that neither list still claims
        // to gate them — a stale WRITE_OPS entry for a non-existent op is dead law
        // that reads as coverage.
        const write = WRITE_OPS.dopl_channel ?? new Set();
        const read = READ_OPS.dopl_channel ?? [];
        for (const op of [
            "agents",
            "summon_agent",
            "rename_agent",
            "set_agent_status",
            "disengage_agent",
            "join_thread",
            "leave_thread",
        ]) {
            (0, vitest_1.expect)(write.has(op), `dopl_channel op="${op}" is still gated as a write`).toBe(false);
            (0, vitest_1.expect)(read.includes(op), `dopl_channel op="${op}" is still listed as a read`).toBe(false);
        }
    });
    (0, vitest_1.it)("SECURITY: no read-only-token write holes — every op is gated as write or read", () => {
        for (const tool of NON_ADMIN_OP_TOOLS) {
            const enumOps = opEnum(tool);
            const write = WRITE_OPS[tool.name] ?? new Set();
            const read = new Set(READ_OPS[tool.name] ?? []);
            const ungated = enumOps.filter((op) => !write.has(op) && !read.has(op));
            (0, vitest_1.expect)(ungated, `${tool.name} has un-gated write ops: ${ungated.join(", ")}`).toEqual([]);
        }
    });
});
// ── 1c. Schema / description parity ──────────────────────────────────
// ── KNOWN DRIFT ledger: enum ops missing from the tool description ────
// 2026-07-11: dopl_kb.set_visibility was undocumented; fixed in
// KB_DESCRIPTION. Empty set enforced by the test below.
const KNOWN_DESCRIPTION_DRIFT = {};
(0, vitest_1.describe)("schema / description parity", () => {
    (0, vitest_1.it)("undocumented-op drift is EXACTLY the known set (tripwire for any change)", () => {
        const computed = {};
        for (const tool of TOOLS) {
            const enumOps = opEnum(tool);
            if (!enumOps)
                continue;
            const missing = enumOps.filter((op) => !tool.description.includes(`"${op}"`));
            if (missing.length > 0)
                computed[tool.name] = missing.sort();
        }
        const expected = {};
        for (const [k, v] of Object.entries(KNOWN_DESCRIPTION_DRIFT)) {
            expected[k] = [...v].sort();
        }
        (0, vitest_1.expect)(computed).toEqual(expected);
    });
    (0, vitest_1.it)("every op in the enum is documented in the tool description", () => {
        for (const tool of TOOLS) {
            const enumOps = opEnum(tool);
            if (!enumOps)
                continue;
            for (const op of enumOps) {
                (0, vitest_1.expect)(tool.description.includes(`"${op}"`), `${tool.name} op="${op}" is in the enum but not mentioned in the description string`).toBe(true);
            }
        }
    });
    (0, vitest_1.it)("every declared schema param is referenced in the tool's source", () => {
        for (const tool of TOOLS) {
            // Scan the registrar AND its split-out ops/render/shared modules — a
            // param consumed only in a sibling handler must still count as used.
            const src = (0, tool_group_files_js_1.toolGroupSource)(tool.sourceFile);
            for (const key of Object.keys(tool.schema)) {
                if (key === "op")
                    continue;
                const referenced = new RegExp(`\\b${key}\\b`).test(src);
                (0, vitest_1.expect)(referenced, `${tool.name} declares schema param "${key}" that is never referenced in ${tool.sourceFile} or its split-out modules (described-but-dead param)`).toBe(true);
            }
        }
    });
    (0, vitest_1.it)("every param the handler reads (args.X) is a declared schema param", () => {
        // The `dopl_kb get_tree` bug class: a handler validated `entry_limit`
        // that was absent from the published schema, so agents couldn't pass
        // it. Here: no handler may read an arg the schema doesn't publish.
        // `keysByFile` is keyed by the REGISTRAR file (every tool's sourceFile),
        // and the union of its tools' schema keys is the allowed set for the whole
        // group — including handlers now living in split-out ops/render/shared
        // modules, which we scan via toolGroupSource so their args.X are covered.
        const keysByFile = new Map();
        for (const tool of TOOLS) {
            const set = keysByFile.get(tool.sourceFile) ?? new Set();
            for (const key of Object.keys(tool.schema))
                set.add(key);
            set.add("op");
            keysByFile.set(tool.sourceFile, set);
        }
        for (const [file, allowed] of keysByFile) {
            const src = (0, tool_group_files_js_1.toolGroupSource)(file);
            const accessed = [...src.matchAll(/\bargs\.([a-zA-Z_][a-zA-Z0-9_]*)/g)].map((m) => m[1]);
            for (const id of accessed) {
                (0, vitest_1.expect)(allowed.has(id), `${file} (or a split-out sibling module) reads args.${id} but no tool in that group declares "${id}" as a schema param (get_tree entry_limit bug class)`).toBe(true);
            }
        }
    });
});
// ── 1d. Admin-tool gating (every op is destructive → wholesale-gated) ─
(0, vitest_1.describe)("admin tool gating", () => {
    (0, vitest_1.it)("every registered *_admin tool is in READ_ONLY_BLOCKED_TOOLS", () => {
        for (const tool of TOOLS) {
            if (!isAdmin(tool.name))
                continue;
            (0, vitest_1.expect)(READ_ONLY_BLOCKED_TOOLS.has(tool.name), `${tool.name} is an admin tool but is NOT blocked for read-only sessions (missing from READ_ONLY_BLOCKED_TOOLS)`).toBe(true);
        }
    });
    (0, vitest_1.it)("every READ_ONLY_BLOCKED_TOOLS entry is a registered admin tool", () => {
        for (const name of READ_ONLY_BLOCKED_TOOLS) {
            (0, vitest_1.expect)(TOOL_BY_NAME.has(name), `READ_ONLY_BLOCKED_TOOLS lists ${name} which is not registered`).toBe(true);
            (0, vitest_1.expect)(isAdmin(name), `READ_ONLY_BLOCKED_TOOLS lists non-admin tool ${name}`).toBe(true);
        }
    });
    (0, vitest_1.it)("no admin tool is gated per-op via WRITE_OPS (they are wholesale-blocked instead)", () => {
        for (const tool of TOOLS) {
            if (!isAdmin(tool.name))
                continue;
            (0, vitest_1.expect)(WRITE_OPS[tool.name], `${tool.name} is wholesale-blocked; it should not also appear in WRITE_OPS`).toBeUndefined();
        }
    });
});
