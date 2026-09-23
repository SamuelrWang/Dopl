/**
 * The gates and their tables. Both registration helpers call them explicitly: `registerMetaTool`
 * bypasses `registerTool`'s wrapper, so never fold them into one. `tools/parity-harness.ts` parses
 * this source text; `tool-profile.test.ts` bans its PERSONA_WORDS here, comments included.
 */

import { DELETE_REFUSAL, isBlockedDeleteOp } from "./delete-policy.js";
import type { ToolResponse } from "./tools/respond.js";
import { READ_ONLY_SESSION, refusal } from "./tools/tool-errors.js";

// Hide-then-delete step one (empty is normal); every name must still be registered.
export const HIDDEN_TOOLS = new Set<string>([]);

/**
 * Containment profiles `X-Dopl-Tool-Profile` may name (`tool-profiles.js › KNOWN_PROFILES`),
 * narrowest first. A profile says how much of the machine a session may touch, never what it is for.
 */
export const TOOL_PROFILES = [
  "read_only",
  "dopl_only",
  "channel_agent",
  "full",
] as const;

export type ToolProfile = (typeof TOOL_PROFILES)[number];

// A value the server cannot place falls to the narrowest profile (fail closed, like the desktop's
// `normalizeProfile`); an absent header is no claim and keeps the whole surface.
export const NARROWEST_TOOL_PROFILE: ToolProfile = TOOL_PROFILES[0];

// Mirrors the desktop's `tool-profiles.js › DOPL_SAFE_TOOLS` (everything but `dopl_channel`); an
// allow list, so a new tool is classified before a contained session is offered it.
const DOPL_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "dopl_kb",
  "dopl_search",
  "dopl_map",
  "dopl_members",
  "dopl_skill",
  "dopl_ontology",
  "dopl_chats",
  "dopl_agent",
  "dopl_status",
  "dopl_workspaces",
]);

// Profile → offered tools (`null` = whole surface). Profiles only NARROW the offered tool set and
// gate nothing: the value is caller-supplied and the desktop gate is authoritative.
const PROFILE_TOOLS: Record<ToolProfile, ReadonlySet<string> | null> = {
  // The desktop denies this profile the whole `mcp__dopl` prefix.
  read_only: new Set<string>([]),
  dopl_only: DOPL_ONLY_TOOLS,
  // `full` minus the shell tool — a built-in this server does not serve.
  channel_agent: null,
  full: null,
};

function normalizeToolProfile(claimed: string): ToolProfile {
  return (TOOL_PROFILES as readonly string[]).includes(claimed)
    ? (claimed as ToolProfile)
    : NARROWEST_TOOL_PROFILE;
}

/**
 * The tools this session is offered, or `null` for no narrowing. Tested on the type: `""` is a
 * profile claim (`tool-profile-header.ts › UNREADABLE_TOOL_PROFILE`), never the full surface.
 */
export function offeredToolsFor(
  claimed: string | null | undefined,
): ReadonlySet<string> | null {
  if (typeof claimed !== "string") return null;
  return PROFILE_TOOLS[normalizeToolProfile(claimed)];
}

/**
 * Per-op write gating for mixed read+write tools; a new write op must be added here or a
 * `dopl.read` token can write through it. Inside these `new Set([ … ])` blocks only op names may be
 * double-quoted, comments included: `tools/parity-harness.ts` and the desktop's
 * `knowledge-read-ops.test.mjs` parse the source text and read every quoted word as an op.
 */
export const WRITE_OPS: Record<string, Set<string>> = {
  dopl_ontology: new Set([
    "create_cluster",
    "update_cluster",
    "create_column",
    "create_object",
    "update_object",
    "set_template_field",
    "remove_template_field",
    "set_attribute",
    "remove_attribute",
    "set_relationship",
    "remove_relationship",
    "set_action",
    "remove_action",
    "claim_anchor",
  ]),
  dopl_kb: new Set([
    "create_base",
    "update_base",
    "create_folder",
    "move_folder",
    "write_file",
    "move_file",
    "set_visibility",
    "grant",
  ]),
  dopl_skill: new Set([
    "create",
    "update",
    "write",
    "set_visibility",
  ]),
  // update can widen visibility (a share); grant lends to another scope (`resource_grants`).
  dopl_agent: new Set(["create", "update", "grant"]),
  dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
  // Its `op` defaults to the read: an absent op is never refused, so a write default escapes (F-621).
  dopl_workspaces: new Set(["create_home_channel"]),
  // `rooms` both reads and writes, so it is gated per action; see {@link isWriteOp}.
  dopl_channel: new Set([
    "send",
    // A write even for rename: it mutates a live process or a local store, not a readable row.
    "manage",
    // rooms.update also reads when `info_card` is omitted; an action that can write is gated whole.
    "rooms.open",
    "rooms.invite",
    "rooms.thread_mode",
    "rooms.update",
    // Every action writes (`channel-vocab.ts › CHANNEL_ACTIONS.artifact`); a new one fails closed.
    "artifact",
  ]),
};

/**
 * Does `op` ({@link Gates.requestedOp}'s key) write? A bare entry gates every action of its op, a
 * dotted one (`rooms.open`) one action; a bare call to an op with dotted write entries fails closed.
 */
export function isWriteOp(name: string, op: string): boolean {
  const writes = WRITE_OPS[name];
  if (!writes) return false;
  if (writes.has(op)) return true;
  const dot = op.indexOf(".");
  if (dot > 0) return writes.has(op.slice(0, dot));
  for (const entry of writes) {
    if (entry.startsWith(`${op}.`)) return true;
  }
  return false;
}

/** One session's gates, bound to its write capability and profile offer. */
export interface Gates {
  /** Absent from `tools/list`: hidden, or outside the profile offer. */
  isSuppressedTool(name: string): boolean;
  requestedOp(args: unknown): string | undefined;
  /** App-only deletion (first, unconditional), then write scope; null = proceed. Before any I/O. */
  opRefusal(name: string, op: string | undefined): ToolResponse | null;
}

/** `canWrite` fails closed upstream (explicit `dopl.write` only); `offeredTools` is resolved. */
export function createGates(
  canWrite: boolean,
  offeredTools: ReadonlySet<string> | null = null,
): Gates {
  function isSuppressedTool(name: string): boolean {
    if (HIDDEN_TOOLS.has(name)) return true;
    return offeredTools !== null && !offeredTools.has(name);
  }

  // `<op>.<action>` when the call names an action — generic, never per-tool.
  function requestedOp(args: unknown): string | undefined {
    const bag = args as { op?: unknown; action?: unknown } | null;
    const op = bag?.op;
    if (typeof op !== "string") return undefined;
    const action = bag?.action;
    return typeof action === "string" ? `${op}.${action}` : op;
  }

  function opRefusal(name: string, op: string | undefined): ToolResponse | null {
    if (op === undefined) return null;
    // The base op: delete-blocked ops are claims about the op enum, which carries no action.
    if (isBlockedDeleteOp(name, op.split(".")[0])) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: DELETE_REFUSAL }],
      };
    }
    if (!canWrite && isWriteOp(name, op)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: refusal(
              READ_ONLY_SESSION,
              `\`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`,
            ),
          },
        ],
      };
    }
    return null;
  }

  return { isSuppressedTool, requestedOp, opRefusal };
}
