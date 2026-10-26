/**
 * `dopl://doctrine/tasks` — how tasks work, PULLED (`dopl_get_guide(topic="tasks")`). The pushed half
 * is `dopl_manage_task`'s description and its param lines.
 */

import { callRef } from "../call-ref.js";

export const TASKS_DOCTRINE_URI = "dopl://doctrine/tasks";

export const tasksDoctrine = (): string =>
  [
    "TASKS: work a channel has taken on, tracked until the people and agents on it agree it is finished.",
    "",
    `CREATE: ${callRef("channel.task.create_task", { channel: '"<channel>"', title: '"..."' })}. Optional: description, due, to= assignees, and the thread (thread=) or message (message=<seq>) it came from, never both. The result hands back task=<id>; every later call names it.`,
    `ASSIGN: ${callRef("channel.task.assign", { task: '"<id>"', to: '"@agent-<id>"' })} names one member or agent per call; an assigned agent is sent an addressed message, so it wakes. "unassign" takes one off.`,
    'WORK: split it with "add_subtask" (title, optional owner in to=), move each with "update_subtask" (state todo | in_progress | done, owner, title), and "add_note" as the work moves: what was tried, what changed, what is left. Notes are append-only and every member reads them.',
    'STATUS: "set_status" with status="in_progress" when someone is on it, "resolved" once the people and agents on it agree it is done, "open" to bring a resolved task back.',
    `READ: ${callRef("channel.rooms.tasks", { channel: '"<channel>"' })} lists them; add task=<id> for subtasks, notes and assignees.`,
    "WHO: to= takes a member's @handle, email or user id, or @agent-<id>; several, comma-separated, on create. Guests read tasks and add notes, nothing else.",
    "No delete: a task that should not exist is resolved.",
  ].join("\n");
