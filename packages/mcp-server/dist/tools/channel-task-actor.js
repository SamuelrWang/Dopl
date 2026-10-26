"use strict";
/**
 * Who a task names: `to=` parsed into the route's actor refs, and an actor rendered back as the
 * handle `to=` takes, so a task result always hands a value the next call can pass.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_ASSIGNEE_MAX = void 0;
exports.resolveTaskActors = resolveTaskActors;
exports.resolveTaskActor = resolveTaskActor;
exports.taskMemberView = taskMemberView;
exports.actorHandle = actorHandle;
const call_ref_js_1 = require("../call-ref.js");
const channel_agent_id_1 = require("./channel-agent-id");
const channel_shared_1 = require("./channel-shared");
const channel_render_identity_1 = require("./channel-render-identity");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const PLAIN_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
/** `src/features/channels/constants.ts › CHANNEL_TASK_ASSIGNEE_MAX`, pinned by `channel-task-contract-pins.test.ts`. */
exports.TASK_ASSIGNEE_MAX = 20;
const UNCHANGED = "Nothing was changed — field=to";
function unresolved(raw, channel) {
    return (0, respond_1.err)([
        `${UNCHANGED} reason=unresolved value=${(0, narration_1.inlineOr)(raw, "`(empty)`")}`,
        `A member is \`@<handle>\`, an email or a user id from ${(0, call_ref_js_1.callRef)("channel.rooms.members", { channel: `"${channel}"` })}; an agent is \`@agent-<id>\` from ${(0, call_ref_js_1.callRef)("channel.status", { channel: `"${channel}"` })}.`,
    ].join("\n"));
}
/** One `to=` token. A bare eight-character id is an agent; with `@` it is a member's handle first. */
async function resolveOne(token, roster, channel) {
    if (/^@?agent-/i.test(token)) {
        const agentId = (0, channel_agent_id_1.bareAgentId)(token);
        return (0, channel_agent_id_1.isAgentId)(agentId) ? { kind: "agent", agentId } : unresolved(token, channel);
    }
    if (narration_1.UUID_RE.test(token))
        return { kind: "person", userId: token };
    if (!token.startsWith("@") && (0, channel_agent_id_1.isAgentId)(token))
        return { kind: "agent", agentId: token };
    const isEmail = token.includes("@") && !token.startsWith("@");
    const wanted = token.replace(/^@/, "").toLowerCase();
    const keyOf = (m) => isEmail ? (m.email ?? "").toLowerCase() : (0, channel_render_identity_1.nameSlug)(m.displayName || m.email || "");
    const hits = (await roster()).filter((m) => keyOf(m) === wanted);
    if (hits.length === 1)
        return { kind: "person", userId: hits[0].userId };
    if (hits.length > 1) {
        return (0, respond_1.err)(`${UNCHANGED} reason=ambiguous value=${(0, narration_1.inlineOr)(token, "`(empty)`")}: ${hits.length} members match. Pass that member's user id.`);
    }
    return !isEmail && (0, channel_agent_id_1.isAgentId)(wanted) ? { kind: "agent", agentId: wanted } : unresolved(token, channel);
}
/** Every comma-separated token of `to`, against the channel's roster, read at most once. */
async function resolveTaskActors(client, channelId, channel, to) {
    const tokens = to.split(",").map((t) => t.trim()).filter(Boolean);
    if (tokens.length > exports.TASK_ASSIGNEE_MAX) {
        return (0, respond_1.err)(`${UNCHANGED} reason=too_many count=${tokens.length} max=${exports.TASK_ASSIGNEE_MAX}.`);
    }
    let members = null;
    const roster = () => (members ??= client.listChannelMembers(channelId));
    const refs = [];
    for (const token of tokens) {
        const ref = await resolveOne(token, roster, channel);
        if ((0, channel_shared_1.isErr)(ref))
            return ref;
        refs.push(ref);
    }
    return refs;
}
/** Exactly one actor, for the actions that name one. */
async function resolveTaskActor(client, channelId, channel, to) {
    const refs = await resolveTaskActors(client, channelId, channel, to);
    if ((0, channel_shared_1.isErr)(refs))
        return refs;
    if (refs.length !== 1) {
        return (0, respond_1.err)(`${UNCHANGED} reason=not_one count=${refs.length}: this action names exactly one member or agent.`);
    }
    return refs[0];
}
/** The roster view actor handles render through; read only when a person is shown. */
async function taskMemberView(client, channelId, actors) {
    const needs = actors.some((a) => a.kind === "person");
    return { selfUserId: null, names: needs ? await (0, channel_shared_1.memberNames)(client, channelId) : new Map() };
}
/** An actor as the handle `to=` takes: `@agent-<id>`, a member's unique plain `@handle`, else their user id. */
function actorHandle(actor, view) {
    if (actor === null)
        return "-";
    if (actor.kind === "agent")
        return `@agent-${actor.agentId}`;
    const name = view.names.get(actor.userId);
    if (!name)
        return actor.userId;
    const slug = (0, channel_render_identity_1.nameSlug)(name);
    const unique = [...view.names.values()].filter((n) => (0, channel_render_identity_1.nameSlug)(n) === slug).length === 1;
    return unique && PLAIN_SLUG_RE.test(slug) && !slug.startsWith("agent-") ? `@${slug}` : actor.userId;
}
