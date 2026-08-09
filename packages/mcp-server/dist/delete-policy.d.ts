/**
 * §2b — DELETION IS APP-ONLY (Samuel, 2026-08-07). Agents cannot delete
 * anything over MCP.
 *
 * Deleting in the Dopl app is PERMANENT and carries an "are you sure"
 * confirmation. An MCP delete has no dialog by nature — there is no human in
 * the loop at the moment the row goes — so the only way permanent deletion is
 * safe is if the MCP half simply does not delete. Hence: refuse, don't
 * delete-and-hope.
 *
 * ONE CHOKE POINT, TWO MECHANISMS, deliberately:
 *   1. {@link DELETE_BLOCKED_OPS} enumerates today's delete ops verbatim, read
 *      off each tool's own `op` enum. Explicit is checkable — `parity.test.ts`
 *      and `delete-block.test.ts` both cross-check it against the real enums.
 *   2. {@link DELETE_OP_SHAPE} is the fallback that makes FUTURE tools inherit
 *      the rule: any op on an `*_admin` tool whose name reads as a deletion is
 *      refused even if nobody remembered to add it to the table. A new
 *      destructive op therefore fails CLOSED.
 *
 * The refusal fires in `server.ts`'s registration wrapper BEFORE workspace
 * resolution and before any client call, so a refused delete costs zero round
 * trips and can never half-happen.
 *
 * WHY ITS OWN MODULE AND NOT `server.ts`. The policy has two halves — the
 * refusal the wrapper returns, and the description each `_admin` tool
 * ADVERTISES — and they have to say the same thing or the tool list promises a
 * delete the server refuses. The advertising half is built by
 * {@link deleteAdminDescription}, which the four `_admin` registrars under
 * `tools/` call; `server.ts` imports those registrars, so parking the policy
 * there would close the loop into an import cycle. One module, one reason to
 * change, both halves in it.
 */
/** The delete ops each live `_admin` tool publishes, read off its `op` enum. */
export declare const DELETE_BLOCKED_OPS: Record<string, Set<string>>;
/** An op name that reads as a deletion. The fail-closed half of the rule. */
export declare const DELETE_OP_SHAPE: RegExp;
/** True when `op` on `tool` deletes something the agent may not delete. */
export declare function isBlockedDeleteOp(tool: string, op: string): boolean;
/**
 * The one refusal, worded once. It states the rule, names the place the user
 * can actually do it, and closes the retry loop — an agent told only "no" will
 * try op="delete_file" after op="delete_base".
 */
export declare const DELETE_REFUSAL = "Deletion is app-only. Ask the user to delete this in the Dopl app. Agents cannot delete over MCP \u2014 no role, scope or argument changes that, so do not retry this with different parameters. Editing and rewriting are still available to you (dopl_kb op=\"write_file\", dopl_skill op=\"write\", dopl_ontology's update ops).";
/** One refused op on an `_admin` tool: its name, and what it WOULD have done. */
export interface RefusedDeleteOp {
    /** The `op` enum value, quoted verbatim into the description. */
    op: string;
    /** What it would have deleted — a phrase, no trailing period. */
    effect: string;
}
/**
 * Build an `_admin` tool's description: the shared refusal preamble, the ops it
 * publishes only to refuse, and the domain's own alternatives paragraph.
 *
 * The preamble used to be hand-copied into all four registrars, three sentences
 * at a time, which made {@link DELETE_REFUSAL}'s "worded once" claim false and
 * put the policy an agent READS a copy-paste away from the policy the server
 * ENFORCES. `parity.test.ts` asserts every admin description opens by stating
 * the refusal; this is what makes that true by construction.
 *
 * The ops stay listed rather than vanishing with the tool: an absent tool reads
 * to an agent as a broken connection and gets retried, where a refusal that
 * names the app is acted on.
 */
export declare function deleteAdminDescription(refusedOps: RefusedDeleteOp[], alternatives: string): string;
