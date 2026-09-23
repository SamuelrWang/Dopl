/**
 * The terse write result: one line of `key=value` facts only this call can say. Standing rules live
 * in `channel-doctrine.ts`; a fact keeps its verdict here as a token (`tags=0/2`) (INVARIANTS §10).
 * `channel-` filename prefix is required by the parity split-scan (`tool-group-files.ts`).
 */
import type { LaunchDirective } from "@dopl/client";
/** Budget for one write result, held per op by `write-result-budget.test.ts` (the renderer bounds values, not lines). */
export declare const WRITE_RESULT_MAX_CHARS = 300;
/** Longest rendered value; ≥45 so a legacy `task-<uuid>-<seq>` id is never clipped (its seq is the distinguishing half). */
export declare const FACT_VALUE_MAX = 48;
/** A value nobody reported, or that does not apply to this call. Never zero. */
export declare const NOT_APPLICABLE = "-";
/** `null` / `undefined` / `""` render {@link NOT_APPLICABLE} rather than dropping the key. */
export type FactValue = string | number | boolean | null | undefined;
/** The one write-result renderer: a head verb, then `key=value` pairs in the caller's order. */
export declare function factsLine(head: string, fields: Record<string, FactValue>): string;
/** `resolved/attempted` over member tags; agent handles resolve on the operator's machine and are never counted. */
export declare function tagFact(resolved: number, attempted: number): string | undefined;
/** `<verdict>(predicted)` at write, `(confirmed)` once the machine reports back; `undefined` = no verdict computed, not `none`. */
export declare function deliveryFact(delivery: string | null | undefined, deliveryAt: string | null | undefined): string | undefined;
/**
 * The applied posture as `posture=<tools>/<messages> chain=on|off`. `null` renders `not reported`
 * and is never back-filled from the request: the desktop may clamp without saying so.
 */
export declare function postureFacts(d: LaunchDirective): Record<string, FactValue>;
/**
 * `runtime=` is the applied runtime on every launch (`null` renders `not reported`, never the request);
 * `runtimeAsked=` prints only on disagreement, `appliedModel=` only when it differs from the requested `model`.
 */
export declare function runtimeFacts(d: LaunchDirective): Record<string, FactValue>;
