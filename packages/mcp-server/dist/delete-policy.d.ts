/**
 * Deletion is app-only: no op deletes anything over MCP (app DELETE routes are `sessionOnly`).
 * Parsed as source text by `parity-harness.ts › DELETE_POLICY_SOURCE` and
 * `src/shared/auth/app-only-delete-gate.test.ts` — keep the declarations' shape.
 */
/** App-owned delete ops by domain tool; each must stay out of its tool's `op` enum. */
export declare const DELETE_BLOCKED_OPS: Record<string, Set<string>>;
export declare const DELETE_OP_SHAPE: RegExp;
/** The name-shape fallback stays `*_admin`-only: `dopl_ontology`'s `remove_*` ops edit, not delete. */
export declare function isBlockedDeleteOp(tool: string, op: string): boolean;
/**
 * The one refusal: states the rule, names where the user can act, and closes the retry loop. The
 * rewrite tools it names are the connection's set's.
 */
export declare const deleteRefusal: () => string;
