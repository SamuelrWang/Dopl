/**
 * `dopl_kb` DOCUMENT reads — `op="outline"` and `op="read_file"`: the two ops
 * that answer *what does this entry SAY*, as against the listings in
 * `knowledge-ops-read.ts`, which answer *what is HERE*.
 *
 * ⚠ **ITS OWN FILE BECAUSE THE READ MODULE PASSED §1's 500-LINE CAP AT THE
 * 2026-09-19 MERGE** (it landed at 557), and the seam is the subject rather
 * than the arithmetic: a LISTING renders many rows of member-written metadata
 * inside one fence and never touches a body, while a DOCUMENT read renders one
 * body, windows it, and owns the section vocabulary — the heading resolver, the
 * miss and ambiguity answers, and the outline. ⚠ **SPLIT RATHER THAN TRIMMED**:
 * three branches of one wave each added a true sentence to this module and none
 * of them is the one to delete.
 *
 * ⚠ Both ops are re-exported from `knowledge-ops-read.ts`, so no importer moved.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type ResponseFormat } from "./response-size";
/**
 * THE OUTLINE OP — every heading in one entry, with what each costs to read.
 *
 * ⚠ **IT IS A READ THAT DELIBERATELY DOES NOT RETURN THE DOCUMENT.** The body
 * is emptied server-side, so an agent deciding WHETHER to read an entry pays a
 * few dozen characters instead of a few thousand. That is the whole trade, and
 * it is why the routing line names this before `read_file`.
 */
export declare function opOutline(client: DoplClient, ref: string, path: string): Promise<ToolResponse>;
/**
 * ⚠ **THREE WAYS TO SPEND LESS ON ONE DOCUMENT, AND THEY COMPOSE IN ONE ORDER.**
 * `section` picks WHAT (server-side — the rest never crosses the wire), then
 * `offset` and `max_chars` pick how much of that to render. A `section` that
 * does not resolve returns the OUTLINE rather than the document, so the retry
 * costs no round trip.
 */
export declare function opReadFile(client: DoplClient, ref: string, path: string, callerUserId?: string | null, format?: ResponseFormat, maxChars?: number, section?: string, offset?: number): Promise<ToolResponse>;
