/**
 * ⚠ DELETION IS APP-ONLY. Agents cannot delete anything over MCP: deleting in
 * the app is PERMANENT behind an "are you sure", and an MCP delete has no
 * dialog by nature — no human in the loop at the moment the row goes. Refuse,
 * do not delete-and-hope.
 *
 * ⚠ THE RULE IS ENFORCED IN CODE AT THE CREDENTIAL LAYER, WHICH IS WHY THE FIVE
 * `_admin` TOOLS ARE GONE (2026-09-02). All nine app-only `DELETE` routes carry
 * `sessionOnly: true` (`src/shared/auth/app-only-delete-gate.test.ts`, plus
 * `agent-templates/[templateId]` as the tenth), so an agent credential is
 * refused `SESSION_REQUIRED` at the door. Before that, `gating.ts › opRefusal`
 * was the only thing making the sentence true — and it guarded one door while
 * the loopback REST route stood open. A tool description is a PROMPT;
 * `sessionOnly` is a FENCE. With the fence in place, five tools whose every op
 * was refused unconditionally cost 9,295 served chars to say what one sentence
 * on each domain tool says for free.
 *
 * ⚠ WHAT REMAINS HERE IS THE REGRESSION FENCE, NOT A LIVE REFUSAL PATH. No
 * registered op is in {@link DELETE_BLOCKED_OPS} today — the table names the
 * delete capabilities the app has and the MCP surface MUST NEVER PUBLISH, and
 * `tools/delete-block.test.ts` asserts none of them is in a live `op` enum. It
 * is load-bearing three ways:
 *   1. `src/shared/auth/app-only-delete-gate.test.ts` reads it as the op→route
 *      census, so every op named here must have a `sessionOnly` REST route;
 *   2. {@link isBlockedDeleteOp} refuses one the moment somebody adds it to an
 *      enum, ahead of workspace resolution and any client call;
 *   3. {@link DELETE_OP_SHAPE} fail-closes on any FUTURE `*_admin` op whose name
 *      reads as a deletion, so the rule outlives this table.
 */
/**
 * The delete ops the app owns, keyed by the DOMAIN tool that would publish one.
 *
 * ⚠ KEYED ON THE DOMAIN TOOL SINCE 2026-09-02, when the five `_admin` tools were
 * deleted. The op names are unchanged, so the REST census keys move from
 * `dopl_kb_admin.delete_base` to `dopl_kb.delete_base` and nothing else does.
 * ⚠ EVERY OP HERE MUST BE ABSENT FROM ITS TOOL'S `op` ENUM — that is the whole
 * claim, and `delete-block.test.ts` asserts it in both directions.
 */
export declare const DELETE_BLOCKED_OPS: Record<string, Set<string>>;
/** An op name that reads as a deletion. The fail-closed half of the rule. */
export declare const DELETE_OP_SHAPE: RegExp;
/**
 * True when `op` on `tool` deletes something the agent may not delete.
 *
 * ⚠ THE NAME-SHAPE FALLBACK STAYS SCOPED TO `*_admin` AND MUST NOT BE WIDENED to
 * every tool: `dopl_ontology` publishes `remove_attribute`,
 * `remove_template_field`, `remove_relationship` and `remove_action`, which edit
 * an object that survives. Widening the shape would refuse four working ops with
 * a message about deletion. No `*_admin` tool exists today; the arm is the rule
 * a future one inherits with no table edit.
 */
export declare function isBlockedDeleteOp(tool: string, op: string): boolean;
/**
 * ⚠ THE one refusal, worded once: states the rule, names where the user CAN do
 * it, and closes the retry loop — an agent told only "no" tries
 * op="delete_file" after op="delete_base".
 */
export declare const DELETE_REFUSAL: string;
