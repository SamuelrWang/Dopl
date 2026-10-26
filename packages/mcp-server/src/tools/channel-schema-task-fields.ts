/**
 * The `op="task"` lane's fields (and `task` on `op="rooms" action="tasks"`). Caps hand-mirror
 * `src/features/channels/schema-tasks.ts`; the rules are in the pulled `task-doctrine.ts`.
 */

import { z } from "zod";

export const TASK_INPUT_FIELDS = {
  // No `.uuid()`: zod publishes it as a `pattern`, which `tool-style.test.ts` refuses.
  task: z
    .string()
    .optional()
    .describe('The task id: required on op="task" except "create_task"; on op="rooms" action="tasks" it reads one task.'),

  subtask: z.string().optional().describe('op="task" action="update_subtask" (required): the subtask id.'),

  title: z.string().trim().min(1).max(200).optional().describe('op="task": the task or subtask title.'),

  status: z.enum(["open", "in_progress", "resolved"]).optional().describe('op="task" action="set_status" (required).'),

  state: z.enum(["todo", "in_progress", "done"]).optional().describe('op="task" action="update_subtask".'),

  due: z.string().optional().describe('op="task": ISO date-time with offset; "" clears it.'),

  message: z.coerce
    .number()
    .int()
    .positive()
    .optional()
    .describe('op="task" action="create_task": the source message `seq` (or `thread`).'),
};
