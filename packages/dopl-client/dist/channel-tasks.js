"use strict";
/** Channel tasks over `/api/channels/[channelId]/tasks`. There is no delete; status moves through `set_status`. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listTasks = listTasks;
exports.readTask = readTask;
exports.writeTask = writeTask;
const enc = encodeURIComponent;
/** ⚠ `truncated` says the page hit the server's ceiling; never drop it. */
async function listTasks(t, channelId, opts = {}) {
    const qs = opts.status ? `?status=${enc(opts.status)}` : "";
    return t.request(`/api/channels/${enc(channelId)}/tasks${qs}`, {
        toolName: "channel_task_list",
    });
}
async function readTask(t, channelId, taskId) {
    const data = await t.request(`/api/channels/${enc(channelId)}/tasks?task=${enc(taskId)}`, { toolName: "channel_task_read" });
    return data.task;
}
/** Every action answers the task as it now stands. */
async function writeTask(t, channelId, input) {
    return t.request(`/api/channels/${enc(channelId)}/tasks`, {
        method: "POST",
        body: input,
        toolName: "channel_task",
    });
}
