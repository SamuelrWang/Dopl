/**
 * The `op="task"` lane's fields (and `task` on `op="rooms" action="tasks"`). Caps hand-mirror
 * `src/features/channels/schema-tasks.ts`; the rules are in the pulled `task-doctrine.ts`.
 */
import { z } from "zod";
export declare const TASK_INPUT_FIELDS: {
    task: z.ZodOptional<z.ZodString>;
    subtask: z.ZodOptional<z.ZodString>;
    title: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        open: "open";
        in_progress: "in_progress";
        resolved: "resolved";
    }>>;
    state: z.ZodOptional<z.ZodEnum<{
        done: "done";
        in_progress: "in_progress";
        todo: "todo";
    }>>;
    due: z.ZodOptional<z.ZodString>;
    message: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
};
