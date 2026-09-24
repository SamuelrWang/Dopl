/**
 * THE GRANULAR TOOL SURFACE (DMP-013), one verb_noun tool per job, and the legacy call each one
 * runs. `registrar.ts › registerGranular` serves it from this table; the connection's tool set picks
 * which set is listed, and the other stays callable; `granular-text.ts` holds what each tool says. Read/write
 * class, annotations and the `container` arg are DERIVED from `gating.ts › isWriteOp`, `delete-policy.ts`
 * and `workspace-arg.ts` — never restated here.
 *
 * A binding key is `Gates.requestedOp`'s grain: `<legacy tool>:<op>` or `<legacy tool>:<op>.<action>`,
 * bare `<legacy tool>` for the three that take no op. `tool-manifest.test.ts` pins coverage (every
 * legacy key bound exactly once, no delete op), the annotation truth and the naming rules.
 */

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

import { isWriteOp } from "./gating.js";
import { isBlockedDeleteOp } from "./delete-policy.js";

/** The tool sets a connection may ask for (`X-Dopl-Tool-Set`, else `?tools=`); the first is the default. */
export const TOOL_SETS = ["legacy", "granular"] as const;
export type ToolSet = (typeof TOOL_SETS)[number];

/** An absent or unplaceable claim gets the default: a set names tools, it grants nothing. */
export function resolveToolSet(claimed: string | null | undefined): ToolSet {
  return TOOL_SETS.find((set) => set === claimed) ?? TOOL_SETS[0];
}

export type BindingKey = `dopl_${string}`;

export interface GranularTool {
  name: string;
  /** One key, or selector value → key when the tool does several jobs. */
  bind: BindingKey | Readonly<Record<string, BindingKey>>;
  /** The selector arg's name when `bind` is a record. Default `action`. */
  select?: string;
  /** The job an omitted selector runs; only where a legacy call of the same name must still work. */
  selectDefault?: string;
  /** Args fixed by this tool (a decision is a `send` with `kind="decision"`). */
  preset?: Readonly<Record<string, string>>;
  /** Legacy arg names this tool publishes; `container` is derived, never listed. */
  params: readonly string[];
  /**
   * Args the bound legacy schema does not take, typed by the tool's text and handed to the legacy
   * handler past that schema. Each must be read by the handler it reaches (`granular.test.ts`).
   */
  carry?: readonly string[];
  /** Overwrites existing content. Never a delete: deletion is app-only. */
  destructive?: true;
  /** A repeat with the same args leaves the same state. */
  idempotent?: true;
  /** Core: Claude keeps it loaded while the rest defer behind ToolSearch ({@link ALWAYS_LOAD_META}). */
  alwaysLoad?: true;
}

/**
 * The per-tool `_meta` Claude Code reads as "never defer" — any transport, OR'd with the server
 * entry's `alwaysLoad` (bundled CLI 0.3.220: `alwaysLoad: config.alwaysLoad || _meta["anthropic/alwaysLoad"]`).
 */
export const ALWAYS_LOAD_META = { "anthropic/alwaysLoad": true } as const;

export const GRANULAR_TOOLS: readonly GranularTool[] = [
  // ── Orientation ─────────────────────────────────────────────────────────
  { name: "dopl_get_map", bind: "dopl_map", params: [], alwaysLoad: true },
  {
    name: "dopl_search",
    bind: { everything: "dopl_search", knowledge: "dopl_kb:search" },
    select: "within",
    // Shares the legacy tool's name, so a legacy `dopl_search` call lands here in the granular set.
    selectDefault: "everything",
    params: ["query", "limit", "scope", "base", "response_format"],
    alwaysLoad: true,
  },
  { name: "dopl_get_status", bind: "dopl_status", params: ["since"], alwaysLoad: true },
  { name: "dopl_list_workspaces", bind: "dopl_workspaces:list", params: [] },
  { name: "dopl_create_workspace", bind: "dopl_workspaces:create_home_channel", params: ["name"] },
  {
    name: "dopl_get_guide",
    bind: {
      channels: "dopl_channel:rooms.help",
      skill_authoring: "dopl_skill:authoring_guide",
      chats: "dopl_chats:guide",
    },
    select: "topic",
    params: ["section"],
  },
  // ── Channels ────────────────────────────────────────────────────────────
  { name: "dopl_list_channels", bind: "dopl_channel:rooms.list", params: [] },
  {
    name: "dopl_get_channel",
    bind: {
      status: "dopl_channel:status",
      members: "dopl_channel:rooms.members",
      threads: "dopl_channel:rooms.threads",
    },
    params: ["channel"],
  },
  {
    name: "dopl_read_channel",
    bind: "dopl_channel:read",
    params: ["channel", "thread", "since", "limit", "wait_ms", "response_format"],
    alwaysLoad: true,
  },
  {
    name: "dopl_send_message",
    bind: "dopl_channel:send",
    params: ["channel", "to", "body", "kind", "thread", "summary", "client_msg_id"],
    alwaysLoad: true,
  },
  {
    name: "dopl_request_decision",
    bind: "dopl_channel:send",
    preset: { kind: "decision" },
    params: ["channel", "body", "thread", "summary", "options", "recommendation", "client_msg_id"],
    alwaysLoad: true,
  },
  {
    name: "dopl_create_channel",
    bind: "dopl_channel:rooms.open",
    params: ["name", "visibility", "to"],
    carry: ["description"],
  },
  {
    name: "dopl_update_channel",
    bind: { update: "dopl_channel:rooms.update", thread_mode: "dopl_channel:rooms.thread_mode" },
    params: ["channel", "name", "info_card", "thread", "mode"],
    carry: ["description"],
    destructive: true,
    idempotent: true,
  },
  {
    name: "dopl_invite_to_channel",
    bind: "dopl_channel:rooms.invite",
    params: ["channel", "to"],
    idempotent: true,
  },
  {
    name: "dopl_launch_agent",
    bind: "dopl_channel:manage.launch",
    params: ["channel", "name", "thread", "body", "model", "runtime", "identity", "color", "posture", "client_msg_id", "wait_ms"],
  },
  {
    name: "dopl_manage_session",
    bind: {
      end: "dopl_channel:manage.end",
      rename: "dopl_channel:manage.rename",
      posture: "dopl_channel:manage.posture",
      direct: "dopl_channel:manage.direct",
    },
    params: ["channel", "to", "name", "posture", "body", "client_msg_id", "wait_ms"],
    destructive: true,
  },
  {
    name: "dopl_manage_artifact",
    bind: {
      create: "dopl_channel:artifact.create",
      add: "dopl_channel:artifact.add",
      remove: "dopl_channel:artifact.remove",
      dissolve: "dopl_channel:artifact.dissolve",
    },
    params: ["channel", "artifact", "messages", "name", "summary", "client_msg_id"],
    destructive: true,
  },
  // ── Knowledge ───────────────────────────────────────────────────────────
  {
    name: "dopl_browse_knowledge",
    bind: {
      list_bases: "dopl_kb:list_bases",
      tree: "dopl_kb:get_tree",
      list_dir: "dopl_kb:list_dir",
      outline: "dopl_kb:outline",
    },
    params: ["base", "path", "entry_limit", "entry_cursor"],
  },
  {
    name: "dopl_read_entry",
    bind: "dopl_kb:read_file",
    params: ["base", "path", "section", "max_chars", "offset", "response_format"],
    alwaysLoad: true,
  },
  {
    name: "dopl_write_entry",
    bind: "dopl_kb:write_file",
    params: ["base", "path", "section", "body", "title", "excerpt", "expected_version", "force", "client_write_id"],
    destructive: true,
    idempotent: true,
    alwaysLoad: true,
  },
  {
    name: "dopl_manage_knowledge",
    bind: {
      create_base: "dopl_kb:create_base",
      update_base: "dopl_kb:update_base",
      create_folder: "dopl_kb:create_folder",
      move_folder: "dopl_kb:move_folder",
      move_entry: "dopl_kb:move_file",
      publish: "dopl_kb:set_visibility",
      grant: "dopl_kb:grant",
    },
    params: [
      "base", "path", "from_path", "to_path", "name", "description", "slug", "visibility",
      "scope", "to", "level", "confirm_token", "client_write_id",
    ],
    destructive: true,
  },
  // ── Skills ──────────────────────────────────────────────────────────────
  { name: "dopl_list_skills", bind: "dopl_skill:list", params: ["folder"] },
  {
    name: "dopl_get_skill",
    bind: { details: "dopl_skill:get", body: "dopl_skill:read" },
    select: "view",
    params: ["slug", "detail"],
  },
  {
    name: "dopl_create_skill",
    bind: "dopl_skill:create",
    params: ["name", "description", "when_to_use", "when_not_to_use", "status", "agent_write_enabled", "folder", "body"],
  },
  {
    name: "dopl_update_skill",
    bind: { update: "dopl_skill:update", write: "dopl_skill:write", visibility: "dopl_skill:set_visibility" },
    params: [
      "slug", "name", "description", "when_to_use", "when_not_to_use", "new_slug", "status", "folder",
      "body", "expected_version", "force", "visibility", "confirm_token",
    ],
    destructive: true,
    idempotent: true,
  },
  // ── Agent identities ────────────────────────────────────────────────────
  { name: "dopl_list_agents", bind: "dopl_agent:list", params: [] },
  { name: "dopl_get_agent", bind: "dopl_agent:get", params: ["identity", "max_chars"] },
  {
    name: "dopl_manage_agent",
    bind: { create: "dopl_agent:create", update: "dopl_agent:update", grant: "dopl_agent:grant" },
    params: [
      "identity", "name", "description", "instructions", "model", "runtime", "fields", "visibility",
      "knowledge_bases", "knowledge", "expected_version", "force", "confirm_token", "scope", "to", "level",
    ],
    destructive: true,
  },
  // ── Ontology ────────────────────────────────────────────────────────────
  {
    name: "dopl_browse_ontology",
    bind: { map: "dopl_ontology:map", anchor: "dopl_ontology:anchor", resolve: "dopl_ontology:resolve" },
    params: ["query"],
  },
  {
    name: "dopl_get_object",
    bind: "dopl_ontology:get",
    params: ["object", "response_format"],
  },
  {
    name: "dopl_edit_object",
    bind: {
      create: "dopl_ontology:create_object",
      update: "dopl_ontology:update_object",
      set_template_field: "dopl_ontology:set_template_field",
      remove_template_field: "dopl_ontology:remove_template_field",
      set_attribute: "dopl_ontology:set_attribute",
      remove_attribute: "dopl_ontology:remove_attribute",
      set_relationship: "dopl_ontology:set_relationship",
      remove_relationship: "dopl_ontology:remove_relationship",
      set_action: "dopl_ontology:set_action",
      remove_action: "dopl_ontology:remove_action",
      claim_anchor: "dopl_ontology:claim_anchor",
    },
    params: [
      "object", "parent", "name", "subtitle", "label", "kind", "value", "values",
      "targets", "description", "outcome", "tools", "expected_version",
    ],
    destructive: true,
  },
  {
    name: "dopl_manage_ontology",
    bind: {
      create: "dopl_ontology:create_ontology",
      update: "dopl_ontology:update_ontology",
      create_column: "dopl_ontology:create_column",
    },
    params: ["ontology", "name", "purpose"],
    destructive: true,
  },
  // ── Members ─────────────────────────────────────────────────────────────
  {
    name: "dopl_get_member",
    bind: {
      me: "dopl_members:whoami",
      member: "dopl_members:get",
      team: "dopl_members:get_team",
      my_access: "dopl_members:my_access",
    },
    select: "who",
    params: ["member", "team"],
  },
  {
    name: "dopl_list_members",
    bind: {
      members: "dopl_members:list",
      teams: "dopl_members:teams",
      access_matrix: "dopl_members:access_matrix",
    },
    select: "list",
    params: ["fields"],
  },
  // ── Chats ───────────────────────────────────────────────────────────────
  {
    name: "dopl_list_chats",
    bind: { chats: "dopl_chats:list", folders: "dopl_chats:folders" },
    select: "list",
    params: ["scope", "query"],
  },
  { name: "dopl_get_chat", bind: "dopl_chats:get", params: ["chat_id"] },
  {
    name: "dopl_save_chat",
    bind: {
      export: "dopl_chats:export",
      append: "dopl_chats:append",
      update: "dopl_chats:update",
      create_folder: "dopl_chats:create_folder",
      update_folder: "dopl_chats:update_folder",
    },
    params: [
      "chat_id", "title", "overview", "messages", "deliverables", "learnings", "client_session_id",
      "session_date", "source", "project", "folder", "visibility", "pinned", "name", "folder_id",
    ],
    destructive: true,
  },
  // ── Versions ────────────────────────────────────────────────────────────
  {
    name: "dopl_list_versions",
    bind: { entry: "dopl_kb:history", skill: "dopl_skill:history", object: "dopl_ontology:history" },
    select: "resource",
    params: ["base", "path", "slug", "object", "ontology", "revision", "limit", "entry_cursor"],
  },
  {
    name: "dopl_restore_version",
    bind: { entry: "dopl_kb:restore", skill: "dopl_skill:restore", object: "dopl_ontology:restore" },
    select: "resource",
    params: ["base", "path", "slug", "object", "revision", "expected_version"],
    destructive: true,
  },
];

/** A binding key split into the legacy tool and its gate key (`op` or `op.action`). */
export function parseBinding(key: BindingKey): { tool: string; op: string | undefined } {
  const colon = key.indexOf(":");
  return colon < 0 ? { tool: key, op: undefined } : { tool: key.slice(0, colon), op: key.slice(colon + 1) };
}

export function bindingsOf(t: GranularTool): BindingKey[] {
  return typeof t.bind === "string" ? [t.bind] : Object.values(t.bind);
}

/** The arg that picks the job, or null for a one-job tool. */
export function selectorOf(t: GranularTool): string | null {
  return typeof t.bind === "string" ? null : (t.select ?? "action");
}

export const GRANULAR_TOOL_NAMES: ReadonlySet<string> = new Set(GRANULAR_TOOLS.map((t) => t.name));
/** The legacy surface, as the manifest binds it (the test pins that it binds every legacy key). */
export const LEGACY_TOOL_NAMES: ReadonlySet<string> = new Set(
  GRANULAR_TOOLS.flatMap(bindingsOf).map((key) => parseBinding(key).tool),
);

const namesOf = (set: ToolSet) => (set === "granular" ? GRANULAR_TOOL_NAMES : LEGACY_TOOL_NAMES);

/** Is `family`'s tool `name` registered while `set` is active? A name both sets use goes to the active one. */
export function servesName(set: ToolSet, family: ToolSet, name: string): boolean {
  return family === set || !namesOf(set).has(name);
}

/** The inactive set: registered and callable, absent from `tools/list`, so stale prompts still work. */
export function unlistedFor(set: ToolSet): ReadonlySet<string> {
  const inactive = namesOf(set === "granular" ? "legacy" : "granular");
  return new Set([...inactive].filter((name) => !namesOf(set).has(name)));
}

/**
 * A profile's legacy offer widened to the granular tools with a bound legacy tool it offers; such a
 * tool serves only those jobs (`granular.ts › granularShape`).
 */
export function withGranularTools(offer: ReadonlySet<string> | null): ReadonlySet<string> | null {
  if (offer === null) return null;
  const covered = GRANULAR_TOOLS.filter((t) => bindingsOf(t).some((key) => offer.has(parseBinding(key).tool)));
  return new Set([...offer, ...covered.map((t) => t.name)]);
}

function someBinding(t: GranularTool, test: (tool: string, op: string | undefined) => boolean): boolean {
  return bindingsOf(t).some((key) => {
    const { tool, op } = parseBinding(key);
    return test(tool, op);
  });
}

/** Read-only iff no bound key is a gated write. */
export function isReadOnlyTool(t: GranularTool): boolean {
  return !someBinding(t, (tool, op) => op !== undefined && isWriteOp(tool, op));
}

/** A binding the delete policy refuses — must be false for every tool. */
export function bindsDeleteOp(t: GranularTool): boolean {
  return someBinding(t, (tool, op) => op !== undefined && isBlockedDeleteOp(tool, op.split(".")[0]));
}

/** Every hint explicit: the MCP defaults (destructive, open-world) are wrong for a write here. */
export function annotationsFor(t: GranularTool): ToolAnnotations {
  if (isReadOnlyTool(t)) return { readOnlyHint: true, openWorldHint: false };
  return {
    readOnlyHint: false,
    destructiveHint: t.destructive === true,
    idempotentHint: t.idempotent === true,
    openWorldHint: false,
  };
}
