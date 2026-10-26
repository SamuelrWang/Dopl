/**
 * `op="task"` — create, edit, assign, split, note and resolve a channel task, one POST each to
 * `/api/channels/[channelId]/tasks`. Every action answers the task as it now stands, so one renderer
 * covers all eight. There is no delete: a task that should not exist is resolved.
 */

import { callRef } from "../call-ref.js";
import type { ChannelTaskAction, ChannelTaskDetail, DoplClient, TaskActor } from "@dopl/client";
import type { z, ZodObject } from "zod";
import { FACT_VALUE_MAX, factsLine, type FactValue } from "./channel-facts";
import { isForbidden } from "./channel-errors";
import { isErr, resolveChannelOr } from "./channel-shared";
import type { CHANNEL_INPUT_SHAPE } from "./channel-schema";
import { CHANNEL_ACTIONS, type TaskAction } from "./channel-vocab";
import { actorHandle, resolveTaskActor, resolveTaskActors, taskMemberView } from "./channel-task-actor";
import { inlineOr, UUID_RE } from "./narration";
import { apiErrorCode, apiMessage, err, missingParams, ok, strictParams, type ToolResponse } from "./respond";
import type { MemberView } from "./channel-render-identity";

/** `description` is carried by the granular tool past the legacy schema, as on the room tools. */
export type TaskArgs = z.infer<ZodObject<typeof CHANNEL_INPUT_SHAPE>> & { description?: string };

export function isTaskAction(action: string): action is TaskAction {
  return (CHANNEL_ACTIONS.task as readonly string[]).includes(action);
}

const label = (action: TaskAction) => `task action="${action}"`;
const UNCHANGED = "Nothing was changed";

const listCall = (channel: string) => callRef("channel.rooms.tasks", { channel: `"${channel}"` });

/** A task id that is not a uuid is refused here; the route would 400 without naming the field. */
export function taskIdRefusal(task: string | undefined, channel: string, lead: string): ToolResponse | null {
  if (task === undefined || UUID_RE.test(task)) return null;
  return err(`${lead} — field=task reason=not_a_task_id retry=${listCall(channel)}`);
}

/** The route's task error codes, each with the call that recovers; null for anything else. */
export function taskRefusal(e: unknown, channel: string, task: string | undefined, lead: string): ToolResponse | null {
  const said = inlineOr(apiMessage(e), "`(no detail)`");
  switch (apiErrorCode(e)) {
    case "TASK_NOT_FOUND":
      return err(`${lead} — reason=task_not_found retry=${listCall(channel)}`);
    case "SUBTASK_NOT_FOUND":
      return err(
        `${lead} — reason=subtask_not_found retry=${callRef("channel.rooms.tasks", { channel: `"${channel}"`, task: `"${task ?? "<id>"}"` })}`,
      );
    case "TASK_ACTOR_UNRESOLVED":
      return err(
        `${lead} — reason=not_in_channel ${said}. A member must be in this channel and an agent live in it: ${callRef("channel.rooms.members", { channel: `"${channel}"` })} / ${callRef("channel.status", { channel: `"${channel}"` })}.`,
      );
    case "TASK_LINK_UNRESOLVED":
      return err(
        `${lead} — reason=link_not_found ${said}. Pick a thread from ${callRef("channel.rooms.threads", { channel: `"${channel}"` })}, or a message seq from a read.`,
      );
    case "TASK_LIMIT_REACHED":
      return err(`${lead} — reason=limit ${said}.`);
  }
  if (isForbidden(e)) {
    return err(
      `${lead} — reason=forbidden ${said}. A guest reads tasks and adds notes only; an agent assigns only its own operator's agents.`,
    );
  }
  return null;
}

const dueOf = (due: string | undefined): string | null | undefined =>
  due === undefined ? undefined : due === "" ? null : due;

function noField(action: TaskAction, fields: string[]): ToolResponse {
  return err(`${UNCHANGED} — ${label(action)} needs one of: ${fields.join(", ")}.`);
}

/** The route's per-action body from the flat published args, or the refusal. */
async function toAction(
  action: TaskAction,
  args: TaskArgs,
  client: DoplClient,
  channelId: string,
): Promise<ChannelTaskAction | ToolResponse> {
  const channel = args.channel as string;
  const task = args.task as string;
  switch (action) {
    case "create_task": {
      const bad = strictParams(label(action), args, ["channel", "title"], ["description", "due", "to", "thread", "message", "client_msg_id"]);
      if (bad) return bad;
      if (args.thread !== undefined && args.message !== undefined) {
        return err(`${UNCHANGED} — a task links a \`thread\` or a \`message\`, not both.`);
      }
      const assignees = args.to === undefined ? undefined : await resolveTaskActors(client, channelId, channel, args.to);
      if (assignees !== undefined && isErr(assignees)) return assignees;
      return {
        action: "create",
        title: args.title as string,
        description: args.description,
        assignees,
        thread: args.thread,
        message: args.message,
        dueAt: dueOf(args.due),
        clientMsgId: args.client_msg_id,
      };
    }
    case "update_task": {
      const bad = strictParams(label(action), args, ["channel", "task"], ["title", "description", "due"]);
      if (bad) return bad;
      if (args.title === undefined && args.description === undefined && args.due === undefined) {
        return noField(action, ["title", "description", "due"]);
      }
      return { action: "update", task, title: args.title, description: args.description, dueAt: dueOf(args.due) };
    }
    case "set_status": {
      const bad = strictParams(label(action), args, ["channel", "task", "status"]);
      if (bad) return bad;
      return { action, task, status: args.status! };
    }
    case "assign":
    case "unassign": {
      const bad = strictParams(label(action), args, ["channel", "task", "to"]);
      if (bad) return bad;
      const assignee = await resolveTaskActor(client, channelId, channel, args.to as string);
      if (isErr(assignee)) return assignee;
      return { action, task, assignee };
    }
    case "add_subtask": {
      const bad = strictParams(label(action), args, ["channel", "task", "title"], ["to", "client_msg_id"]);
      if (bad) return bad;
      const owner = args.to === undefined ? undefined : await resolveTaskActor(client, channelId, channel, args.to);
      if (owner !== undefined && isErr(owner)) return owner;
      return { action, task, title: args.title as string, owner, clientMsgId: args.client_msg_id };
    }
    case "update_subtask": {
      const bad = strictParams(label(action), args, ["channel", "task", "subtask"], ["title", "to", "state"]);
      if (bad) return bad;
      if (args.title === undefined && args.to === undefined && args.state === undefined) {
        return noField(action, ["title", "to", "state"]);
      }
      const owner = args.to === undefined ? undefined : await resolveTaskActor(client, channelId, channel, args.to);
      if (owner !== undefined && isErr(owner)) return owner;
      return { action, task, subtask: args.subtask as string, title: args.title, owner, state: args.state };
    }
    case "add_note": {
      const bad = strictParams(label(action), args, ["channel", "task", "body"], ["client_msg_id"]);
      if (bad) return bad;
      return { action, task, body: args.body as string, clientMsgId: args.client_msg_id };
    }
  }
}

const HEADS: Readonly<Record<TaskAction, string>> = {
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
function subtaskOf(action: TaskAction, task: ChannelTaskDetail, args: TaskArgs): string | undefined {
  if (action === "update_subtask") return args.subtask;
  if (action !== "add_subtask") return undefined;
  const named = task.subtasks.filter((s) => s.title === args.title?.trim());
  const pool = named.length > 0 ? named : task.subtasks;
  return pool.reduce<(typeof pool)[number] | undefined>((a, s) => (!a || s.createdAt > a.createdAt ? s : a), undefined)?.id;
}

/** The handles joined when they fit one fact, else how many there are. */
export function assigneesFact(actors: TaskActor[], view: MemberView): string {
  const joined = actors.map((a) => actorHandle(a, view)).join(",");
  return joined.length <= FACT_VALUE_MAX ? joined || "-" : `${actors.length}`;
}

function resultLine(action: TaskAction, task: ChannelTaskDetail, view: MemberView, args: TaskArgs): string {
  const facts: Record<string, FactValue> = { task: task.id };
  const subtask = subtaskOf(action, task, args);
  if (subtask) facts.subtask = subtask;
  facts.status = task.status;
  facts.assignees = assigneesFact(task.assignees, view);
  facts.subtasks = task.progress ? `${task.progress.done}/${task.progress.total}` : 0;
  if (action === "add_note") facts.notes = task.notes.length;
  return factsLine(HEADS[action], facts);
}

export async function dispatchTaskAction(
  action: TaskAction,
  args: TaskArgs,
  client: DoplClient,
): Promise<ToolResponse> {
  const miss = missingParams(label(action), args, ["channel"]);
  if (miss) return miss;
  const ref = args.channel as string;
  const badId = taskIdRefusal(args.task, ref, UNCHANGED);
  if (badId) return badId;

  const channel = await resolveChannelOr(client, ref);
  if (isErr(channel)) return channel;

  const built = await toAction(action, args, client, channel.id);
  if (isErr(built)) return built;

  let task: ChannelTaskDetail;
  try {
    ({ task } = await client.writeChannelTask(channel.id, built));
  } catch (e) {
    const refused = taskRefusal(e, ref, args.task, UNCHANGED);
    if (refused) return refused;
    throw e;
  }
  const view = await taskMemberView(client, channel.id, task.assignees);
  return ok(resultLine(action, task, view, args));
}
