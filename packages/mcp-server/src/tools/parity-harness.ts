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
import { registerKnowledgeTools } from "./knowledge.js";
import { registerSkillTools } from "./skills.js";
import { registerChatTools } from "./chats.js";
import { registerMembersTool } from "./members.js";
import { registerMapTool } from "./map.js";
import { registerSearchTool } from "./search.js";
import { registerOntologyTool } from "./ontology.js";
import { registerChannelTool } from "./channel.js";
import { registerAgentTools } from "./agent.js";
import { registerHomeTool } from "./home.js";

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
  { file: "knowledge.ts", register: registerKnowledgeTools },
  { file: "skills.ts", register: registerSkillTools },
  { file: "chats.ts", register: registerChatTools },
  { file: "members.ts", register: registerMembersTool },
  { file: "map.ts", register: registerMapTool },
  { file: "search.ts", register: registerSearchTool },
  { file: "ontology.ts", register: registerOntologyTool },
  // ⚠ It takes a `directory` its registrar REQUIRES (the container lock for the
  // two account-wide reads); the harness passes the same stub `home.ts` gets,
  // because capture never runs a handler.
  {
    file: "channel.ts",
    register: (r, c) =>
      registerChannelTool(r, c, undefined, false, STUB_DIRECTORY),
  },
  { file: "agent.ts", register: registerAgentTools },
  // ⚠ **THE ONE META TOOL IN THIS CAPTURE, AND IT EARNS ITS PLACE** (2026-08-28).
  // `current_workspace` / `list_workspaces` are deliberately absent: they carry
  // no `op`, no write and no charge, so every suite below would be vacuous over
  // them. `dopl_home` has all three — an `op` enum, a WRITE op in `WRITE_OPS`,
  // and an explicit credit charge — so leaving it out would mean its enum is
  // never checked against the write-gate table, which is exactly the
  // read-only-token hole `parity.test.ts` exists to close.
  // ⚠ It takes a `directory` its registrar needs; the harness passes a stub,
  // because capture never runs a handler.
  {
    file: "home.ts",
    register: (r, c) => registerHomeTool(r, c, STUB_DIRECTORY),
  },
];

/** Capture never invokes a handler, so the directory is never read. ⚠ The lock
 *  itself is pinned for real in `container-lock.test.ts`, through `bootServer`. */
const STUB_DIRECTORY = {
  getWorkspaceList: async () => [],
  resolveWorkspaceRef: async () => null,
  noWorkspaceError: async () => ({ content: [], isError: true }),
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

export function opEnum(t: CapturedTool): string[] | null {
  const op = t.schema.op;
  if (op instanceof z.ZodEnum) return op.options as string[];
  return null;
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
 * ⚠ THE PARSE FOLLOWS THE CONSTANT, NOT THE FILENAME. `HIDDEN_TOOLS`,
 * `READ_ONLY_BLOCKED_TOOLS` and `WRITE_OPS` live in `gating.ts`; the delete
 * table lives in `delete-policy.ts` (keeping it in `server.ts` would be an
 * import cycle through the four `_admin` registrars). A "not found" throw here
 * means a table was RENAMED or reshaped — the loud failure this parse exists
 * to produce.
 */
export const GATING_SOURCE = readFileSync(path.join(SRC_DIR, "gating.ts"), "utf8");
export const DELETE_POLICY_SOURCE = readFileSync(
  path.join(SRC_DIR, "delete-policy.ts"),
  "utf8",
);

export const WRITE_OPS = parseOpTable(GATING_SOURCE, "WRITE_OPS", "gating.ts");
export const READ_ONLY_BLOCKED_TOOLS = parseToolSet(
  GATING_SOURCE,
  "READ_ONLY_BLOCKED_TOOLS",
  "gating.ts",
);
/** Hide-before-delete guard — see `gating.ts › HIDDEN_TOOLS`. */
export const HIDDEN_TOOLS = parseToolSet(GATING_SOURCE, "HIDDEN_TOOLS", "gating.ts");
/** The §2b app-only-deletion table, same shape as WRITE_OPS. */
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
