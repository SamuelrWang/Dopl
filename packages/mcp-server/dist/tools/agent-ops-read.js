"use strict";
/** `dopl_agent` read ops: list, get. Non-mutating — they resolve an identity ref and render it. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opGet = opGet;
const call_ref_js_1 = require("../call-ref.js");
const narration_js_1 = require("./narration.js");
const untrusted_fence_1 = require("./untrusted-fence");
const respond_js_1 = require("./respond.js");
const response_size_js_1 = require("./response-size.js");
const agent_shared_js_1 = require("./agent-shared.js");
const channel_shared_js_1 = require("./channel-shared.js");
const container_destination_js_1 = require("./container-destination.js");
/** Headings per offered visibility, workspace only; a home channel uses `DESTINATION_HEADINGS`. */
const VISIBILITY_HEADINGS = {
    private: "Private to you",
    workspace: "Shared with the whole workspace",
};
const OFFERED_VISIBILITIES = new Set(agent_shared_js_1.IDENTITY_VISIBILITY_VALUES);
/** Heading for an unoffered stored visibility (`team`): the row still shows, the axis is not taught. */
const OTHER_HEADING = "Shared";
/** Stale-cache fallback: a payload without `homeScopedIdentityIds` means no container grouping. */
const EMPTY_IDENTITY_IDS = Object.freeze([]);
/** op="list": groups by container first (personal rows via `homeScopedIdentityIds`), visibility second. */
async function opList(client, 
/** Optional: absent means "not known" — falls back to the workspace visibility headings. */
directory) {
    const payload = await client.listAgentIdentitiesPayload();
    const identities = payload.identities;
    if (identities.length === 0) {
        return (0, respond_js_1.ok)(`No agent identities visible to you here. ${agent_shared_js_1.IDENTITIES_SCOPE_NOTE}\n\nCreate one with \`${(0, call_ref_js_1.callRef)("agent.create", {}, { quote: "'" })}\`.`);
    }
    const homeSpaceIds = new Set(payload.homeScopedIdentityIds ?? EMPTY_IDENTITY_IDS);
    const personal = identities.filter((ident) => homeSpaceIds.has(ident.id));
    const here = identities.filter((ident) => !homeSpaceIds.has(ident.id));
    const inHomeChannel = await (0, container_destination_js_1.resolveHomeChannelContainer)(client, directory);
    // Rows with an unoffered visibility (`team`) fall into a trailing bucket — never silently dropped.
    const hereGroups = inHomeChannel
        ? [
            [container_destination_js_1.DESTINATION_HEADINGS.shared, here.filter((ident) => ident.visibility === "workspace")],
            [container_destination_js_1.DESTINATION_HEADINGS.legacy, here.filter((ident) => ident.visibility !== "workspace")],
        ]
        : [
            ...agent_shared_js_1.IDENTITY_VISIBILITY_VALUES.map((v) => [VISIBILITY_HEADINGS[v], here.filter((ident) => ident.visibility === v)]),
            [OTHER_HEADING, here.filter((ident) => !OFFERED_VISIBILITIES.has(ident.visibility))],
        ];
    // The addressed container's rows first, so the heading order does not read as another container's roster.
    const groups = [
        ...hereGroups,
        [container_destination_js_1.DESTINATION_HEADINGS.home, personal],
    ];
    const lines = ["## Agent identities\n"];
    for (const [heading, rows] of groups) {
        if (rows.length === 0)
            continue;
        lines.push(`### ${heading}`);
        for (const ident of rows) {
            const audience = (0, agent_shared_js_1.identityAudience)(ident, {
                personal: homeSpaceIds.has(ident.id),
                inHomeChannel: inHomeChannel !== null,
            });
            lines.push((0, agent_shared_js_1.identityRow)(ident, audience));
        }
        lines.push("");
    }
    lines.push(agent_shared_js_1.IDENTITIES_SCOPE_NOTE);
    return (0, respond_js_1.ok)(lines.join("\n"));
}
async function opGet(client, ref, 
// Only the untrusted framing reads this; visibility is the server's decision.
callerUserId = null, 
/** Clips the INSTRUCTIONS body, and says so. */
maxChars) {
    const identity = await (0, agent_shared_js_1.resolveIdentityOr)(client, ref);
    if ((0, channel_shared_js_1.isErr)(identity))
        return identity;
    const foreign = (0, narration_js_1.isForeignAuthored)(
    // An identity row has no `lastEditedBy` column: the slot is absent, not unknown.
    { createdBy: identity.createdBy, lastEditedBy: null }, callerUserId);
    const lines = [
        `# ${(0, narration_js_1.inlineOr)(identity.name, narration_js_1.NO_NAME)}`,
        `id: \`${identity.id}\` · ${identity.visibility} · runtime ${identity.runtime ? (0, narration_js_1.inlineOr)(identity.runtime, narration_js_1.NO_NAME) : "(the channel's)"} · model ${identity.model ? (0, narration_js_1.inlineOr)(identity.model, narration_js_1.NO_NAME) : "(the runtime's default)"}`,
        // The version is printed on the header rows, so a clipped instructions body cannot hide it.
        `Version: \`${identity.updatedAt}\` (pass as expected_version to ${(0, call_ref_js_1.callRef)("agent.update", {}, { form: "op" })})`,
        ...(identity.description ? [(0, narration_js_1.inlineOr)(identity.description, "")] : []),
    ];
    const scopes = (0, agent_shared_js_1.identityScopes)(identity);
    if (scopes.length > 0) {
        lines.push("", "## Attached knowledge");
        for (const scope of scopes) {
            // One line per scope with its path: the path is what tells two folders of one base apart.
            const what = scope.scope === "folder"
                ? " (folder, and everything under it)"
                : scope.scope === "entry"
                    ? " (one entry)"
                    : "";
            lines.push(`- ${(0, narration_js_1.inlineOr)(scope.path || scope.baseName, narration_js_1.NO_NAME)}${what} (base: \`${scope.baseId}\`)`);
        }
        lines.push("", `_Only the knowledge YOU can see is listed. At launch the operator's own machine resolves this list again under THEIR visibility, so a base you can read and they cannot is simply omitted there._`);
    }
    if (identity.fields.length > 0) {
        lines.push("", "## Custom fields");
        for (const f of identity.fields) {
            // The type is shown only when it is not the default, so a text-only identity reads as before.
            const typed = f.type && f.type !== "text" ? ` (${f.type})` : "";
            lines.push(`- ${(0, narration_js_1.inlineOr)(f.key, narration_js_1.NO_NAME)}${typed}: ${(0, narration_js_1.inlineOr)(f.value, "`(empty)`")}`);
        }
    }
    lines.push("", "## Instructions");
    lines.push("", "---", "");
    // Somebody else's instructions are fenced (per-response close tag); the caller's own render bare.
    // Clip the instructions BEFORE fencing, never after: clipping a fenced block would cut its close tag.
    const whole = identity.instructions ?? "_No instructions set._";
    const { body: instructions, notice } = (0, response_size_js_1.clipToMaxChars)(whole, maxChars);
    lines.push(...(foreign && identity.instructions
        ? (0, untrusted_fence_1.fenceBody)(instructions, "agent instructions by another member")
        : [instructions]));
    // Outside the fence, so the notice is visibly this server's.
    if (notice)
        lines.push("", notice);
    return (0, respond_js_1.ok)(lines.join("\n"));
}
