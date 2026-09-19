/**
 * `dopl_kb` op="grant" — the one op that LENDS a base to a channel, container or
 * team. Split out of `knowledge-ops-write.ts` on 2026-09-18, which was sitting
 * on the 500-line cap; it is the same seam `knowledge-ops-pin.ts` already takes,
 * one op and the `grant.ts` vocabulary it alone speaks. Routed from the
 * registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import type { ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
import { type GrantLevelArg, type GrantScopeArg } from "./grant";
/**
 * `op="grant"` — lend ONE base to a channel, container or team. The op that
 * REPLACED `op="copy_base"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **THE RESOLVE IS THE ORDINARY ONE.** `resolveBaseOr` answers what this
 * caller may see, `notOwnedRefusal` then narrows that to what they CREATED (R2),
 * and the server repeats both — this tier exists to spend no round trip on a
 * refusal it can already prove and to say WHY, where the server's uniform 404
 * deliberately cannot.
 */
export declare function opGrantBase(client: DoplClient, directory: WorkspaceDirectory, selfUserId: string | null, ref: string, scope: GrantScopeArg, to: string, level: GrantLevelArg | undefined): Promise<ToolResponse>;
