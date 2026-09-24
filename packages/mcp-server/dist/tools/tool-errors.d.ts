/**
 * Named error → named remedy: the `reason=` codes an agent matches on, declared once. Every
 * advertised `reason=` must be one a refusal actually renders (string equality with the
 * description's Errors line, `tool-style.test.ts`); a code taught but never emitted is the defect
 * these tables prevent. A `retry` that names a call is a getter over `callRef`, so it reads in the
 * set of whichever connection prints it (a legacy description prints the legacy spelling).
 */
/** One named error. Render it only through {@link refusal}; never hand-write a `reason=` string. */
export interface ToolError {
    /** The literal wire code, never paraphrased. */
    reason: string;
    /** What it means (not what to do), without terminal punctuation. */
    meaning: string;
    /** `"no"` when re-issuing cannot help, else the call that produces the missing input. */
    readonly retry: string;
}
/** The one refusal renderer, so the wire and the description that predicts it cannot drift. */
export declare function refusal(error: ToolError, detail?: string): string;
export declare const MISSING_PARAMS: ToolError;
/** Emit-only: `respond.ts › unusedParams`. A param the op ignores is refused, never dropped. */
export declare const UNUSED_PARAM: ToolError;
/** Emit-only: a channel rename/description write by a caller who cannot manage the room. */
export declare const CHANNEL_MANAGE_REQUIRED: ToolError;
export declare const READ_ONLY_SESSION: ToolError;
export declare const DELETE_IS_APP_ONLY: ToolError;
export declare const AMBIGUOUS_CONTAINER: ToolError;
export declare const CREDITS_EXHAUSTED: ToolError;
/** HTTP 412; `retry` is the read (a manifest key) that yields a fresh `expected_version`. */
export declare function versionConflict(readKey: string): ToolError;
/**
 * Emit-only (`dopl_kb` has no description headroom for a fourth row). Field and bound sit in
 * `meaning`, on the line an agent matches.
 */
export declare function fieldTooLong(field: string, limit: number): ToolError;
/** Emit-only sibling of {@link fieldTooLong}; the rule differs per field, so it is in the detail. */
export declare const KB_INVALID_FIELD: ToolError;
/**
 * Emit-only; maps 404 `KNOWLEDGE_ENTRY_NOT_FOUND`. "May have moved" is load-bearing: `write_file`
 * upserts, so re-writing at a vacated path creates a second entry.
 */
export declare const KB_ENTRY_NOT_FOUND: ToolError;
/** Emit-only. `write_file` upserts, so `force=true` here would write a duplicate at that path. */
export declare const KB_TARGET_VANISHED: ToolError;
export declare const KB_ERRORS: readonly ToolError[];
export declare const SKILL_ERRORS: readonly ToolError[];
export declare const BAD_SESSION_DATE: ToolError;
export declare const CHATS_ERRORS: readonly ToolError[];
export declare const MEMBERS_ERRORS: readonly ToolError[];
export declare const ONTOLOGY_ERRORS: readonly ToolError[];
export declare const AGENT_ERRORS: readonly ToolError[];
export declare const CHANNEL_ERRORS: readonly ToolError[];
export declare const SEARCH_ERRORS: readonly ToolError[];
export declare const STATUS_ERRORS: readonly ToolError[];
