/** TEST FIXTURE: one channel, its roster and a task, for the `op="task"` suites. */

import { vi } from "vitest";
import type { ChannelTaskDetail, DoplClient } from "@dopl/client";

export const CHANNEL = { id: "c0ffee00-0000-4000-8000-000000000001", slug: "general", name: "General" };
export const TASK_ID = "7a5c0000-0000-4000-8000-0000000000a1";
export const SUBTASK_ID = "5b000000-0000-4000-8000-0000000000b1";
export const SAM = "11111111-0000-4000-8000-000000000001";
export const ANA = "22222222-0000-4000-8000-000000000002";

const MEMBERS = [
  { channelId: CHANNEL.id, userId: SAM, role: "owner", displayName: "Samuel Wang", email: "sam@example.com" },
  { channelId: CHANNEL.id, userId: ANA, role: "member", displayName: "Ana", email: "ana@example.com" },
];

export function taskDetail(over: Partial<ChannelTaskDetail> = {}): ChannelTaskDetail {
  return {
    id: TASK_ID,
    channelId: CHANNEL.id,
    workspaceId: "ws-1",
    title: "Ship the migration",
    description: "",
    status: "open",
    createdBy: { kind: "person", userId: SAM },
    assignees: [],
    link: null,
    dueAt: null,
    progress: null,
    active: [],
    createdAt: "2026-10-26T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    subtasks: [],
    notes: [],
    notesTruncated: false,
    ...over,
  };
}

/** A client that resolves the channel and roster and answers every task write with `task`. */
export function taskClient(task: ChannelTaskDetail = taskDetail(), overrides: Record<string, unknown> = {}) {
  const writeChannelTask = vi.fn<(channelId: string, input: Record<string, unknown>) => Promise<{ task: ChannelTaskDetail }>>(
    async () => ({ task }),
  );
  const client = {
    listChannels: vi.fn(async () => [CHANNEL]),
    listChannelMembers: vi.fn(async () => MEMBERS),
    writeChannelTask,
    ...overrides,
  } as unknown as DoplClient;
  return { client, writeChannelTask };
}

/** A `DoplApiError`-shaped rejection. */
export function apiError(status: number, code: string, apiMessage = "refused") {
  return Object.assign(new Error(apiMessage), { status, code, apiMessage });
}
