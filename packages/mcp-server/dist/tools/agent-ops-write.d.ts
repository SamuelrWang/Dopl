/**
 * `dopl_agent` WRITE op handlers: create, update, grant. Routed from the
 * registrar in `agent.ts`.
 *
 * ── THE TWO THINGS EVERY LINE IN HERE RESPECTS ────────────────────────────
 *
 * ⚠ **THE SHELF FENCE THIS HEADER OPENED WITH IS GONE (2026-09-02, slice B15,
 * ruling B10).** It had three numbered rules; the first two were about
 * `resolveTemplateHomeScope` and about not confusing it with the credential's
 * container lock (F-336). The `home_scoped` column is dropped and a personal
 * template is an ordinary row in the caller's own `kind='personal'` container,
 * so there is no shelf to fence and no contradiction to refuse before the round
 * trip. **The container LOCK is untouched** — it was always the thing doing the
 * work in rule 2 — and it is still what answers a container-locked session that
 * reaches for a tenancy it is not in.
 *
 * 1. ⚠ **THE CONFIRM GATE IS A TRIPWIRE, AND SINCE G16 IT FEEDS A FENCE.** See
 *    `confirm-token.ts`'s header for the tripwire half — nothing here stops an
 *    agent previewing and echoing the token back without showing a human. What
 *    is new is that a SPENT token now sets `acknowledgeShared: true` on the
 *    write body, and `src/features/workspaces/server/shared-publish.ts` 400s
 *    the write WITHOUT it: an agent that skips the preview no longer skips the
 *    refusal, because the refusal belongs to the server that owns the rows.
 *    It fires only for a row landing at `visibility: "workspace"` inside a SHARED
 *    link container — publishing the operator's agent identity into the room a
 *    peer is standing in.
 *    ⚠ IT READS THE EXPLICIT `visibility` ONLY. An OMITTED visibility takes the
 *    server's default, which is `private` for every credential that stands for a
 *    person and `workspace` for one that does not — and a credential that does
 *    not is `isSharedCredential`, which B1 keeps out of containers entirely. So
 *    the omitted case cannot publish into a shared room; said here because the
 *    reasoning is not local to this file.
 *
 * 2. 🔒 **A GRANT LENDS ONE ROW AND THE FENCE IS BOTH SIDES OF IT** — see
 *    {@link opGrantTemplate} and `grant.ts`. It replaced `op="copy"`, whose
 *    two-leg cross-tenancy create is deleted.
 */
import type { DoplClient, TemplateField } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { type GrantLevelArg, type GrantScopeArg } from "./grant.js";
import { type ToolResponse } from "./respond.js";
import { type OfferedTemplateVisibility } from "./agent-shared.js";
export interface TemplateWriteInput {
    name?: string;
    description?: string | null;
    instructions?: string | null;
    model?: string | null;
    fields?: TemplateField[];
    visibility?: OfferedTemplateVisibility;
    knowledge_bases?: string[];
    confirm_token?: string;
}
export declare function opCreate(client: DoplClient, callerUserId: string | null, input: TemplateWriteInput & {
    name: string;
}): Promise<ToolResponse>;
export declare function opUpdate(client: DoplClient, callerUserId: string | null, ref: string, input: TemplateWriteInput): Promise<ToolResponse>;
/**
 * `op="grant"` — lend ONE template to a channel, container or team. The op that
 * REPLACED `op="copy"` (Wave B slice B15, ruling B11).
 *
 * ⚠ **THIS IS THE `op="share"` §5A SAID WOULD NEVER EXIST, AND THE PREMISE THAT
 * REFUSED IT DIED IN THE SAME WAVE.** The argument was *"a template has no grant
 * table, so sharing into a container IS `visibility: 'workspace'` on
 * `op='update'` — a second verb would be two doors onto one write"*. Since
 * `20260914120000` a template HAS a grant table (`resource_grants` accepts
 * `resource_type='agent_template'`), and the two verbs are no longer one write:
 * `visibility` says who inside THIS container may use the identity, and a grant
 * lends the row to a scope somewhere else. A personal template lives in the
 * caller's own personal container, where `visibility:"workspace"` reaches an
 * audience of one — which is exactly why sharing it needs this op.
 */
export declare function opGrantTemplate(client: DoplClient, directory: WorkspaceDirectory, selfUserId: string | null, ref: string, scope: GrantScopeArg, to: string, level: GrantLevelArg | undefined): Promise<ToolResponse>;
