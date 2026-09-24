/**
 * `dopl_search(scope="everywhere")`: the fan-out. Each leg is an ordinary fenced single-scope
 * search inside its own `workspaceContext.run` — never one query over a workspace set (no new
 * fence). Every hit renders under its scope's heading (provenance is structural; never merge
 * scopes), a failed leg is named, and the leg list IS the locked list (`searchLegs`), so a locked
 * session searches its container alone. The registrar charged one scope; the rest are charged here,
 * sequentially, before each leg runs, and running out stops the fan-out and is named.
 * Before the legs, ONE `scope=account` app search (the server's own membership + lock fence) ranks
 * channel hits across every scope and orders the legs, so the cap drops scopes with no ranked hit
 * first; every scope not searched in full is named.
 */
import type { DoplClient } from "@dopl/client";
import type { ChargeCredit } from "../registrar.js";
import type { SearchLeg } from "../workspace-directory.js";
import type { ToolResponse } from "./respond.js";
import { type Matcher } from "./search-scope.js";
/** A latency budget (each leg is five reads, legs are sequential); a truncation is always named. */
export declare const MAX_SCOPES = 6;
/** The fan-out: body lines plus the coverage sentence. `alreadyCharged` is matched by id, so the
 *  registrar's leg is never charged twice. */
export declare function fanOut(client: DoplClient, charge: ChargeCredit, opts: {
    legs: SearchLeg[];
    query: string;
    limit: number;
    alreadyCharged: string | null;
    matches: Matcher;
}): Promise<{
    lines: string[];
    coverage: string;
    refusal: ToolResponse | null;
}>;
