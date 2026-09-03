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

import type {
  AgentTemplateCreateInput,
  AgentTemplateUpdateInput,
  DoplClient,
  TemplateField,
} from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr } from "./narration.js";
import {
  grantedLine,
  isGrantRefusal,
  levelForScope,
  notOwnedRefusal,
  resolveGrantScopeId,
  type GrantLevelArg,
  type GrantScopeArg,
} from "./grant.js";
import { ok, err, type ToolResponse } from "./respond.js";
import {
  confirmGate,
  containerPublishUnacknowledged,
  RECONFIRM_REMEDY,
} from "./confirm-token.js";
import {
  isErr,
  knowledgeBaseNotAttachable,
  NO_NAME,
  resolveTemplateOr,
  sharedCredentialPrivateDenied,
  templateWriteDenied,
  type OfferedTemplateVisibility,
} from "./agent-shared.js";

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

/** Map the write errors that have an actionable sentence; rethrow anything
 *  else. ⚠ ONE mapper for both verbs so the two cannot answer differently. */
function mapWriteError(e: unknown): ToolResponse | null {
  // 🔒 G16 — only ever a RACE on these two verbs: `confirmGate` already
  // previewed and spent a token, so reaching this means the room gained a
  // member in between.
  const unacknowledged = containerPublishUnacknowledged(e, RECONFIRM_REMEDY);
  if (unacknowledged) return unacknowledged;
  return (
    sharedCredentialPrivateDenied(e) ??
    knowledgeBaseNotAttachable(e) ??
    templateWriteDenied(e)
  );
}

export async function opCreate(
  client: DoplClient,
  callerUserId: string | null,
  input: TemplateWriteInput & { name: string },
): Promise<ToolResponse> {
  // 🔒 **VISIBILITY IS ALWAYS SENT, NEVER LEFT TO THE SERVER'S DEFAULT**
  // (2026-09-02).
  //
  // ⚠ **AN OMITTED VISIBILITY WAS AN UNESCAPABLE LOOP.** The server's default is
  // credential-dependent (`service-writes.ts › createTemplate`: a SHARED
  // credential defaults to `workspace`, everyone else to `private`), and this
  // process cannot see which it holds. So the gate below computed
  // `publishes: false`, minted no token, and the server then resolved
  // `workspace`, hit its own G16 precondition and answered 400 — whose remedy is
  // "re-issue WITHOUT `confirm_token` for a fresh preview", which is what the
  // caller had just done. Round and round, with nothing the agent could change.
  // ⚠ Sending it makes the wire match what the tool's own description promises
  // ("default 'private'"), so the branch cannot fire at all; a shared credential
  // then gets its clean, named 403 instead of an unanswerable 400.
  const visibility: OfferedTemplateVisibility = input.visibility ?? "private";

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_agent",
      op: "create",
      callerUserId,
      what: `an agent template named ${inlineOr(input.name, NO_NAME)}, shared with the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
      payload: {
        name: input.name,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        model: input.model ?? null,
        visibility,
        knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
        fields: (input.fields ?? []).map((f) => [f.key, f.value]),
      },
    },
    { publishes: visibility === "workspace", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  const body: AgentTemplateCreateInput = {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    model: input.model,
    fields: input.fields,
    visibility,
    knowledgeBaseIds: input.knowledge_bases,
    // 🔒 G16 — THE TOKEN, SPENT, BECOMES THE SERVER'S PRECONDITION. Only ever
    // `true`, and only from a token this call actually consumed: the server
    // ignores the flag outside its predicate, and sending it on a proceed that
    // showed nobody anything would re-create the client-side confirm this
    // replaces. See `confirm-token.ts › ConfirmVerdict`.
    acknowledgeShared: verdict.acknowledgedShared || undefined,
  };
  let template;
  try {
    template = await client.createAgentTemplate(body);
  } catch (e) {
    const mapped = mapWriteError(e);
    if (mapped) return mapped;
    throw e;
  }
  // ⚠ TWO ARMS, because `create` sends the two-arm enum and nothing else: the
  // server's own default for an omitted `visibility` is `private`, so this
  // response cannot describe a row at a visibility this surface never offered.
  const audience =
    template.visibility === "private"
      ? "Private to you — only you and your own agents can see it."
      : "Shared with everyone in this workspace — every member can list it and launch it.";
  return ok(
    [
      `Created agent template ${inlineOr(template.name, NO_NAME)} (id: \`${template.id}\`). ${audience}`,
      `Launch it into a channel with dopl_channel(op="manage", action="launch", channel=…, template="${template.id}") — which ASKS the operator's machine and does not start anything by itself.`,
    ].join("\n"),
  );
}

export async function opUpdate(
  client: DoplClient,
  callerUserId: string | null,
  ref: string,
  input: TemplateWriteInput,
): Promise<ToolResponse> {
  const patch: AgentTemplateUpdateInput = {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    model: input.model,
    fields: input.fields,
    visibility: input.visibility,
    knowledgeBaseIds: input.knowledge_bases,
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    return err(
      `op="update" changed nothing because no field was passed. Pass at least one of: name, description, instructions, model, fields, visibility, knowledge_bases.`,
    );
  }

  const template = await resolveTemplateOr(client, ref);
  if (isErr(template)) return template;

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_agent",
      op: "update",
      callerUserId,
      what: `sharing the agent template ${inlineOr(template.name, NO_NAME)} (id: \`${template.id}\`) with the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
      payload: {
        template: template.id,
        name: patch.name ?? null,
        description: patch.description ?? null,
        instructions: patch.instructions ?? null,
        model: patch.model ?? null,
        visibility: patch.visibility ?? null,
        knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
        fields: (input.fields ?? []).map((f) => [f.key, f.value]),
      },
    },
    { publishes: patch.visibility === "workspace", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  let updated;
  try {
    // 🔒 G16 — the spent token, as the server's precondition. ⚠ SET AFTER the
    // "changed nothing" check above, which counts only fields that move a
    // column: an acknowledgement is an assertion ABOUT a change, never one.
    updated = await client.updateAgentTemplate(template.id, {
      ...patch,
      acknowledgeShared: verdict.acknowledgedShared || undefined,
    });
  } catch (e) {
    const mapped = mapWriteError(e);
    if (mapped) return mapped;
    throw e;
  }
  const note =
    patch.visibility !== undefined
      ? ` Sharing is now: ${updated.visibility}.`
      : "";
  return ok(
    `Updated agent template ${inlineOr(updated.name, NO_NAME)} (id: \`${updated.id}\`).${note}`,
  );
}

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
export async function opGrantTemplate(
  client: DoplClient,
  directory: WorkspaceDirectory,
  selfUserId: string | null,
  ref: string,
  scope: GrantScopeArg,
  to: string,
  level: GrantLevelArg | undefined,
): Promise<ToolResponse> {
  const chosen = levelForScope(scope, level);
  if (isGrantRefusal(chosen)) return chosen;
  const found = await resolveTemplateOr(client, ref);
  if (isErr(found)) return found;
  const notOwned = notOwnedRefusal(found.createdBy, selfUserId, "agent template", found.name);
  if (notOwned) return notOwned;
  const scopeId = await resolveGrantScopeId(directory, scope, to);
  if (isGrantRefusal(scopeId)) return scopeId;
  await client.grantResource({
    resourceType: "agent_template",
    resourceId: found.id,
    scopeType: scope,
    scopeId,
    level: chosen,
  });
  return grantedLine("agent template", found.name, scope, scopeId, chosen);
}
