/**
 * `dopl_kb(op="grant")` — **lend ONE base to a channel, container or team.** The
 * op that REPLACED `op="copy_base"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **ITS OWN MODULE SINCE 2026-09-18 (S53), BECAUSE `knowledge-ops-write.ts`
 * PASSED THE §1 500-LINE CAP.** The seam is a write with its OWN fence story
 * (R2's ownership narrowing, the scope/level pairing, the container-kind
 * refusal) rather than another arm of the entry/base CRUD — nothing else in
 * that file reads `grant.ts`. ⚠ Two branches of the 2026-09-18 wave drew this
 * same seam and wrote this same module; ONE survives (merge, 2026-09-19).
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
