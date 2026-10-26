import { describe, expect, it, vi } from "vitest";
import type { DoplTransport } from "./transport.js";
import { listTasks, readTask, writeTask } from "./channel-tasks.js";

function transport(answer: unknown) {
  const request = vi.fn().mockResolvedValue(answer);
  return { t: { request } as unknown as DoplTransport, request };
}

describe("channel tasks over the transport", () => {
  it("lists, with the status filter in the query", async () => {
    const { t, request } = transport({ tasks: [], truncated: false });
    await listTasks(t, "c 1", { status: "in_progress" });
    expect(request).toHaveBeenCalledWith("/api/channels/c%201/tasks?status=in_progress", {
      toolName: "channel_task_list",
    });
  });

  it("reads one task and unwraps the envelope", async () => {
    const { t, request } = transport({ task: { id: "t-1" } });
    expect(await readTask(t, "c-1", "t-1")).toEqual({ id: "t-1" });
    expect(request).toHaveBeenCalledWith("/api/channels/c-1/tasks?task=t-1", {
      toolName: "channel_task_read",
    });
  });

  it("posts an action to the one route", async () => {
    const { t, request } = transport({ task: { id: "t-1" } });
    const input = { action: "set_status", task: "t-1", status: "resolved" } as const;
    await writeTask(t, "c-1", input);
    expect(request).toHaveBeenCalledWith("/api/channels/c-1/tasks", {
      method: "POST",
      body: input,
      toolName: "channel_task",
    });
  });
});
