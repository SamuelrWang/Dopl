/**
 * THE TASK WRITES, driven through TanStack's own `MutationObserver` so onMutate → mutationFn →
 * onSuccess/onError → onSettled is the real order. What they protect: one POST to the tasks
 * route carrying the action as-is; the expected fields painted into the list row AND the open
 * detail before the network answers; the server's task folded back into both; rollback on a
 * refusal; and the surface's gate held for the write's whole life.
 */

import { describe, expect, it } from "vitest";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { apiQueryKey } from "@/shared/api/query-keys";
import {
  buildApiMutationOptions,
  type ApiMutationRequestFn,
  type MutationGate,
} from "@/shared/hooks/use-api-mutation";
import { makeDetail, makeTask, T0, VIEWER } from "../components/_task-fixtures";
import {
  putTask,
  statusExpectation,
  subtaskExpectation,
  taskWriteConfig,
  type TaskWriteDraft,
} from "./use-task-writes";
import type { ChannelTaskDetail, ChannelTaskPage } from "../types";

const WORKSPACE = "ws-1";
const PATH = "/api/channels/c-1/tasks";
const LIST_KEY = apiQueryKey(PATH, { workspaceId: WORKSPACE });
const DETAIL_KEY = apiQueryKey(PATH, { workspaceId: WORKSPACE, query: { task: "t-1" } });

function deferredRequest() {
  let settle!: (value: unknown) => void;
  let fail!: (error: unknown) => void;
  const pending = new Promise<unknown>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const calls: Array<{ path: string; opts: Record<string, unknown> }> = [];
  const request = ((path: string, opts: Record<string, unknown>) => {
    calls.push({ path, opts });
    return pending;
  }) as unknown as ApiMutationRequestFn;
  return { request, settle, fail, calls };
}

function harness() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData<ChannelTaskPage>(LIST_KEY, {
    tasks: [makeTask(), makeTask({ id: "t-2", title: "Other" })],
    truncated: false,
  });
  client.setQueryData<{ task: ChannelTaskDetail }>(DETAIL_KEY, { task: makeDetail() });
  const gate = { open: 0, begin() { this.open += 1; }, end() { this.open -= 1; } };
  const transport = deferredRequest();
  const observer = new MutationObserver(
    client,
    buildApiMutationOptions(
      client,
      transport.request,
      taskWriteConfig({ workspaceId: WORKSPACE, gate: gate as MutationGate })
    )
  );
  const list = () => client.getQueryData<ChannelTaskPage>(LIST_KEY)!.tasks;
  const detail = () => client.getQueryData<{ task: ChannelTaskDetail }>(DETAIL_KEY)!.task;
  return { client, gate, transport, observer, list, detail };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("task writes", () => {
  it("Resolve posts set_status and paints the row and the detail before the answer", async () => {
    const h = harness();
    const draft: TaskWriteDraft = {
      channelId: "c-1",
      action: { action: "set_status", task: "t-1", status: "resolved" },
      expect: statusExpectation("resolved", VIEWER, T0),
    };
    const done = h.observer.mutate(draft);
    await flush();
    expect(h.transport.calls[0]).toMatchObject({
      path: PATH,
      opts: { method: "POST", workspaceId: WORKSPACE, body: draft.action },
    });
    expect(h.list()[0]).toMatchObject({ status: "resolved", resolvedBy: { kind: "person", userId: VIEWER } });
    expect(h.list()[1].status).toBe("open");
    expect(h.detail().status).toBe("resolved");
    expect(h.gate.open).toBe(1);

    h.transport.settle({ task: makeDetail({ status: "resolved", title: "Server title" }) });
    await done;
    expect(h.list()[0].title).toBe("Server title");
    expect(h.list()[0]).not.toHaveProperty("subtasks");
    expect(h.detail().title).toBe("Server title");
    expect(h.gate.open).toBe(0);
  });

  it("a subtask check moves progress in both arms, and a refusal puts both back", async () => {
    const h = harness();
    const before = h.detail();
    const expectation = subtaskExpectation(before, "s-3", "done", T0);
    const done = h.observer.mutate({
      channelId: "c-1",
      action: { action: "update_subtask", task: "t-1", subtask: "s-3", state: "done" },
      expect: expectation,
    });
    await flush();
    expect(h.detail().subtasks.find((s) => s.id === "s-3")?.state).toBe("done");
    expect(h.detail().progress).toEqual({ done: 2, total: 3 });
    expect(h.list()[0].progress).toEqual({ done: 2, total: 3 });

    h.transport.fail(new Error("403"));
    await done.catch(() => undefined);
    expect(h.detail().progress).toEqual({ done: 1, total: 3 });
    expect(h.list()[0].progress).toBeNull();
    expect(h.gate.open).toBe(0);
  });

  it("subtaskExpectation re-derives who is active off the in-progress owners", () => {
    const next = subtaskExpectation(makeDetail(), "s-2", "done", T0);
    expect(next.active).toEqual([]);
    expect(next.progress).toEqual({ done: 2, total: 3 });
  });

  it("putTask leaves other tasks and a different detail alone", () => {
    const other = { task: makeDetail({ id: "t-9" }) };
    expect(putTask(other, "t-1", { title: "x" })).toBe(other);
    expect(putTask(undefined, "t-1", { title: "x" })).toBeUndefined();
  });
});
