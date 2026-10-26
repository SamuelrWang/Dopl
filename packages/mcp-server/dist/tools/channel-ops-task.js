"use strict";
/**
 * `op="task"` — create, edit, assign, split, note and resolve a channel task, one POST each to
 * `/api/channels/[channelId]/tasks`. Every action answers the task as it now stands, so one renderer
 * covers all eight. There is no delete: a task that should not exist is resolved.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTaskAction = isTaskAction;
exports.taskIdRefusal = taskIdRefusal;
exports.taskRefusal = taskRefusal;
exports.assigneesFact = assigneesFact;
exports.dispatchTaskAction = dispatchTaskAction;
const call_ref_js_1 = require("../call-ref.js");
const channel_facts_1 = require("./channel-facts");
const channel_errors_1 = require("./channel-errors");
const channel_shared_1 = require("./channel-shared");
const channel_vocab_1 = require("./channel-vocab");
const channel_task_actor_1 = require("./channel-task-actor");
const narration_1 = require("./narration");
const respond_1 = require("./respond");
function isTaskAction(action) {
    return channel_vocab_1.CHANNEL_ACTIONS.task.includes(action);
}
const label = (action) => `task action="${action}"`;
const UNCHANGED = "Nothing was changed";
const listCall = (channel) => (0, call_ref_js_1.callRef)("channel.rooms.tasks", { channel: `"${channel}"` });
/** A task id that is not a uuid is refused here; the route would 400 without naming the field. */
function taskIdRefusal(task, channel, lead) {
    if (task === undefined || narration_1.UUID_RE.test(task))
        return null;
    return (0, respond_1.err)(`${lead} — field=task reason=not_a_task_id retry=${listCall(channel)}`);
}
/** The route's task error codes, each with the call that recovers; null for anything else. */
function taskRefusal(e, channel, task, lead) {
    const said = (0, narration_1.inlineOr)((0, respond_1.apiMessage)(e), "`(no detail)`");
    switch ((0, respond_1.apiErrorCode)(e)) {
        case "TASK_NOT_FOUND":
            return (0, respond_1.err)(`${lead} — reason=task_not_found retry=${listCall(channel)}`);
        case "SUBTASK_NOT_FOUND":
            return (0, respond_1.err)(`${lead} — reason=subtask_not_found retry=${(0, call_ref_js_1.callRef)("channel.rooms.tasks", { channel: `"${channel}"`, task: `"${task ?? "<id>"}"` })}`);
        case "TASK_ACTOR_UNRESOLVED":
            return (0, respond_1.err)(`${lead} — reason=not_in_channel ${said}. A member must be in this channel and an agent live in it: ${(0, call_ref_js_1.callRef)("channel.rooms.members", { channel: `"${channel}"` })} / ${(0, call_ref_js_1.callRef)("channel.status", { channel: `"${channel}"` })}.`);
        case "TASK_LINK_UNRESOLVED":
            return (0, respond_1.err)(`${lead} — reason=link_not_found ${said}. Pick a thread from ${(0, call_ref_js_1.callRef)("channel.rooms.threads", { channel: `"${channel}"` })}, or a message seq from a read.`);
        case "TASK_LIMIT_REACHED":
            return (0, respond_1.err)(`${lead} — reason=limit ${said}.`);
    }
    if ((0, channel_errors_1.isForbidden)(e)) {
        return (0, respond_1.err)(`${lead} — reason=forbidden ${said}. A guest reads tasks and adds notes only; an agent assigns only its own operator's agents.`);
    }
    return null;
}
const dueOf = (due) => due === undefined ? undefined : due === "" ? null : due;
function noField(action, fields) {
    return (0, respond_1.err)(`${UNCHANGED} — ${label(action)} needs one of: ${fields.join(", ")}.`);
}
/** The route's per-action body from the flat published args, or the refusal. */
async function toAction(action, args, client, channelId) {
    const channel = args.channel;
    const task = args.task;
    switch (action) {
        case "create_task": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "title"], ["description", "due", "to", "thread", "message", "client_msg_id"]);
            if (bad)
                return bad;
            if (args.thread !== undefined && args.message !== undefined) {
                return (0, respond_1.err)(`${UNCHANGED} — a task links a \`thread\` or a \`message\`, not both.`);
            }
            const assignees = args.to === undefined ? undefined : await (0, channel_task_actor_1.resolveTaskActors)(client, channelId, channel, args.to);
            if (assignees !== undefined && (0, channel_shared_1.isErr)(assignees))
                return assignees;
            return {
                action: "create",
                title: args.title,
                description: args.description,
                assignees,
                thread: args.thread,
                message: args.message,
                dueAt: dueOf(args.due),
                clientMsgId: args.client_msg_id,
            };
        }
        case "update_task": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "task"], ["title", "description", "due"]);
            if (bad)
                return bad;
            if (args.title === undefined && args.description === undefined && args.due === undefined) {
                return noField(action, ["title", "description", "due"]);
            }
            return { action: "update", task, title: args.title, description: args.description, dueAt: dueOf(args.due) };
        }
        case "set_status": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "task", "status"]);
            if (bad)
                return bad;
            return { action, task, status: args.status };
        }
        case "assign":
        case "unassign": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "task", "to"]);
            if (bad)
                return bad;
            const assignee = await (0, channel_task_actor_1.resolveTaskActor)(client, channelId, channel, args.to);
            if ((0, channel_shared_1.isErr)(assignee))
                return assignee;
            return { action, task, assignee };
        }
        case "add_subtask": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "task", "title"], ["to", "client_msg_id"]);
            if (bad)
                return bad;
            const owner = args.to === undefined ? undefined : await (0, channel_task_actor_1.resolveTaskActor)(client, channelId, channel, args.to);
            if (owner !== undefined && (0, channel_shared_1.isErr)(owner))
                return owner;
            return { action, task, title: args.title, owner, clientMsgId: args.client_msg_id };
        }
        case "update_subtask": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "task", "subtask"], ["title", "to", "state"]);
            if (bad)
                return bad;
            if (args.title === undefined && args.to === undefined && args.state === undefined) {
                return noField(action, ["title", "to", "state"]);
            }
            const owner = args.to === undefined ? undefined : await (0, channel_task_actor_1.resolveTaskActor)(client, channelId, channel, args.to);
            if (owner !== undefined && (0, channel_shared_1.isErr)(owner))
                return owner;
            return { action, task, subtask: args.subtask, title: args.title, owner, state: args.state };
        }
        case "add_note": {
            const bad = (0, respond_1.strictParams)(label(action), args, ["channel", "task", "body"], ["client_msg_id"]);
            if (bad)
                return bad;
            return { action, task, body: args.body, clientMsgId: args.client_msg_id };
        }
    }
}
const HEADS = {
    create_task: "task created",
    update_task: "task updated",
    set_status: "status set",
    assign: "assigned",
    unassign: "unassigned",
    add_subtask: "subtask added",
    update_subtask: "subtask updated",
    add_note: "note added",
};
/** The subtask this call made or moved: an added one is the newest with its title. */
function subtaskOf(action, task, args) {
    if (action === "update_subtask")
        return args.subtask;
    if (action !== "add_subtask")
        return undefined;
    const named = task.subtasks.filter((s) => s.title === args.title?.trim());
    const pool = named.length > 0 ? named : task.subtasks;
    return pool.reduce((a, s) => (!a || s.createdAt > a.createdAt ? s : a), undefined)?.id;
}
/** The handles joined when they fit one fact, else how many there are. */
function assigneesFact(actors, view) {
    const joined = actors.map((a) => (0, channel_task_actor_1.actorHandle)(a, view)).join(",");
    return joined.length <= channel_facts_1.FACT_VALUE_MAX ? joined || "-" : `${actors.length}`;
}
function resultLine(action, task, view, args) {
    const facts = { task: task.id };
    const subtask = subtaskOf(action, task, args);
    if (subtask)
        facts.subtask = subtask;
    facts.status = task.status;
    facts.assignees = assigneesFact(task.assignees, view);
    facts.subtasks = task.progress ? `${task.progress.done}/${task.progress.total}` : 0;
    if (action === "add_note")
        facts.notes = task.notes.length;
    return (0, channel_facts_1.factsLine)(HEADS[action], facts);
}
async function dispatchTaskAction(action, args, client) {
    const miss = (0, respond_1.missingParams)(label(action), args, ["channel"]);
    if (miss)
        return miss;
    const ref = args.channel;
    const badId = taskIdRefusal(args.task, ref, UNCHANGED);
    if (badId)
        return badId;
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, ref);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    const built = await toAction(action, args, client, channel.id);
    if ((0, channel_shared_1.isErr)(built))
        return built;
    let task;
    try {
        ({ task } = await client.writeChannelTask(channel.id, built));
    }
    catch (e) {
        const refused = taskRefusal(e, ref, args.task, UNCHANGED);
        if (refused)
            return refused;
        throw e;
    }
    const view = await (0, channel_task_actor_1.taskMemberView)(client, channel.id, task.assignees);
    return (0, respond_1.ok)(resultLine(action, task, view, args));
}
