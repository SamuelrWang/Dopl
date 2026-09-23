"use strict";
/**
 * `dopl_agent` write ops: create, update, grant.
 * The confirm gate is a tripwire (`confirm-token.ts`); the fence is the server's shared-publish check, fed by `acknowledgeShared`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreate = opCreate;
exports.opUpdate = opUpdate;
exports.opGrantIdentity = opGrantIdentity;
const narration_js_1 = require("./narration.js");
const grant_js_1 = require("./grant.js");
const respond_js_1 = require("./respond.js");
const tool_errors_js_1 = require("./tool-errors.js");
const confirm_token_js_1 = require("./confirm-token.js");
const agent_shared_js_1 = require("./agent-shared.js");
const channel_shared_js_1 = require("./channel-shared.js");
const duplicate_name_js_1 = require("./duplicate-name.js");
const agent_field_types_js_1 = require("./agent-field-types.js");
const container_destination_js_1 = require("./container-destination.js");
/** Agent-facing `{base, folder?, entry?}` → the wire's union; total even for the both-set shape zod already refuses. */
function toKnowledgeScopes(scopes) {
    if (scopes === undefined)
        return undefined;
    return scopes.map((s) => s.folder
        ? { baseId: s.base, scope: "folder", folderId: s.folder }
        : s.entry
            ? { baseId: s.base, scope: "entry", entryId: s.entry }
            : { baseId: s.base, scope: "base" });
}
/** Sorted: a confirm token is bound to this digest, so the preview and the proceed must hash byte-equal. */
function knowledgeDigest(input) {
    const scopes = toKnowledgeScopes(input.knowledge) ?? [];
    return scopes
        .map((s) => s.scope === "folder"
        ? `folder:${s.baseId}/${s.folderId}`
        : s.scope === "entry"
            ? `entry:${s.baseId}/${s.entryId}`
            : `base:${s.baseId}`)
        .sort();
}
const IDENTITY_VERSION_CONFLICT = (0, tool_errors_js_1.versionConflict)('op="get"');
function withStoredTypes(fields, stored) {
    const types = new Map(stored.map((f) => [f.key, f.type]));
    return fields.map((f) => {
        const type = f.type ?? types.get(f.key);
        return type ? { ...f, type } : f;
    });
}
/** One mapper for both verbs, so create and update cannot answer differently; null → rethrow. */
function mapWriteError(e) {
    // Only a race: confirmGate already spent a token, so the room gained a member in between.
    const unacknowledged = (0, confirm_token_js_1.containerPublishUnacknowledged)(e, confirm_token_js_1.RECONFIRM_REMEDY);
    if (unacknowledged)
        return unacknowledged;
    return ((0, container_destination_js_1.homeChannelRowNotShared)(e) ??
        (0, agent_shared_js_1.sharedCredentialPrivateDenied)(e) ??
        (0, agent_shared_js_1.knowledgeBaseNotAttachable)(e) ??
        (0, agent_shared_js_1.identityWriteDenied)(e));
}
/** In a home channel `visibility` defaults to "workspace"; an explicit "private" is refused here, as the server would. */
function homeChannelVisibility(requested) {
    if (requested === "private") {
        return (0, respond_js_1.err)(`Nothing was created. A home channel holds only what is shared into it, so an agent identity cannot be private there. Create it with visibility="workspace" to share it with everyone in this channel, or pass container="home" to keep it to yourself in your home space.`);
    }
    return "workspace";
}
async function opCreate(client, callerUserId, input, 
/** Optional: absent means "not known" and leaves the refusal to the server. */
directory) {
    const badType = (0, agent_field_types_js_1.fieldTypeRefusal)(input.fields);
    if (badType)
        return badType;
    // Visibility is always sent, never the server's credential-dependent default: an omitted one looped the shared-publish preview.
    const inHomeChannel = await (0, container_destination_js_1.resolveHomeChannelContainer)(client, directory);
    const chosen = inHomeChannel
        ? homeChannelVisibility(input.visibility)
        : (input.visibility ?? "private");
    if (typeof chosen !== "string")
        return chosen;
    const visibility = chosen;
    const verdict = await (0, confirm_token_js_1.confirmGate)(client, {
        tool: "dopl_agent",
        op: "create",
        callerUserId,
        what: `an agent identity named ${(0, narration_js_1.inlineOr)(input.name, narration_js_1.NO_NAME)}, shared with the whole home channel`,
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
    }, { publishes: visibility === "workspace", token: input.confirm_token });
    if (verdict.kind === "halt")
        return verdict.response;
    const body = {
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
    }
    catch (e) {
        const mapped = mapWriteError(e);
        if (mapped)
            return mapped;
        throw e;
    }
    // In a home channel `workspace` means the room, not the company.
    const audience = identity.visibility === "private"
        ? "Private to you — only you and your own agents can see it."
        : inHomeChannel
            ? "Shared in this channel — everyone here can list it and launch it."
            : "Shared with everyone in this workspace — every member can list it and launch it.";
    // After the create, so a failing list costs nothing; same-container clashes count (identity names are unique nowhere).
    const dup = await (0, duplicate_name_js_1.duplicateNameNoteFor)(identity, () => client.listAgentIdentities(), "agent identity", true, true);
    return (0, respond_js_1.ok)([
        `Created agent identity ${(0, narration_js_1.inlineOr)(identity.name, narration_js_1.NO_NAME)} (id: \`${identity.id}\`). ${audience}${dup}`,
        `Launch it into a channel with dopl_channel(op="manage", action="launch", channel=…, identity="${identity.id}") — which ASKS the operator's machine and does not start anything by itself.`,
    ].join("\n"));
}
async function opUpdate(client, callerUserId, ref, input) {
    const patch = {
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
        return (0, respond_js_1.err)(`op="update" changed nothing because no field was passed. Pass at least one of: name, description, instructions, model, runtime, fields, visibility, knowledge_bases, knowledge.`);
    }
    const identity = await (0, agent_shared_js_1.resolveIdentityOr)(client, ref);
    if ((0, channel_shared_js_1.isErr)(identity))
        return identity;
    // `fields` is a REPLACE-SET: an omitted `type` keeps the stored twin's by key, never reset to text.
    if (patch.fields) {
        patch.fields = withStoredTypes(patch.fields, identity.fields);
        const badType = (0, agent_field_types_js_1.fieldTypeRefusal)(patch.fields, identity.fields);
        if (badType)
            return badType;
    }
    const verdict = await (0, confirm_token_js_1.confirmGate)(client, {
        tool: "dopl_agent",
        op: "update",
        callerUserId,
        what: `sharing the agent identity ${(0, narration_js_1.inlineOr)(identity.name, narration_js_1.NO_NAME)} (id: \`${identity.id}\`) with the whole home channel`,
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
    }, { publishes: patch.visibility === "workspace", token: input.confirm_token });
    if (verdict.kind === "halt")
        return verdict.response;
    let updated;
    try {
        // Set after the "changed nothing" check: an acknowledgement is not itself a change.
        updated = await client.updateAgentIdentity(identity.id, {
            ...patch,
            acknowledgeShared: verdict.acknowledgedShared || undefined,
        }, 
        // force → null (blind overwrite); undefined is refused by the SDK without a round trip.
        input.force ? null : input.expected_version);
    }
    catch (e) {
        // Both 412s (SDK: no version passed; server: stale version) are one refusal with one remedy.
        if ((0, respond_js_1.isApiError)(e, 412, "EXPECTED_VERSION_REQUIRED") || (0, respond_js_1.isConflict)(e)) {
            return (0, respond_js_1.err)((0, tool_errors_js_1.refusal)(IDENTITY_VERSION_CONFLICT, `Nothing was written to ${(0, narration_js_1.inlineOr)(identity.name, narration_js_1.NO_NAME)} (id: \`${identity.id}\`). Re-read it, reconcile your changes, and retry with that Version — or pass force=true to overwrite the other edit.`));
        }
        const mapped = mapWriteError(e);
        if (mapped)
            return mapped;
        throw e;
    }
    const note = patch.visibility !== undefined
        ? ` Sharing is now: ${updated.visibility}.`
        : "";
    // The new Version is part of the success, so consecutive edits need no re-read.
    return (0, respond_js_1.ok)(`Updated agent identity ${(0, narration_js_1.inlineOr)(updated.name, narration_js_1.NO_NAME)} (id: \`${updated.id}\`).${note}\nVersion: \`${updated.updatedAt}\` (pass as expected_version to the next op="update")`);
}
/**
 * op="grant": lend one identity to a channel, container or team — one `resource_grants` row, so an edit reaches every grantee.
 * `visibility` says who inside this container may use it; a grant lends it to a scope elsewhere.
 */
async function opGrantIdentity(client, directory, selfUserId, ref, scope, to, level) {
    const chosen = (0, grant_js_1.levelForScope)(scope, level);
    if ((0, grant_js_1.isGrantRefusal)(chosen))
        return chosen;
    const found = await (0, agent_shared_js_1.resolveIdentityOr)(client, ref);
    if ((0, channel_shared_js_1.isErr)(found))
        return found;
    const notOwned = (0, grant_js_1.notOwnedRefusal)(found.createdBy, selfUserId, "agent identity", found.name);
    if (notOwned)
        return notOwned;
    const scopeId = await (0, grant_js_1.resolveGrantScopeId)(directory, scope, to);
    if ((0, grant_js_1.isGrantRefusal)(scopeId))
        return scopeId;
    try {
        await client.grantResource({
            resourceType: "agent_identity",
            resourceId: found.id,
            scopeType: scope,
            scopeId,
            level: chosen,
        });
    }
    catch (e) {
        // The container-kind refusal in this surface's words; everything else rethrows (an outage is not a refusal).
        const refused = (0, grant_js_1.channelScopeRefusal)(e);
        if (refused)
            return refused;
        throw e;
    }
    return (0, grant_js_1.grantedLine)("agent identity", found.name, scope, scopeId, chosen);
}
