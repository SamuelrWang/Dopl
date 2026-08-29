/**
 * search-everywhere.ts — `dopl_search(scope="everywhere")`: THE FAN-OUT.
 *
 * ── THE FOUR PROPERTIES THIS SHAPE EXISTS TO BUY (plan §4.2) ───────────────
 *
 * 1. 🔒 **NO NEW FENCE.** Each leg is N ORDINARY, ALREADY-FENCED CALLS — the
 *    exact request a single-scope search makes, run inside that leg's own
 *    `workspaceContext.run(...)`. Layer A, B1, `canSeeBase` and the guest floors
 *    all apply per leg with no re-statement, and a re-statement is what F-336 and
 *    the `service-shared.ts` mirror-list exist to warn about. **Never widen this
 *    into one query over a workspace set.**
 * 2. **PROVENANCE IS STRUCTURAL.** A hit cannot render without its scope
 *    heading, so "which room is this from" is answered by construction rather
 *    than by a label somebody can forget. ⚠ NO RESULT MAY MERGE TWO SCOPES UNDER
 *    ONE HEADING — a "flat, deduplicated" convenience rendering would silently
 *    delete the design.
 * 3. **A FAILED LEG IS NAMED, NEVER RENDERED AS EMPTY.** "No matches in Acme"
 *    and "Acme could not be read" must never look alike.
 * 4. 🔒 **B3 IS RESPECTED BECAUSE THE LEG LIST *IS* THE LOCKED LIST**
 *    (`home-scopes.ts › searchLegs`). A locked session searches its container and
 *    learns nothing about the existence of anything else.
 *
 * ── THE TWO COSTS, PAID RATHER THAN HIDDEN ────────────────────────────────
 *
 * **CREDITS.** `registrar.ts` charges ONCE, for the resolved workspace, before
 * the handler runs. So this module charges the ADDITIONAL legs explicitly
 * (Samuel's ruling Q3 (b), 2026-08-28) and the total equals the number of scopes
 * searched. ⚠ Legs run SEQUENTIALLY for exactly this reason: the meter has to
 * gate the work, which is the same "charge, then run" ordering the registrar
 * keeps. Out of credits STOPS the fan-out and is NAMED — it never silently
 * shortens the answer.
 *
 * **LATENCY.** N × the per-leg fan of four soft reads, bounded by
 * {@link MAX_SCOPES}. The result states the scope count it ACTUALLY searched and
 * never promises exhaustiveness — `search.ts › scopeNote`'s discipline ("no
 * group here is proof of absence") extended to scopes verbatim.
 */
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { SearchLeg } from "./home-scopes.js";
import type { ToolResponse } from "./respond.js";
/**
 * The hard cap on scopes one call fans out over.
 *
 * ⚠ SIX, AND THE NUMBER IS A LATENCY BUDGET RATHER THAN A TASTE. Each leg is
 * four concurrent reads and the legs are sequential (the meter gates them), so
 * six is ~24 loopback requests on one tool call. Raising it makes a speculative
 * search a hold; lowering it makes the truncation the common case. ⚠ Whatever it
 * is, the truncation is NAMED — a cap the result does not mention is a silent
 * lie about coverage.
 */
export declare const MAX_SCOPES = 6;
/**
 * THE FAN-OUT. Returns the rendered body plus the coverage sentence.
 *
 * ⚠ `alreadyCharged` IS THE LEG THE REGISTRAR ALREADY PAID FOR. Charging it
 * again is the double-count this argument exists to prevent; it is matched by
 * ID, not by position, because the resolved workspace is not always the first
 * leg.
 */
export declare function fanOut(client: DoplClient, charge: ChargeCredit, opts: {
    legs: SearchLeg[];
    query: string;
    limit: number;
    alreadyCharged: string | null;
    matches: (...fields: Array<string | null | undefined>) => boolean;
}): Promise<{
    lines: string[];
    coverage: string;
    refusal: ToolResponse | null;
}>;
