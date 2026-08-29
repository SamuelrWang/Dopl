/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import { type ShelfArg } from "./shelf";
/**
 * 🔒 CREATE, ON EITHER SHELF, WITH THE TWO GATES THE SPEC PUTS AROUND IT.
 *
 * 1. **THE SHELF CONTRADICTION IS REFUSED LOCALLY, BEFORE THE ROUND TRIP**
 *    (spec §7.2, the `channel-ops-write.ts` refuse-before-send idiom).
 *    `shelf: "personal"` sends `homeScoped: true` + `visibility: "private"`, so
 *    an explicit `visibility: "public"` beside it is two incompatible
 *    instructions — and the server's 403 ("the /home shelf holds private bases
 *    only") is correct but reads as a permission problem rather than as
 *    something the caller can fix by dropping one argument.
 *
 * 2. 🔒 **THE HOME-SHELF FENCE STAYS THE SERVER'S.**
 *    `src/features/knowledge/server/service-base-writes.ts › resolveHomeScope`
 *    wants a PERSON's credential, a PRIVATE row, and the caller's OWN default
 *    standard workspace, all three, and 403s otherwise. Nothing here relaxes it
 *    — `shelf.ts › homeShelfForbidden` only makes the refusal actionable.
 *
 * 3. ⚠ **THE CONFIRM GATE IS A TRIPWIRE** (see `confirm-token.ts`). It fires
 *    only for `visibility: "public"` inside a SHARED link container — a base
 *    published into the room a peer is standing in, which is the knowledge half
 *    of the audience-changing class. It does NOT fire in a standard workspace:
 *    `set_visibility` has published bases workspace-wide with no confirm since
 *    long before this wave, and gating one door and not the other would be
 *    theatre.
 */
export declare function opCreateBase(client: DoplClient, callerUserId: string | null, input: {
    name: string;
    description?: string;
    shelf?: ShelfArg;
    visibility?: "public" | "private";
    confirm_token?: string;
}): Promise<ToolResponse>;
export declare function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse>;
export declare function opSetVisibility(client: DoplClient, ref: string, visibility: string): Promise<ToolResponse>;
export declare function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse>;
export declare function opMoveFolder(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse>;
export declare function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string): Promise<ToolResponse>;
export declare function opMoveFile(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse>;
