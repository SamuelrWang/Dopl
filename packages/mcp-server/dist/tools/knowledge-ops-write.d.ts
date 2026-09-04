/**
 * `dopl_kb` non-destructive WRITE op handlers: create/update/set_visibility/grant
 * on bases, create/move folders, write/move entries. Every write maps @dopl/client errors — conflict (412),
 * already-exists (409), agent-write-denied (403), and validation (400) —
 * to actionable tool messages. Routed from the registrar in knowledge.ts.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";
import { type GrantLevelArg, type GrantScopeArg } from "./grant";
/**
 * 🔒 CREATE, WITH THE ONE GATE THE SPEC PUTS AROUND IT.
 *
 * ⚠ **THE TWO SHELF RULES THIS DOCBLOCK OPENED WITH ARE GONE (2026-09-02, slice
 * B15, ruling B10)** — the local shelf/visibility contradiction and the server's
 * `resolveHomeScope`. The `home_scoped` column is dropped and a personal base is
 * an ordinary row in the caller's own `kind='personal'` container, so there is
 * no second shelf for a `public` base to contradict.
 *
 * ⚠ **THE CONFIRM GATE IS A TRIPWIRE** (see `confirm-token.ts`). It fires
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
    visibility?: "public" | "private";
    confirm_token?: string;
}): Promise<ToolResponse>;
export declare function opUpdateBase(client: DoplClient, ref: string, name?: string, description?: string | null, slug?: string): Promise<ToolResponse>;
/**
 * ⚠ **THE OTHER PUBLISHING DOOR, AND IT IS NOT PREVIEWED HERE — DELIBERATELY,
 * AND ONLY FOR NOW.** This file used to argue that gating `create_base` and not
 * `set_visibility` "would be theatre". Since G16 the SERVER gates both
 * (`src/features/knowledge/server/service-base-writes.ts › updateBase` →
 * `features/workspaces/server/shared-publish.ts`), so the asymmetry moved: an
 * agent publishing into a shared home channel is now REFUSED here rather than
 * silently allowed, and {@link containerPublishUnacknowledged} is what makes
 * that refusal legible.
 *
 * ⚠ **THE PREVIEW IS HERE SINCE 2026-09-02 (F-441, integration of A3 × A11).**
 * It was a cross-slice request while `tools/knowledge.ts` belonged to another
 * slice: `confirmGate` needs the caller's user id and the call's
 * `confirm_token`, and that arm passed neither, so a shared-container publish
 * answered with a refusal-plus-remedy instead of a preview. Both are plumbed
 * now, and this op previews and confirms exactly as `create_base` does — one
 * mechanism for one act, which is the whole of G16.
 *
 * ⚠ **THE REFUSAL PATH BELOW STAYS AND IS NOT DEAD CODE.** `confirmGate` fires
 * on the SHAPE this process can see (a shared link container); the server's own
 * predicate is the authority and includes facts this process cannot check. A
 * 400 from it still has to be legible, and {@link containerPublishUnacknowledged}
 * is what makes it so. Removing either half leaves one door unguarded.
 *
 * ⚠ NOTHING CHANGES IN A STANDARD WORKSPACE — the server's predicate is
 * `kind='link'` ∧ ≥2 members, and publishing to colleagues costs no extra call.
 */
export declare function opSetVisibility(client: DoplClient, callerUserId: string | null, ref: string, visibility: string, confirmToken?: string): Promise<ToolResponse>;
export declare function opCreateFolder(client: DoplClient, ref: string, path: string, description?: string): Promise<ToolResponse>;
export declare function opMoveFolder(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse>;
/**
 * ⚠ **`section` MAKES THIS A READ-MODIFY-WRITE, AND THE SERVER DOES ALL THREE.**
 * The splice happens against the row `expected_version` was just checked on, so
 * a sectioned write is exactly as safe as a whole-body one — where a caller
 * merging locally would be merging onto a body it fetched in an earlier request.
 *
 * ⚠ **THE RESULT ALWAYS ENDS WITH THE OUTLINE OF WHAT WAS SAVED**, which is the
 * addresses the next read can use, and it LEADS with `reason=UNSECTIONED` when a
 * long body carries no headings at all. **The write lands either way** (Samuel's
 * ruling): refusing would refuse the user's content over our formatting taste.
 */
export declare function opWriteFile(client: DoplClient, ref: string, path: string, body: string, title?: string, expected_version?: string, force?: boolean, excerpt?: string, section?: string): Promise<ToolResponse>;
export declare function opMoveFile(client: DoplClient, ref: string, from_path: string, to_path: string): Promise<ToolResponse>;
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
