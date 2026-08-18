/**
 * status-footer.ts — the `_dopl_status` footer and the wrapper that puts it on
 * a meta-tool's response. ⚠ Both registration helpers in `registrar.ts` end
 * here; that is what makes the footer uniform.
 */
import { type CallerIdentity } from "./tools/identity.js";
import type { ToolResponse } from "./tools/respond.js";
import type { EffectiveWorkspace } from "./workspace-directory.js";
/**
 * Append the mandatory `_dopl_status` footer. ⚠ Always reports the EFFECTIVE
 * workspace this call HIT plus a source label (`per-call arg` / `sole
 * membership` / `header pin`) — no session-default duality.
 *
 * Skipped when the handler returned `isError` (don't muddy error messages) or
 * there is no effective workspace (meta-tools with no session default).
 */
export declare function appendDoplStatus(response: ToolResponse, effective: EffectiveWorkspace | null, caller: CallerIdentity): Promise<ToolResponse>;
/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the session default (if any).
 */
export declare function withDoplStatus<A extends object>(handler: (args: A) => Promise<ToolResponse>, getEffective: () => EffectiveWorkspace | null, caller: CallerIdentity): (args: A) => Promise<ToolResponse>;
