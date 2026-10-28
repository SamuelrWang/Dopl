import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { ChannelTaskAction } from "./types";
import { TaskActionSchema, TaskQuerySchema } from "./schema-tasks";

const TASK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("TaskActionSchema", () => {
  it("accepts every action the contracts type describes", () => {
    expectTypeOf<ChannelTaskAction>().toExtend<z.input<typeof TaskActionSchema>>();
  });

  it("has no reopen action: status moves through set_status (R5)", () => {
    expect(TaskActionSchema.safeParse({ action: "reopen", task: TASK }).success).toBe(false);
    expect(
      TaskActionSchema.safeParse({ action: "set_status", task: TASK, status: "open" }).success
    ).toBe(true);
  });

  it("refuses a create linked to a thread and a message at once", () => {
    const parsed = TaskActionSchema.safeParse({
      action: "create",
      title: "x",
      thread: TASK,
      message: 4,
    });
    expect(parsed.success).toBe(false);
  });

  it("refuses an update that names no field", () => {
    expect(TaskActionSchema.safeParse({ action: "update", task: TASK }).success).toBe(false);
    expect(
      TaskActionSchema.safeParse({ action: "update_subtask", task: TASK, subtask: TASK }).success
    ).toBe(false);
  });

  it("refuses control characters in a title and an empty note", () => {
    expect(TaskActionSchema.safeParse({ action: "create", title: "a\u0000b" }).success).toBe(false);
    expect(
      TaskActionSchema.safeParse({ action: "add_note", task: TASK, body: "   " }).success
    ).toBe(false);
  });

  it("normalizes an agent id and refuses one off the charset", () => {
    const parsed = TaskActionSchema.parse({
      action: "assign",
      task: TASK,
      assignee: { kind: "agent", agentId: " DEYNELZ3 " },
    });
    expect(parsed).toMatchObject({ assignee: { agentId: "deynelz3" } });
    expect(
      TaskActionSchema.safeParse({
        action: "assign",
        task: TASK,
        assignee: { kind: "agent", agentId: "chan-1234" },
      }).success
    ).toBe(false);
  });
});

describe("TaskQuerySchema", () => {
  it("refuses a malformed task id rather than letting it reach a uuid cast", () => {
    expect(TaskQuerySchema.safeParse({ task: "nope" }).success).toBe(false);
    expect(TaskQuerySchema.safeParse({ status: "closed" }).success).toBe(false);
  });
});
