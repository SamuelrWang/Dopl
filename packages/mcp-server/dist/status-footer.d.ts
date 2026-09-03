/**
 * status-footer.ts — the `_dopl_status` footer and the wrapper that puts it on
 * a meta-tool's response. ⚠ Both registration helpers in `registrar.ts` end
 * here; that is what makes the footer uniform.
 */
import { type CallerIdentity } from "./tools/identity.js";
import type { ToolResponse } from "./tools/respond.js";
import type { EffectiveWorkspace } from "./workspace-directory.js";
/**
 * Append the mandatory `_dopl_status` footer. ⚠ Reports the EFFECTIVE workspace
 * this call HIT plus a source label (`per-call arg` / `header pin`), and any
 * per-call `note` the registrar wants the agent to see.
 *
 * ⚠ **THE CALLER LINE IS UNCONDITIONAL SINCE B13, AND THE OLD EARLY RETURN WAS
 * THE BUG WAITING TO HAPPEN.** It used to skip the whole footer when there was
 * no effective workspace — harmless while every connection auto-targeted one,
 * and a silent deletion of `caller: id=…` from every response the moment the
 * auto-target went. The server instructions tell every agent that footer opens
 * with its own user id; a workspace it has not got must not take the identity
 * with it.
 *
 * Skipped only when the handler returned `isError` — don't muddy error messages.
 */
export declare function appendDoplStatus(response: ToolResponse, effective: EffectiveWorkspace | null, caller: CallerIdentity, note?: string | null): Promise<ToolResponse>;
/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the connection's container (if any).
 */
export declare function withDoplStatus<A extends object>(handler: (args: A) => Promise<ToolResponse>, getEffective: () => EffectiveWorkspace | null, caller: CallerIdentity): (args: A) => Promise<ToolResponse>;
