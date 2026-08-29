/**
 * `dopl_agent` WRITE op handlers: create, update. Routed from the registrar in
 * `agent.ts`.
 *
 * ── THE THREE THINGS EVERY LINE IN HERE RESPECTS ──────────────────────────
 *
 * 1. 🔒 **THE HOME-SHELF FENCE IS THE SERVER'S, AND IT REFUSES RATHER THAN
 *    DOWNGRADING.** `src/features/agent-templates/server/service-writes.ts ›
 *    resolveTemplateHomeScope` wants three things at once — a credential that
 *    stands for a PERSON, a PRIVATE row, and the caller's OWN default standard
 *    workspace — and 403s otherwise. Nothing here relaxes it; the only local
 *    work is REFUSING A CONTRADICTION BEFORE THE ROUND TRIP (spec §7.2), the
 *    `channel-ops-write.ts` refuse-before-send idiom.
 *
 * 2. ⚠ **A CONTAINER-LOCKED SESSION IS REFUSED BY B1, NOT BY THE SHELF FENCE,
 *    AND THE TWO MUST NOT BE CONFUSED.** That confusion IS F-336. A container
 *    session is NOT a shared credential — it is one human's session, it owns
 *    private rows exactly as its operator does — and what stops it writing the
 *    operator's personal shelf is the credential's workspace lock answering 403
 *    first. Nothing in this file lets it reach that shelf, and nothing should.
 *
 * 3. ⚠ **THE CONFIRM GATE IS A TRIPWIRE.** See `confirm-token.ts`'s header. It
 *    fires only for a row landing at `visibility: "workspace"` inside a SHARED
 *    link container — publishing the operator's agent identity into the room a
 *    peer is standing in, which is precisely the argument
 *    `lib/template-draft.ts › containerCopyDraft` was reversed over on
 *    2026-08-27.
 *    ⚠ IT READS THE EXPLICIT `visibility` ONLY. An OMITTED visibility takes the
 *    server's default, which is `private` for every credential that stands for a
 *    person and `workspace` for one that does not — and a credential that does
 *    not is `isSharedCredential`, which B1 keeps out of containers entirely. So
 *    the omitted case cannot publish into a shared room; said here because the
 *    reasoning is not local to this file.
 */
import type { DoplClient, TemplateField, TemplateVisibility } from "@dopl/client";
import { type ToolResponse } from "./respond.js";
import { type ShelfArg } from "./shelf.js";
export interface TemplateWriteInput {
    name?: string;
    description?: string | null;
    instructions?: string | null;
    model?: string | null;
    fields?: TemplateField[];
    visibility?: TemplateVisibility;
    knowledge_bases?: string[];
    shelf?: ShelfArg;
    confirm_token?: string;
}
export declare function opCreate(client: DoplClient, callerUserId: string | null, input: TemplateWriteInput & {
    name: string;
}): Promise<ToolResponse>;
/**
 * ⚠ THE SHELF IS NOT PATCHABLE, AND THE REFUSAL SAYS SO RATHER THAN IGNORING
 * THE ARG. `home_scoped` is set at create and never written again for bases and
 * templates alike (F-342; Samuel's ruling Q8, 2026-08-28 keeps it that way for
 * v1), and the server's update schema does not accept it — so a silently
 * dropped `shelf` here would return a 2xx over a move that never happened.
 */
export declare function opUpdate(client: DoplClient, callerUserId: string | null, ref: string, input: TemplateWriteInput): Promise<ToolResponse>;
