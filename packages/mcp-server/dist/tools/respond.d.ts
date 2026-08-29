/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
 */
import { z, type ZodRawShape } from "zod";
/** A tool result: text blocks, plus the error flag. */
export type ToolResponse = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
};
export type RegisterTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>) => void;
/**
 * Per-tool options on the META registration path.
 *
 * ⚠ `charged` EXISTS BECAUSE ONE META TOOL IS NOT LIKE THE OTHERS (Samuel's
 * ruling Q2 (b), 2026-08-28). `current_workspace` and `list_workspaces` are
 * uncharged BY DECISION — they are how a lost agent finds out where it is —
 * while `dopl_home` READS CONTENT-ADJACENT DATA AND WRITES, so it pays like a
 * domain tool. It cannot use the domain path at all: that path injects a
 * `workspace=` arg, and this tool is the one that tells you what the containers
 * to pass there even ARE.
 *
 * ⚠ OPT-IN, NEVER A DEFAULT. A blanket charge on this path would meter the two
 * orientation tools, which is the decision the registrar's docblock records and
 * this flag exists to preserve.
 */
export interface MetaToolOptions {
    /** Spend one MCP credit before the handler runs. Default false. */
    charged?: boolean;
}
/** The META registration path. ⚠ Structurally assignable to {@link RegisterTool}
 *  (the extra parameter is optional), so every existing meta registrar keeps
 *  its type. */
export type RegisterMetaTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>, opts?: MetaToolOptions) => void;
export declare function ok(text: string): ToolResponse;
export declare function err(message: string): ToolResponse;
/**
 * True for an optimistic-concurrency conflict (HTTP 412). ⚠ Duck-typed on
 * `.status` to work across the @dopl/client boundary without importing the
 * error class.
 */
export declare function isConflict(e: unknown): boolean;
/** True for a 404. Same duck-typing as `isConflict`. */
export declare function isNotFound(e: unknown): boolean;
/** True for a 409 (name/title/slug already-exists collision). */
export declare function isAlreadyExists(e: unknown): boolean;
/**
 * MCP credit allowance spent for the billing period. ⚠ ONE wording for both
 * surfaces: the registrar's up-front refusal (reading `allowed: false` off the
 * consume response, not an error) and `entitlementDenied` below.
 */
export declare const CREDITS_EXHAUSTED_CODE = "credits_exhausted";
/**
 * Credits refusal rendered exactly like an entitlement denial (message +
 * upgrade link) so an agent reads ONE shape for every plan gate. ⚠ URL comes
 * from the server's consume response — this package cannot import
 * `billing/server/entitlements.ts › upgradeUrl`.
 */
export declare function creditsExhausted(upgradeUrl: string): ToolResponse;
/**
 * Plan-gate denial (403, flat entitlement envelope) → tool error, else null so
 * the caller rethrows. ⚠ Duck-typed on `.code`/`.apiMessage`/`.upgradeUrl` to
 * work across the module boundary. Surfaces the server's human message and
 * upgrade link VERBATIM, not a generic "request failed".
 */
export declare function entitlementDenied(e: unknown): ToolResponse | null;
/**
 * Error response when any `required` param is absent for this op, else null.
 * ⚠ undefined / null / empty-string all count as absent. Lets one flat schema
 * back many ops while still rejecting under-specified calls clearly.
 */
export declare function missingParams(op: string, args: Record<string, unknown>, required: string[]): ToolResponse | null;
