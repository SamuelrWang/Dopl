/**
 * gating.ts — THE FOUR GATES, and the three tables they read.
 *
 * Split out of `server.ts` (§2, the layer rule) on the same seam
 * `delete-policy.ts` was: a policy has one reason to change and it is not the
 * reason a registrar changes. `delete-policy.ts` stayed its own module because
 * BOTH halves of §2b (the refusal and the advertised description) had to agree;
 * this module is the other half of that story — the gates that CONSUME it,
 * together with the tables that are theirs alone.
 *
 * THE TOPOLOGY IS THE INVARIANT, and it did not move with the code.
 * TWO gates run at REGISTRATION (the tool never exists) and TWO run per CALL
 * (the op is refused):
 *
 *   registration → {@link Gates.isSuppressedTool}: HIDDEN_TOOLS (D2 retirement)
 *                  and, for a read-only session, READ_ONLY_BLOCKED_TOOLS.
 *   per call     → {@link Gates.opRefusal}: §2b's app-only-deletion block
 *                  FIRST and unconditionally, then the write-scope gate.
 *
 * They live HERE, hoisted out of the registration wrapper, because
 * `registerMetaTool` registers straight onto the SDK server and so published
 * two tools that passed through none of them when the gating was inline. That
 * was inert — neither meta-tool is hidden, blocked, or carries an `op` — but
 * inert was a property of today's two tools, not of the path. Do NOT push these
 * back inside a wrapper; both registration helpers call them explicitly.
 *
 * ORDERING INSIDE `opRefusal` IS LOAD-BEARING. The delete refusal fires first
 * and unconditionally, before workspace resolution and before any client call,
 * so a refused delete costs zero round trips and can never half-happen. It must
 * not become reachable only after some other gate happens to let the call
 * through.
 *
 * `parity.test.ts` / `delete-block.test.ts` PARSE `WRITE_OPS`,
 * `READ_ONLY_BLOCKED_TOOLS` and `HIDDEN_TOOLS` out of this file's source text
 * (see `tools/parity-harness.ts`), so the suites check the REAL tables. The
 * parse follows the constant, not the filename — same note `delete-policy.ts`
 * carries.
 */

import { DELETE_REFUSAL, isBlockedDeleteOp } from "./delete-policy.js";
import type { ToolResponse } from "./tools/respond.js";

/**
 * RETIREMENT (2026-08-07, D1 + D2) — the tools an agent no longer sees.
 *
 * Workflows and their clusters are hidden from users and agents for launch.
 * The CODE STAYS: `cluster.ts` / `workflow.ts` are untouched, their registrars
 * are still called by `server.ts`, and `/api/workflows/**` + `/api/clusters/**`
 * stay live and authenticated (D3) — nothing is deleted, so bringing the
 * feature back is deleting four strings from this set.
 *
 * WHY AT THE REGISTRAR AND NOT AT THE ROUTE. The MCP server reaches those
 * routes over LOOPBACK HTTP through `DoplClient`, so gating the routes would
 * have killed the tools by 500-ing them — an agent would still SEE
 * `dopl_workflow` in `tools/list`, call it, and be told the server is broken.
 * Refusing at the registrar is the honest shape: the tool never registers, so
 * it is absent from `tools/list` and there is nothing to call. Same mechanism
 * and same choke point as `READ_ONLY_BLOCKED_TOOLS`, one table below it.
 */
export const HIDDEN_TOOLS = new Set([
  "dopl_workflow",
  "dopl_workflow_admin",
  "dopl_cluster",
  "dopl_cluster_admin",
]);

/** Purely destructive tools aren't even registered for a read-only session. */
export const READ_ONLY_BLOCKED_TOOLS = new Set([
  "dopl_chats_admin",
  "dopl_cluster_admin",
  "dopl_kb_admin",
  "dopl_skill_admin",
  "dopl_workflow_admin",
  "dopl_ontology_admin",
]);

/**
 * Per-op write gating for the MIXED read+write tools (these stay registered
 * for read-only sessions so reads still work, but their write ops are
 * refused). Closes the gap where a `dopl.read`-only token could still write
 * via a non-admin tool. Inert while every active token carries `dopl.write`
 * — defense-in-depth for when read-only tokens are issued. Keep each set in
 * sync with the tool's `op` enum; a new write op must be added here.
 */
export const WRITE_OPS: Record<string, Set<string>> = {
  dopl_cluster: new Set(["create", "update"]),
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
  ]),
  dopl_skill: new Set([
    "create",
    "update",
    "write",
    "set_visibility",
  ]),
  dopl_workflow: new Set([
    "create",
    "update",
    "set_graph",
    "add_node",
    "update_node",
    "remove_node",
    "connect",
    "disconnect",
    "set_cluster",
    "restore_workflow",
  ]),
  dopl_chats: new Set(["export", "append", "update", "create_folder", "update_folder"]),
  dopl_channel: new Set([
    "open",
    "invite",
    "post",
    // P0-3 / DECISION 2 (2026-08-04). `milestone` writes a message and
    // `propose_close` writes one too (the marked prompt), so both are writes.
    // `close_thread` STAYS in this set even though the registrar now answers it
    // with a refusal: a read-only token must be refused for the SCOPE reason
    // before it is refused for the human-lane reason, or the shape of the two
    // errors tells a read-only caller which threads exist.
    "milestone",
    "create_thread",
    "propose_close",
    "close_thread",
    "set_thread_mode",
    // The multiplayer writes — `summon_agent` / `rename_agent` /
    // `set_agent_status` / `disengage_agent` / `join_thread` / `leave_thread`
    // — were listed here and are gone with the ops (channels rollback §1).
    // Unlike `close_thread` above they are NOT kept: `close_thread` is still
    // in the enum for a teaching refusal, so a read-only token must be
    // refused for the SCOPE reason first; these are not ops at all.
  ]),
};

/** The four gates, bound to one session's write capability. */
export interface Gates {
  /**
   * Suppressed at registration: absent from `tools/list`, nothing to call.
   * Retired features (D2) and, for a read-only session, the destructive tools.
   * The honest way to remove a capability is for the tool not to exist.
   */
  isSuppressedTool(name: string): boolean;
  /** The `op` a call is asking for, or undefined for an op-less tool. */
  requestedOp(args: unknown): string | undefined;
  /**
   * The per-call refusals, in the order they must fire: deletion is app-only
   * (§2b — unconditional, so it must not be reachable only after some other
   * gate happens to let the call through), then the read-only write-scope
   * gate. Null when the call may proceed. Refusing here means no workspace is
   * resolved and no backend request is made.
   */
  opRefusal(name: string, op: string | undefined): ToolResponse | null;
}

/**
 * Build the gates for one session.
 *
 * `canWrite` is the OAuth scope verdict and it FAILS CLOSED upstream: a
 * session gets write/admin capability only if it presents a scope set that
 * explicitly includes `dopl.write`.
 */
export function createGates(canWrite: boolean): Gates {
  function isSuppressedTool(name: string): boolean {
    if (HIDDEN_TOOLS.has(name)) return true;
    return !canWrite && READ_ONLY_BLOCKED_TOOLS.has(name);
  }

  function requestedOp(args: unknown): string | undefined {
    const op = (args as { op?: unknown } | null)?.op;
    return typeof op === "string" ? op : undefined;
  }

  function opRefusal(name: string, op: string | undefined): ToolResponse | null {
    if (op === undefined) return null;
    if (isBlockedDeleteOp(name, op)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: DELETE_REFUSAL }],
      };
    }
    if (!canWrite && WRITE_OPS[name]?.has(op)) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `This session is read-only — its token lacks the \`dopl.write\` scope. \`${name}\` op="${op}" is a write operation. Reconnect with write access to perform it.`,
          },
        ],
      };
    }
    return null;
  }

  return { isSuppressedTool, requestedOp, opRefusal };
}
