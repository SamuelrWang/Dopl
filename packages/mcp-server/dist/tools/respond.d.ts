/**
 * Response + op-dispatch helpers for the `dopl_<domain>` tools: one `op` discriminator over a flat
 * schema, with each op's required params checked at runtime by {@link missingParams}.
 */
import { z, type ZodRawShape } from "zod";
export type ToolResponse = {
    content: Array<{
        type: "text";
        text: string;
    }>;
    isError?: boolean;
};
export type RegisterTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>) => void;
/** Meta-path options. The charge is opt-in: only `dopl_status` pays. */
export interface MetaToolOptions {
    /** Spend one credit before the handler runs. */
    charged?: boolean;
}
/** Structurally assignable to {@link RegisterTool}: the extra parameter is optional. */
export type RegisterMetaTool = <S extends ZodRawShape>(name: string, description: string, schema: S, handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResponse>, opts?: MetaToolOptions) => void;
export declare function ok(text: string): ToolResponse;
export declare function err(message: string): ToolResponse;
/** HTTP 412. Duck-typed so this package need not import the client's error class. */
export declare function isConflict(e: unknown): boolean;
/** True for a 404. Same duck-typing as `isConflict`. */
export declare function isNotFound(e: unknown): boolean;
/** Duck-typed match on a `@dopl/client` error's status and code. */
export declare function isApiError(e: unknown, status: number, code: string): boolean;
/** The `code` a DoplApiError carries, or null (duck-typed, like {@link isApiError}). */
export declare function apiErrorCode(e: unknown): string | null;
/** The server's own sentence, or null. Prefer it: the server knows which gate refused. */
export declare function apiMessage(e: unknown): string | null;
/**
 * 403 `SESSION_REQUIRED` = an app-only (`sessionOnly`) route, not a grantable permission; any other
 * error → null. No production caller yet; tested in `knowledge-refusals.test.ts`.
 */
export declare function sessionRequired(e: unknown, op: string): ToolResponse | null;
/** True for a 409 (name/title/slug already-exists collision). */
export declare function isAlreadyExists(e: unknown): boolean;
/** Credit allowance spent for the billing period. */
export declare const CREDITS_EXHAUSTED_CODE: string;
/** The consume answer; every field optional (older servers omit some, degraded ones zero them). */
export interface CreditsOutcome {
    wallet?: "personal" | "seat" | null;
    used?: number;
    limit?: number;
    periodEnd?: string;
    upgradeUrl?: string;
    /** What `upgradeUrl` buys, from the server (F-668). Absent or 0 drops the figure; not `limit`. */
    upgradeCredits?: number;
}
/**
 * Credits refusal in the entitlement shape. Names whose counter stopped (nothing is pooled); the
 * upgrade line is decided by `upgradeUrl`, never by the wallet; no `wallet` → the generic sentence.
 */
export declare function creditsExhausted(o: CreditsOutcome): ToolResponse;
/** Plan-gate 403 → tool error with the server's message and upgrade link verbatim; else null. */
export declare function entitlementDenied(e: unknown): ToolResponse | null;
/** Refusal when any `required` param is absent (undefined, null or ""), else null. */
export declare function missingParams(op: string, args: Record<string, unknown>, required: string[]): ToolResponse | null;
/**
 * Refusal when a param the op does NOT take was sent (a flat schema cannot say "this key belongs to
 * that op"), else null. `allowed` is the op's own keys; `op`/`action` always pass. An ignored param
 * would narrate success over an argument that did nothing.
 */
export declare function unusedParams(op: string, args: Record<string, unknown>, allowed: readonly string[]): ToolResponse | null;
/** An op's whole param contract in one call: `missingParams` over `required`, then `unusedParams`
 *  over `required` + `optional`. */
export declare function strictParams(op: string, args: Record<string, unknown>, required: string[], optional?: readonly string[]): ToolResponse | null;
