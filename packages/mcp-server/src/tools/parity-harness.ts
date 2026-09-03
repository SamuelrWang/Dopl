/**
 * SHARED HARNESS FOR THE INVARIANT SUITES — captures every registered tool and
 * parses the REAL gating tables out of the source that owns each.
 *
 * ⚠ Test-only: nothing in the server imports it, and it is excluded from
 * `tsconfig.json` so it never emits to `dist`. ⚠ ONE definition shared by
 * `parity.test.ts` and `delete-block.test.ts` — two suites building their own
 * tool list is the parallel-declaration drift these suites exist to catch.
 *
 * Tools are captured by calling each registrar with a recording `register` and
 * a stub client. ⚠ Gating tables are PARSED from source text, not imported, so
 * the tests check the real tables and a parse that stops matching fails loudly
 * instead of passing vacuously.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { z, type ZodRawShape } from "zod";
import type { DoplClient } from "@dopl/client";

import type { RegisterTool } from "./respond.js";
import { CHANNEL_ACTIONS } from "./channel-schema.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { registerSkillTools } from "./skills.js";
import { registerChatTools } from "./chats.js";
import { registerMembersTool } from "./members.js";
import { registerMapTool } from "./map.js";
import { registerSearchTool } from "./search.js";
import { registerOntologyTool } from "./ontology.js";
import { registerChannelTool } from "./channel.js";
import { registerAgentTools } from "./agent.js";

// ── Capture every registered domain tool ─────────────────────────────

export interface CapturedTool {
  name: string;
  description: string;
  schema: ZodRawShape;
  /** Basename of the source file that registered it (for source reads). */
  sourceFile: string;
}

export const REGISTRARS: Array<{
  file: string;
  register: (r: RegisterTool, c: DoplClient) => void;
}> = [
  // ⚠ Both take a `directory` their registrars REQUIRE (it resolves the copy
  // ops' `to_workspace`); the harness passes the same stub `channel.ts` and
  // `channel.ts` gets, because capture never runs a handler.
  {
    file: "knowledge.ts",
    register: (r, c) => registerKnowledgeTools(r, c, undefined, STUB_DIRECTORY),
  },
  { file: "skills.ts", register: registerSkillTools },
  { file: "chats.ts", register: registerChatTools },
  { file: "members.ts", register: registerMembersTool },
  { file: "map.ts", register: registerMapTool },
  { file: "search.ts", register: registerSearchTool },
  { file: "ontology.ts", register: registerOntologyTool },
  // ⚠ It takes a `directory` its registrar REQUIRES (the container lock for the
  // two account-wide reads); the harness passes the same stub `knowledge.ts` gets,
  // because capture never runs a handler.
  {
    file: "channel.ts",
    register: (r, c) =>
      registerChannelTool(r, c, undefined, false, STUB_DIRECTORY),
  },
  {
    file: "agent.ts",
    register: (r, c) => registerAgentTools(r, c, undefined, STUB_DIRECTORY),
  },
  // ⚠ **NO META TOOL IS CAPTURED SINCE B13** (2026-09-02). `dopl_home` was the
  // one that earned a place here — it had an `op` enum, a WRITE op in
  // `WRITE_OPS` and a charge, so leaving it out would have meant its enum was
  // never checked against the write-gate table. It is deleted, and the two meta
  // tools that remain (`dopl_workspaces`, `dopl_status`) carry no `op` and no
  // write, so every suite below would be vacuous over them.
];

/** Capture never invokes a handler, so the directory is never read. ⚠ The lock
 *  itself is pinned for real in `container-lock.test.ts`, through `bootServer`. */
const STUB_DIRECTORY = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  lockedWorkspaceId: () => null,
};

export function captureTools(): CapturedTool[] {
  const tools: CapturedTool[] = [];
  const stubClient = {} as DoplClient;
  for (const { file, register } of REGISTRARS) {
    const cap: RegisterTool = (name, description, schema) => {
      tools.push({ name, description, schema, sourceFile: file });
    };
    register(cap, stubClient);
  }
  return tools;
}

export const TOOLS = captureTools();
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ⚠ Paths are relative to the package root (vitest cwd): `import.meta` is
// disallowed by the CommonJS tsc target and `__dirname` is not guaranteed under
// the ESM-transformed test.
//
// ⚠ The param-drift scans MUST read a tool's WHOLE file set, not just its
// registrar, or a handler reading an undeclared arg inside a split-out module
// slips past the guard. `toolGroupSource` is that scan.
export const SRC_DIR = path.resolve(process.cwd(), "src");

/**
 * The op enum **AS PUBLISHED**, or null for a tool that dispatches on none.
 *
 * ⚠ **THE PUBLISHED SET, NOT `ZodEnum.options`, SINCE 2026-09-02 (B8).** It read
 * `.options` until `dopl_channel` grew a runtime enum wider than its published
 * one — twenty-two retired names that parsed for one release so their redirects
 * could run — and every suite below would have classified, documented and gated
 * names no agent could see. ⚠ **THAT GAP CLOSED AT SLICE B16 and this stayed the
 * published set anyway**: it makes the harness read what a CLIENT reads, which
 * is the same discipline `tool-budget.test.ts` applies to descriptions, and it
 * is the one form that cannot go wrong the next time the two diverge.
 */
export function opEnum(t: CapturedTool): string[] | null {
  const op = t.schema.op;
  if (!(op instanceof z.ZodEnum)) return null;
  const published = (
    z.toJSONSchema(z.object({ op }), { io: "input" }) as {
      properties?: { op?: { enum?: unknown } };
    }
  ).properties?.op?.enum;
  return Array.isArray(published)
    ? (published as string[])
    : (op.options as string[]);
}

/**
 * The `action` sub-verb enum a dispatching tool publishes, or null.
 *
 * ⚠ It exists so the gate tables can name ONE action of a mixed op
 * (`rooms.open`) and still be checked against something the tool really
 * declares — an entry naming an action nobody serves is the same dead law a
 * stale op name is.
 */
export function actionEnum(t: CapturedTool): string[] | null {
  // ⚠ It is `.optional()` — three of the five ops take none — so the enum sits
  // one wrapper down. Reading the wrapper would answer `null` for a tool that
  // declares one, which is a guard that passes by finding nothing.
  const declared = t.schema.action;
  const action =
    declared instanceof z.ZodOptional ? declared.unwrap() : declared;
  return action instanceof z.ZodEnum ? (action.options as string[]) : null;
}

export function isAdmin(name: string): boolean {
  return name.endsWith("_admin");
}

// ── Parse the REAL gating tables out of the modules that own them ────

/** A per-tool op table: `NAME: Record<string, Set<string>>` in source. */
function parseOpTable(src: string, name: string, where: string): Record<string, Set<string>> {
  const start = src.indexOf(`const ${name}`);
  if (start < 0) throw new Error(`${name} not found in ${where}`);
  const block = src.slice(start, src.indexOf("};", start));
  const out: Record<string, Set<string>> = {};
  const entryRe = /(\w+):\s*new Set\(\[([^\]]*)\]\)/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(block)) !== null) {
    out[m[1]] = new Set([...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
  }
  return out;
}

/**
 * A bare tool-name table: `NAME = new Set([...])` in source, with or without an
 * explicit type argument (an EMPTY table must be `new Set<string>([])`, since
 * `new Set([])` infers `Set<never>`).
 *
 * ⚠ NOT FOUND THROWS; EMPTY DOES NOT. "The table is gone or renamed" is a
 * broken guard; "the table is empty" is a legitimate state.
 */
function parseToolSet(src: string, name: string, where: string): Set<string> {
  const decl = new RegExp(`${name}\\s*=\\s*new Set(?:<[^>]*>)?\\(\\[`).exec(src);
  if (!decl) throw new Error(`${name} not found in ${where}`);
  const start = decl.index + decl[0].length;
  const end = src.indexOf("]", start);
  if (end < 0) throw new Error(`${name} in ${where} has no closing bracket`);
  const block = src.slice(start, end);
  return new Set([...block.matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}

/**
 * ⚠ THE PARSE FOLLOWS THE CONSTANT, NOT THE FILENAME. `HIDDEN_TOOLS` and
 * `WRITE_OPS` live in `gating.ts`; the delete table lives in
 * `delete-policy.ts`, its own module because the policy is read by BOTH the MCP
 * gate and the app's REST census (`src/shared/auth/app-only-delete-gate.test.ts`
 * parses the same constant out of the same source text). A "not found" throw
 * here means a table was RENAMED or reshaped — the loud failure this parse
 * exists to produce.
 */
export const GATING_SOURCE = readFileSync(path.join(SRC_DIR, "gating.ts"), "utf8");
export const DELETE_POLICY_SOURCE = readFileSync(
  path.join(SRC_DIR, "delete-policy.ts"),
  "utf8",
);

export const WRITE_OPS = parseOpTable(GATING_SOURCE, "WRITE_OPS", "gating.ts");
/** Hide-before-delete guard — see `gating.ts › HIDDEN_TOOLS`. */
export const HIDDEN_TOOLS = parseToolSet(GATING_SOURCE, "HIDDEN_TOOLS", "gating.ts");
/**
 * The app-only-deletion table, same shape as WRITE_OPS. ⚠ Keyed on the DOMAIN
 * tool since 2026-09-02: it names ops that must NEVER appear in a live `op`
 * enum, which is the opposite of `WRITE_OPS`, whose entries must all appear.
 */
export const DELETE_BLOCKED_OPS = parseOpTable(
  DELETE_POLICY_SOURCE,
  "DELETE_BLOCKED_OPS",
  "delete-policy.ts",
);

/**
 * The tools an AGENT actually sees. ⚠ `TOOLS` is the registrar-level capture
 * (right for schema/description parity, since a hidden tool's schema must stay
 * honest) but is NOT the `tools/list` an agent receives — it never passes the
 * `HIDDEN_TOOLS` guard. Assert live-surface claims against THIS.
 *
 * ⚠ Identical to `TOOLS` while `HIDDEN_TOOLS` is empty; do NOT collapse them —
 * that deletes the only place the guard is expressed, and the next retirement
 * ships a "hidden" tool every parity assertion treats as live.
 */
export const VISIBLE_TOOLS = TOOLS.filter((t) => !HIDDEN_TOOLS.has(t.name));

// ── THE GATE KEY A CALL IS CLASSIFIED ON ─────────────────────────────

/**
 * ⚠ **THE OPS THAT DISPATCH AGAIN, ON A SECOND WORD** (2026-09-02, slice B8).
 * `dopl_channel(op="rooms")` READS on four actions and WRITES on four, so the
 * gate key is `<op>.<action>` and the classification below is per PAIR. Anything
 * else would be a hole: gating `rooms` wholesale as a write refuses a
 * `dopl.read` token the four calls it exists to make, and gating it as a read
 * hands one the four that change the room.
 *
 * ⚠ THE MAP IS IMPORTED FROM THE PRODUCTION CONSTANT, never restated — and the
 * case below asserts the published `action` enum is exactly the union of its
 * values, so a verb added to one and not the other fails here rather than
 * arriving unclassified.
 */
export const ACTIONS_BY_OP: Record<string, Readonly<Record<string, readonly string[]>>> = {
  dopl_channel: CHANNEL_ACTIONS,
};

/** Every key a call on `tool` can be gated on — `op`, or `op.action` per pair. */
export function gateKeys(tool: { name: string }, enumOps: readonly string[]): string[] {
  const actions = ACTIONS_BY_OP[tool.name];
  if (!actions) return [...enumOps];
  return enumOps.flatMap((op) =>
    actions[op] ? actions[op].map((a) => `${op}.${a}`) : [op],
  );
}

/**
 * Is `key` — plain `op` or dotted `op.action` — something `tool` really serves?
 * ⚠ ONE resolver for both gate lists, because "this entry names nothing" is the
 * same failure whichever list it sits in, and two copies is how one of them
 * quietly stops asking.
 */
export function servesKey(toolName: string, enumOps: readonly string[], key: string): boolean {
  const [op, action, ...rest] = key.split(".");
  if (rest.length > 0) return false;
  if (!enumOps.includes(op)) return false;
  // ⚠ A BARE OP IS A LEGAL ENTRY EVEN WHERE ACTIONS EXIST — it classifies the
  // whole op, which `gating.ts › isWriteOp` honours the same way. What must NOT
  // be legal is an action nobody serves.
  if (action === undefined) return true;
  return (ACTIONS_BY_OP[toolName]?.[op] ?? []).includes(action);
}

/**
 * Is `key` classified by `set`? ⚠ A bare entry for the op covers every action of
 * it, exactly as the gate reads it — a test that resolved this differently from
 * `gating.ts › isWriteOp` would be measuring a table nothing enforces.
 */
export function classifies(set: ReadonlySet<string>, key: string): boolean {
  const dot = key.indexOf(".");
  return set.has(key) || (dot > 0 && set.has(key.slice(0, dot)));
}
