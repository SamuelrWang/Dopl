/**
 * `dopl_agent` write ops: create, update, grant.
 * The confirm gate is a tripwire (`confirm-token.ts`); the fence is the server's shared-publish check, fed by `acknowledgeShared`.
 */

import type {
  AgentIdentityCreateInput,
  AgentIdentityUpdateInput,
  DoplClient,
  IdentityField,
  IdentityKnowledgeScope,
} from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { inlineOr, NO_NAME } from "./narration.js";
import {
  channelScopeRefusal,
  grantedLine,
  isGrantRefusal,
  levelForScope,
  notOwnedRefusal,
  resolveGrantScopeId,
  type GrantLevelArg,
  type GrantScopeArg,
} from "./grant.js";
import { ok, err, isApiError, isConflict, type ToolResponse } from "./respond.js";
import { refusal, versionConflict } from "./tool-errors.js";
import {
  confirmGate,
  containerPublishUnacknowledged,
  RECONFIRM_REMEDY,
} from "./confirm-token.js";
import {
  knowledgeBaseNotAttachable,
  resolveIdentityOr,
  sharedCredentialPrivateDenied,
  identityWriteDenied,
  type OfferedIdentityVisibility,
} from "./agent-shared.js";
import { isErr } from "./channel-shared.js";
import { duplicateNameNoteFor } from "./duplicate-name.js";
import { fieldTypeRefusal } from "./agent-field-types.js";
import {
  homeChannelRowNotShared,
  resolveHomeChannelContainer,
} from "./container-destination.js";

export interface IdentityWriteInput {
  name?: string;
  description?: string | null;
  instructions?: string | null;
  model?: string | null;
  runtime?: string | null;
  fields?: IdentityField[];
  visibility?: OfferedIdentityVisibility;
  knowledge_bases?: string[];
  knowledge?: Array<{ base: string; folder?: string; entry?: string }>;
  confirm_token?: string;
  /** op="update" only — the Version from `op="get"`. */
  expected_version?: string;
  /** op="update" only — skip the version check. */
  force?: boolean;
}

/** Agent-facing `{base, folder?, entry?}` → the wire's union; total even for the both-set shape zod already refuses. */
function toKnowledgeScopes(
  scopes: IdentityWriteInput["knowledge"],
): IdentityKnowledgeScope[] | undefined {
  if (scopes === undefined) return undefined;
  return scopes.map((s) =>
    s.folder
      ? { baseId: s.base, scope: "folder" as const, folderId: s.folder }
      : s.entry
        ? { baseId: s.base, scope: "entry" as const, entryId: s.entry }
        : { baseId: s.base, scope: "base" as const },
  );
}

/** Sorted: a confirm token is bound to this digest, so the preview and the proceed must hash byte-equal. */
function knowledgeDigest(input: IdentityWriteInput): string[] {
  const scopes = toKnowledgeScopes(input.knowledge) ?? [];
  return scopes
    .map((s) =>
      s.scope === "folder"
        ? `folder:${s.baseId}/${s.folderId}`
        : s.scope === "entry"
          ? `entry:${s.baseId}/${s.entryId}`
          : `base:${s.baseId}`,
    )
    .sort();
}

const IDENTITY_VERSION_CONFLICT = versionConflict('op="get"');

function withStoredTypes(fields: IdentityField[], stored: IdentityField[]): IdentityField[] {
  const types = new Map(stored.map((f) => [f.key, f.type]));
  return fields.map((f) => {
    const type = f.type ?? types.get(f.key);
    return type ? { ...f, type } : f;
  });
}

/** One mapper for both verbs, so create and update cannot answer differently; null → rethrow. */
function mapWriteError(e: unknown): ToolResponse | null {
  // Only a race: confirmGate already spent a token, so the room gained a member in between.
  const unacknowledged = containerPublishUnacknowledged(e, RECONFIRM_REMEDY);
  if (unacknowledged) return unacknowledged;
  return (
    homeChannelRowNotShared(e) ??
    sharedCredentialPrivateDenied(e) ??
    knowledgeBaseNotAttachable(e) ??
    identityWriteDenied(e)
  );
}

/** In a home channel `visibility` defaults to "workspace"; an explicit "private" is refused here, as the server would. */
function homeChannelVisibility(
  requested: OfferedIdentityVisibility | undefined,
): OfferedIdentityVisibility | ToolResponse {
  if (requested === "private") {
    return err(
      `Nothing was created. A home channel holds only what is shared into it, so an agent identity cannot be private there. Create it with visibility="workspace" to share it with everyone in this channel, or pass container="home" to keep it to yourself in your home space.`,
    );
  }
  return "workspace";
}

export async function opCreate(
  client: DoplClient,
  callerUserId: string | null,
  input: IdentityWriteInput & { name: string },
  /** Optional: absent means "not known" and leaves the refusal to the server. */
  directory?: WorkspaceDirectory,
): Promise<ToolResponse> {
  const badType = fieldTypeRefusal(input.fields);
  if (badType) return badType;
  // Visibility is always sent, never the server's credential-dependent default: an omitted one looped the shared-publish preview.
  const inHomeChannel = await resolveHomeChannelContainer(client, directory);
  const chosen: OfferedIdentityVisibility | ToolResponse = inHomeChannel
    ? homeChannelVisibility(input.visibility)
    : (input.visibility ?? "private");
  if (typeof chosen !== "string") return chosen;
  const visibility: OfferedIdentityVisibility = chosen;

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_agent",
      op: "create",
      callerUserId,
      what: `an agent identity named ${inlineOr(input.name, NO_NAME)}, shared with the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
      payload: {
        name: input.name,
        description: input.description ?? null,
        instructions: input.instructions ?? null,
        model: input.model ?? null,
        runtime: input.runtime ?? null,
        visibility,
        knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
        knowledge: knowledgeDigest(input),
        fields: (input.fields ?? []).map((f) => [f.key, f.value, f.type ?? ""]),
      },
    },
    { publishes: visibility === "workspace", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  const body: AgentIdentityCreateInput = {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    model: input.model,
    runtime: input.runtime,
    fields: input.fields,
    visibility,
    knowledgeBaseIds: input.knowledge_bases,
    knowledge: toKnowledgeScopes(input.knowledge),
    // Only ever true, and only from a confirm token this call spent.
    acknowledgeShared: verdict.acknowledgedShared || undefined,
  };
  let identity;
  try {
    identity = await client.createAgentIdentity(body);
  } catch (e) {
    const mapped = mapWriteError(e);
    if (mapped) return mapped;
    throw e;
  }
  // In a home channel `workspace` means the room, not the company.
  const audience =
    identity.visibility === "private"
      ? "Private to you — only you and your own agents can see it."
      : inHomeChannel
        ? "Shared in this channel — everyone here can list it and launch it."
        : "Shared with everyone in this workspace — every member can list it and launch it.";
  // After the create, so a failing list costs nothing; same-container clashes count (identity names are unique nowhere).
  const dup = await duplicateNameNoteFor(
    identity,
    () => client.listAgentIdentities(),
    "agent identity",
    true,
    true,
  );
  return ok(
    [
      `Created agent identity ${inlineOr(identity.name, NO_NAME)} (id: \`${identity.id}\`). ${audience}${dup}`,
      `Launch it into a channel with dopl_channel(op="manage", action="launch", channel=…, identity="${identity.id}") — which ASKS the operator's machine and does not start anything by itself.`,
    ].join("\n"),
  );
}

export async function opUpdate(
  client: DoplClient,
  callerUserId: string | null,
  ref: string,
  input: IdentityWriteInput,
): Promise<ToolResponse> {
  const patch: AgentIdentityUpdateInput = {
    name: input.name,
    description: input.description,
    instructions: input.instructions,
    model: input.model,
    runtime: input.runtime,
    fields: input.fields,
    visibility: input.visibility,
    knowledgeBaseIds: input.knowledge_bases,
    knowledge: toKnowledgeScopes(input.knowledge),
  };
  if (Object.values(patch).every((v) => v === undefined)) {
    return err(
      `op="update" changed nothing because no field was passed. Pass at least one of: name, description, instructions, model, runtime, fields, visibility, knowledge_bases, knowledge.`,
    );
  }

  const identity = await resolveIdentityOr(client, ref);
  if (isErr(identity)) return identity;
  // `fields` is a REPLACE-SET: an omitted `type` keeps the stored twin's by key, never reset to text.
  if (patch.fields) {
    patch.fields = withStoredTypes(patch.fields, identity.fields);
    const badType = fieldTypeRefusal(patch.fields, identity.fields);
    if (badType) return badType;
  }

  const verdict = await confirmGate(
    client,
    {
      tool: "dopl_agent",
      op: "update",
      callerUserId,
      what: `sharing the agent identity ${inlineOr(identity.name, NO_NAME)} (id: \`${identity.id}\`) with the whole home channel`,
      audience: `everyone in that home channel — the peer standing in it can list it, read its instructions, and launch it`,
      payload: {
        identity: identity.id,
        name: patch.name ?? null,
        description: patch.description ?? null,
        instructions: patch.instructions ?? null,
        model: patch.model ?? null,
        runtime: patch.runtime ?? null,
        visibility: patch.visibility ?? null,
        knowledge_bases: [...(input.knowledge_bases ?? [])].sort(),
        knowledge: knowledgeDigest(input),
        fields: (input.fields ?? []).map((f) => [f.key, f.value, f.type ?? ""]),
      },
    },
    { publishes: patch.visibility === "workspace", token: input.confirm_token },
  );
  if (verdict.kind === "halt") return verdict.response;

  let updated;
  try {
    // Set after the "changed nothing" check: an acknowledgement is not itself a change.
    updated = await client.updateAgentIdentity(
      identity.id,
      {
        ...patch,
        acknowledgeShared: verdict.acknowledgedShared || undefined,
      },
      // force → null (blind overwrite); undefined is refused by the SDK without a round trip.
      input.force ? null : input.expected_version,
    );
  } catch (e) {
    // Both 412s (SDK: no version passed; server: stale version) are one refusal with one remedy.
    if (isApiError(e, 412, "EXPECTED_VERSION_REQUIRED") || isConflict(e)) {
      return err(
        refusal(
          IDENTITY_VERSION_CONFLICT,
          `Nothing was written to ${inlineOr(identity.name, NO_NAME)} (id: \`${identity.id}\`). Re-read it, reconcile your changes, and retry with that Version — or pass force=true to overwrite the other edit.`,
        ),
      );
    }
    const mapped = mapWriteError(e);
    if (mapped) return mapped;
    throw e;
  }
  const note =
    patch.visibility !== undefined
      ? ` Sharing is now: ${updated.visibility}.`
      : "";
  // The new Version is part of the success, so consecutive edits need no re-read.
  return ok(
    `Updated agent identity ${inlineOr(updated.name, NO_NAME)} (id: \`${updated.id}\`).${note}\nVersion: \`${updated.updatedAt}\` (pass as expected_version to the next op="update")`,
  );
}

/**
 * op="grant": lend one identity to a channel, container or team — one `resource_grants` row, so an edit reaches every grantee.
 * `visibility` says who inside this container may use it; a grant lends it to a scope elsewhere.
 */
export async function opGrantIdentity(
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
  const found = await resolveIdentityOr(client, ref);
  if (isErr(found)) return found;
  const notOwned = notOwnedRefusal(found.createdBy, selfUserId, "agent identity", found.name);
  if (notOwned) return notOwned;
  const scopeId = await resolveGrantScopeId(directory, scope, to);
  if (isGrantRefusal(scopeId)) return scopeId;
  try {
    await client.grantResource({
      resourceType: "agent_identity",
      resourceId: found.id,
      scopeType: scope,
      scopeId,
      level: chosen,
    });
  } catch (e) {
    // The container-kind refusal in this surface's words; everything else rethrows (an outage is not a refusal).
    const refused = channelScopeRefusal(e);
    if (refused) return refused;
    throw e;
  }
  return grantedLine("agent identity", found.name, scope, scopeId, chosen);
}
