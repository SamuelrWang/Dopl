import { DELETE_IS_APP_ONLY, refusal } from "./tools/tool-errors.js";

/**
 * Deletion is app-only: no op deletes anything over MCP (app DELETE routes are `sessionOnly`).
 * Parsed as source text by `parity-harness.ts › DELETE_POLICY_SOURCE` and
 * `src/shared/auth/app-only-delete-gate.test.ts` — keep the declarations' shape.
 */

/** App-owned delete ops by domain tool; each must stay out of its tool's `op` enum. */
export const DELETE_BLOCKED_OPS: Record<string, Set<string>> = {
  dopl_kb: new Set(["delete_base", "delete_folder", "delete_file"]),
  dopl_skill: new Set(["delete"]),
  dopl_chats: new Set(["delete", "delete_folder"]),
  dopl_ontology: new Set(["delete_object", "delete_ontology"]),
  dopl_agent: new Set(["delete"]),
};

export const DELETE_OP_SHAPE = /^(delete|destroy|purge|trash|remove)(_|$)/;

/** The name-shape fallback stays `*_admin`-only: `dopl_ontology`'s `remove_*` ops edit, not delete. */
export function isBlockedDeleteOp(tool: string, op: string): boolean {
  if (DELETE_BLOCKED_OPS[tool]?.has(op)) return true;
  return tool.endsWith("_admin") && DELETE_OP_SHAPE.test(op);
}

/** The one refusal: states the rule, names where the user can act, and closes the retry loop. */
export const DELETE_REFUSAL = refusal(
  DELETE_IS_APP_ONLY,
  // First sentence pinned verbatim by `retirement.test.ts`.
  `Deletion is app-only. Ask the user to delete this in the Dopl app. No role, scope or argument changes that, so do not retry with different parameters. Editing and rewriting are still available to you (dopl_kb op="write_file", dopl_skill op="write", dopl_ontology's update ops).`,
);
