/**
 * Shared response + op-dispatch helpers for the consolidated `dopl_<domain>`
 * tools. Each domain tool takes an `op` discriminator plus a flat schema of
 * per-op params (all optional at the schema level), then validates the
 * required params for the chosen op at runtime via `missingParams`.
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
export declare function ok(text: string): ToolResponse;
export declare function err(message: string): ToolResponse;
/**
 * True when a thrown error is an optimistic-concurrency conflict (HTTP
 * 412) from the Dopl API. Duck-typed on `.status` so it works across the
 * @dopl/client module boundary without importing the error class.
 */
export declare function isConflict(e: unknown): boolean;
/**
 * Returns an error response when any of `required` params is absent for the
 * given op, or null when they're all present. Treats undefined / null /
 * empty-string as absent — the same "no value" semantics the old per-tool
 * Zod `.min(1)` requireds enforced. Lets a single flat schema back many ops
 * while still rejecting under-specified calls with a clear message instead
 * of a downstream throw.
 */
export declare function missingParams(op: string, args: Record<string, unknown>, required: string[]): ToolResponse | null;
