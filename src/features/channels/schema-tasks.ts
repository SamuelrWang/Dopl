import { z } from "zod";
import { closedEnum } from "@/shared/lib/closed-enum";
import { safeLabel, safeOptionalProse } from "@/shared/lib/safe-label";
import { CHANNEL_TASK_ASSIGNEE_MAX } from "./constants";
import type { SubtaskState, TaskStatus } from "./types";

/** `POST /api/channels/[channelId]/tasks`. Bounds mirror the CHECKs in `20261121190000_channel_tasks.sql`. */

const AGENT_ID_RE = /^[a-z][a-z0-9]{7}$/;

const TaskStatusSchema = closedEnum<TaskStatus>()(["open", "in_progress", "resolved"]);
const SubtaskStateSchema = closedEnum<SubtaskState>()(["todo", "in_progress", "done"]);

const TaskActorRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), userId: z.string().uuid() }),
  z.object({
    kind: z.literal("agent"),
    agentId: z.string().trim().toLowerCase().regex(AGENT_ID_RE, "Invalid agent id"),
  }),
]);
export type TaskActorRefInput = z.infer<typeof TaskActorRefSchema>;

const TitleSchema = safeLabel("Task title", 200);
const DescriptionSchema = safeOptionalProse("Task description", 4000);
const SubtaskTitleSchema = safeLabel("Subtask title", 200);
const SubtaskDetailSchema = safeLabel("Subtask detail", 300);
const NoteBodySchema = safeOptionalProse("Note", 4000).refine((v) => v.length > 0, {
  message: "Note cannot be empty",
});
const DueAtSchema = z.string().datetime({ offset: true }).nullable();
const ClientMsgIdSchema = z.string().trim().min(1).max(200);
const TaskIdSchema = z.string().uuid();

const atLeastOne =
  (fields: readonly string[]) =>
  (input: Record<string, unknown>): boolean =>
    fields.some((f) => input[f] !== undefined);

/** `GET …/tasks`: one task by `?task=`, else the list, optionally by `?status=`. */
export const TaskQuerySchema = z.object({
  task: TaskIdSchema.optional(),
  status: TaskStatusSchema.optional(),
});

export const TaskActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("create"),
      title: TitleSchema,
      description: DescriptionSchema.optional(),
      assignees: z.array(TaskActorRefSchema).max(CHANNEL_TASK_ASSIGNEE_MAX).optional(),
      thread: z.string().uuid().optional(),
      message: z.coerce.number().int().positive().optional(),
      dueAt: DueAtSchema.optional(),
      clientMsgId: ClientMsgIdSchema.optional(),
    })
    .refine((v) => v.thread === undefined || v.message === undefined, {
      message: "Link a thread or a message, not both",
    }),
  z
    .object({
      action: z.literal("update"),
      task: TaskIdSchema,
      title: TitleSchema.optional(),
      description: DescriptionSchema.optional(),
      dueAt: DueAtSchema.optional(),
    })
    .refine(atLeastOne(["title", "description", "dueAt"]), {
      message: "Name a field to update",
    }),
  z.object({ action: z.literal("set_status"), task: TaskIdSchema, status: TaskStatusSchema }),
  z.object({ action: z.literal("assign"), task: TaskIdSchema, assignee: TaskActorRefSchema }),
  z.object({ action: z.literal("unassign"), task: TaskIdSchema, assignee: TaskActorRefSchema }),
  z.object({
    action: z.literal("add_subtask"),
    task: TaskIdSchema,
    title: SubtaskTitleSchema,
    detail: SubtaskDetailSchema.optional(),
    owner: TaskActorRefSchema.optional(),
    clientMsgId: ClientMsgIdSchema.optional(),
  }),
  z
    .object({
      action: z.literal("update_subtask"),
      task: TaskIdSchema,
      subtask: z.string().uuid(),
      title: SubtaskTitleSchema.optional(),
      detail: SubtaskDetailSchema.nullable().optional(),
      owner: TaskActorRefSchema.optional(),
      state: SubtaskStateSchema.optional(),
    })
    .refine(atLeastOne(["title", "detail", "owner", "state"]), {
      message: "Name a field to update",
    }),
  z.object({
    action: z.literal("add_note"),
    task: TaskIdSchema,
    body: NoteBodySchema,
    clientMsgId: ClientMsgIdSchema.optional(),
  }),
]);
export type TaskActionInput = z.infer<typeof TaskActionSchema>;
export type TaskActionOf<A extends TaskActionInput["action"]> = Extract<TaskActionInput, { action: A }>;
