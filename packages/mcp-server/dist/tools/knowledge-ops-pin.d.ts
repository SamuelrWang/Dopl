/**
 * `dopl_kb(op="pin" | "unpin")` — the PINNED STARTUP CONTEXT (T81), and the
 * ceiling on what it may cost (Samuel's ruling 2026-09-03).
 *
 * ⚠ **ITS OWN FILE SINCE THE CEILING LANDED.** The pin is the one write on this
 * tool whose cost is paid by somebody who is not the caller — every agent
 * session this workspace launches afterwards — so it grew a measurement, a
 * warning and a refusal that no other write has. Splitting it keeps
 * `knowledge-ops-write.ts` inside the 500-line cap and puts the whole of the
 * launch-budget argument in one place.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * PINNED STARTUP CONTEXT (T81) — put a base (or one entry of it) into what every
 * agent session launched in this workspace is handed at startup, or take it out.
 *
 * ⚠ ONE HANDLER, TWO OPS, AND THE BOOLEAN IS THE ONLY DIFFERENCE. `pin` and
 * `unpin` are separate ops rather than one op with a flag for the reason the
 * REST routes are two verbs: a request that states the END STATE is safe to
 * retry after an ambiguous failure, where a toggle silently un-does a write that
 * landed. On workspace-wide state that un-do changes what every session started
 * afterwards begins with.
 *
 * ⚠ `path` IS WHAT PICKS THE TARGET, and the two are different objects: with a
 * path this pins ONE ENTRY, without it the WHOLE BASE. The result says which,
 * because an agent that believes it pinned a base when it pinned one document
 * will not pin the rest.
 *
 * ⚠ **THERE IS NO `section` ON THIS OP, AND IT IS NOT AN OVERSIGHT.** A section
 * read is computed at READ time from the markdown; a pinned section would have
 * to be REMEMBERED — a heading stored on the row, re-resolved by
 * `service-startup-context.ts` on every launch, and silently emptied the day
 * somebody renames the heading. That is a stored pointer into a document's
 * prose, which is a different feature with a different failure mode. The
 * refusal below suggests pinning a smaller ENTRY instead, and says so.
 *
 * ⚠ **THE CEILING IS MEASURED AFTER THE WRITE AND REVERTED, NOT PREDICTED.**
 * A base pin's cost is the sum of every entry in it, which this process cannot
 * know without reading them all — so the honest measurement is the one the
 * server makes, and the write that overshoots is undone with the idempotent
 * verb that exists for exactly this. ⚠ A revert only ever fires when the write
 * CHANGED something (`after > before`), so re-pinning something already pinned
 * cannot un-pin it.
 */
export declare function opPin(client: DoplClient, ref: string, path: string | undefined, pinned: boolean): Promise<ToolResponse>;
