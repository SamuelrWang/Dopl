/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */
import { z, type ZodRawShape } from "zod";
/**
 * A tool result: text blocks, plus the error flag.
 *
 * IT CARRIED A THIRD FIELD, `_callerAgent` — the named agent ONE call spoke as
 * (`dopl_channel` `as_agent`), read by the `_dopl_status` footer in `server.ts`
 * and stripped there before the response left, because it was our plumbing and
 * not part of the MCP result shape. It rode the RESULT rather than the boot
 * `CallerIdentity` because a session could speak for several agents and
 * mutating the boot record would have made every later response claim the last
 * agent that happened to post. Named agents are gone (channels rollback §1),
 * and with them the field, its `withCallerAgent` setter and the footer clause.
 */
export type ToolResponse = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
};
export type RegisterTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>) => void;
export declare function ok(text: string): ToolResponse;
export declare function err(message: string): ToolResponse;
/**
 * True when a thrown error is an optimistic-concurrency conflict (HTTP
 * 412) from the Dopl API. Duck-typed on `.status` so it works across the
 * @dopl/client module boundary without importing the error class.
 */
export declare function isConflict(e: unknown): boolean;
/**
 * True when a thrown error is a 404 from the Dopl API. Same duck-typing
 * as `isConflict` — lets a tool turn a "nothing matched" backend response
 * into a clean error instead of either an opaque throw or a false success.
 */
export declare function isNotFound(e: unknown): boolean;
/**
 * True when a thrown error is a 409 conflict from the Dopl API (a
 * name/title/slug already-exists collision). Lets a tool surface a clean
 * "already exists" message instead of an opaque throw.
 */
export declare function isAlreadyExists(e: unknown): boolean;
/**
 * Turn a thrown Dopl API error into a friendly tool error when it's a
 * plan-gate denial (HTTP 403, flat entitlement envelope), else null so
 * the caller rethrows.
 *
 * Duck-typed on `.code` / `.apiMessage` / `.upgradeUrl` (populated by
 * `@dopl/client`'s DoplApiError) so it works across the module boundary
 * without importing the error class. Surfaces the server's human message
 * and upgrade link VERBATIM so the agent sees an actionable "upgrade to
 * add more" — not a generic "request failed".
 */
export declare function entitlementDenied(e: unknown): ToolResponse | null;
/**
 * Returns an error response when any of `required` params is absent for the
 * given op, or null when they're all present. Treats undefined / null /
 * empty-string as absent — the same "no value" semantics the old per-tool
 * Zod `.min(1)` requireds enforced. Lets a single flat schema back many ops
 * while still rejecting under-specified calls with a clear message instead
 * of a downstream throw.
 */
export declare function missingParams(op: string, args: Record<string, unknown>, required: string[]): ToolResponse | null;
