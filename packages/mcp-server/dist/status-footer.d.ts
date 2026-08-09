/**
 * status-footer.ts — the `_dopl_status` footer (M-4), and the wrapper that
 * puts it on a meta-tool's response.
 *
 * Split out of `server.ts` (§2, the layer rule): what a successful response
 * SAYS about where it landed is a different reason to change than how a tool
 * is registered. Both registration helpers in `registrar.ts` end here, which is
 * what makes the footer uniform.
 */
import { type CallerIdentity } from "./tools/identity.js";
import type { ToolResponse } from "./tools/respond.js";
import type { EffectiveWorkspace } from "./workspace-directory.js";
/**
 * Append the mandatory `_dopl_status` footer to a tool response (M-4). It
 * always reports the EFFECTIVE workspace this call actually hit plus a
 * source label — `per-call arg` (a `workspace=` override), `sole membership`
 * (auto-targeted single workspace), or `header pin` (a request-level
 * X-Workspace-Id). There is no session-default duality: the footer names
 * exactly where the response came from.
 *
 * Skips the footer when:
 *   - the handler returned isError: true (don't muddy error messages), or
 *   - there is no effective workspace to report (only reachable via the
 *     meta-tools when the caller has no session default).
 */
export declare function appendDoplStatus(response: ToolResponse, effective: EffectiveWorkspace | null, caller: CallerIdentity): Promise<ToolResponse>;
/**
 * Wrap a meta-tool handler so every successful response ends with the
 * `_dopl_status` footer reporting the session default (if any). Handlers
 * stay unaware of the mechanism.
 */
export declare function withDoplStatus<A extends object>(handler: (args: A) => Promise<ToolResponse>, getEffective: () => EffectiveWorkspace | null, caller: CallerIdentity): (args: A) => Promise<ToolResponse>;
