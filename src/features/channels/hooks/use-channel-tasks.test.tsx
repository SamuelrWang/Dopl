// @vitest-environment jsdom
/**
 * THE TASKS READS: one path for the list and the `?task=` detail, nothing asked without a
 * channel (the capability's off answer), `truncated` carried through, and a `refetch` that
 * reaches the open detail as well as the list (the tasks doorbell's one call).
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeDetail, makeTask } from "../components/_task-fixtures";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(path: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@/shared/api/api-client", async () => {
  const envelope = await import("@/shared/api/api-envelope");
  return { ...envelope, apiRequest: request };
});

import { useChannelTask, useChannelTasks } from "./use-channel-tasks";

afterEach(() => {
  cleanup();
  request.mockReset();
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const PATH = "/api/channels/c-1/tasks";

describe("the tasks reads", () => {
  it("asks for nothing without a channel", () => {
    const { result } = renderHook(() => useChannelTasks(null, "ws-1"), { wrapper });
    expect(request).not.toHaveBeenCalled();
    expect(result.current.tasks).toEqual([]);
  });

  it("reads the list and its clip flag, and refetch re-reads the open detail too", async () => {
    request.mockImplementation(async (_path, opts) =>
      opts?.query ? { task: makeDetail() } : { tasks: [makeTask()], truncated: true }
    );
    const { result } = renderHook(
      () => ({
        list: useChannelTasks("c-1", "ws-1"),
        detail: useChannelTask("c-1", "t-1", "ws-1"),
      }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.detail.task?.id).toBe("t-1"));
    expect(result.current.list.tasks).toHaveLength(1);
    expect(result.current.list.truncated).toBe(true);
    expect(request.mock.calls.map(([p, o]) => [p, o?.query ?? null])).toEqual(
      expect.arrayContaining([
        [PATH, null],
        [PATH, { task: "t-1" }],
      ])
    );

    request.mockClear();
    act(() => result.current.list.refetch());
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  });
});
