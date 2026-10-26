"use strict";
/**
 * The `op="task"` lane's fields (and `task` on `op="rooms" action="tasks"`). Caps hand-mirror
 * `src/features/channels/schema-tasks.ts`; the rules are in the pulled `task-doctrine.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TASK_INPUT_FIELDS = exports.SUBTASK_STATES = exports.TASK_STATUSES = void 0;
const zod_1 = require("zod");
/** The route's sets, pinned to `schema-tasks.ts` by `channel-task-contract-pins.test.ts`. */
exports.TASK_STATUSES = ["open", "in_progress", "resolved"];
exports.SUBTASK_STATES = ["todo", "in_progress", "done"];
exports.TASK_INPUT_FIELDS = {
    // No `.uuid()`: zod publishes it as a `pattern`, which `tool-style.test.ts` refuses.
    task: zod_1.z
        .string()
        .optional()
        .describe('The task id: required on op="task" except "create_task"; on op="rooms" action="tasks" it reads one task.'),
    subtask: zod_1.z.string().optional().describe('op="task" action="update_subtask" (required): the subtask id.'),
    title: zod_1.z.string().trim().min(1).max(200).optional().describe('op="task": the task or subtask title.'),
    status: zod_1.z.enum(exports.TASK_STATUSES).optional().describe('op="task" action="set_status" (required).'),
    state: zod_1.z.enum(exports.SUBTASK_STATES).optional().describe('op="task" action="update_subtask".'),
    due: zod_1.z.string().optional().describe('op="task": ISO date-time with offset; "" clears it.'),
    message: zod_1.z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe('op="task" action="create_task": the source message `seq` (or `thread`).'),
};
