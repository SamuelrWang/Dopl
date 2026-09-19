/**
 * `dopl_kb` WRITE-VALIDATION MAPPERS — **a 400 from a knowledge route turned
 * into a refusal that names the FIELD, its RULE and the RECOVERY.**
 *
 * ⚠ **ITS OWN MODULE SINCE 2026-09-18 (S52), BECAUSE `knowledge-shared.ts` HIT
 * THE §1 500-LINE CAP.** The seam is a real one: that file RESOLVES refs and
 * maps the two 403s every base write can raise; this one owns the `zod` →
 * sentence translation, which grows a branch every time a field gains a rule.
 *
 * 🔒 **THE RULE THE WHOLE MODULE EXISTS FOR: A BRANCH NAMES ITS OWN FIELD'S
 * RULE AND NO OTHER FIELD'S.** Until this wave a 301-character `excerpt` fell
 * through to the generic arm, which printed *"Titles can't contain '/'"* — so
 * the refusal named `excerpt` and then taught the TITLE rule, and an agent that
 * fixed its title got the same answer again. Every new field gets its own arm,
 * or it does not get a number.
 */
import { type ToolResponse } from "./respond";
/**
 * `write_file` validation failure → a message naming field + rule + recovery.
 * Null when unrecognized, so the caller rethrows.
 */
export declare function writeFileValidationError(e: unknown, title?: string): ToolResponse | null;
/**
 * `create_folder` validation failure → a message naming field + rule + recovery.
 *
 * ⚠ **IT DID NOT EXIST UNTIL 2026-09-18 (S52), AND `opCreateFolder` RETHREW
 * RAW.** The folder half of the 300-char pair was the worse of the two: a
 * `description` over its cap reached the agent as an unhandled
 * `VALIDATION_FAILED` with no field, no number and no remedy — the shape this
 * whole family of mappers exists to prevent. ⚠ The NAME rule is the folder path's
 * leaf, so the remedy names the path and not "the name field", which no caller
 * of this op passes.
 */
export declare function createFolderValidationError(e: unknown): ToolResponse | null;
/**
 * `update_base` validation failure → a message naming field + rule + recovery.
 * Null when unrecognized, so the caller rethrows.
 */
export declare function updateBaseValidationError(e: unknown): ToolResponse | null;
