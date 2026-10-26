import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const AUTH = {
  userId: "u-1",
  workspaceId: "w-1",
  params: { channelId: "c-1" },
} as unknown as WorkspaceAuthContext;

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: NextRequest, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: NextRequest) =>
      handler(req, AUTH),
}));

// The error class is the real one: `mapChannelError` matches on `instanceof`.
vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: WorkspaceAuthContext) => ({
    userId: auth.userId,
    workspaceId: auth.workspaceId,
  }),
  applyTaskAction: vi.fn(),
  listChannelTasks: vi.fn(),
  readChannelTask: vi.fn(),
}));

import { GET, POST } from "./route";
import { applyTaskAction, listChannelTasks, readChannelTask } from "@/features/channels/server/service";
import { TaskNotFoundError } from "@/features/channels/server/errors";

const TASK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROUTE_CTX = { params: Promise.resolve({ channelId: "c-1" }) } as never;

const get = (query: string) =>
  GET(new NextRequest(`http://x/api/channels/c-1/tasks${query}`), ROUTE_CTX);
const post = (body: unknown) =>
  POST(
    new NextRequest("http://x/api/channels/c-1/tasks", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    ROUTE_CTX
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/channels/[channelId]/tasks", () => {
  it("lists with the status filter, and keeps `truncated`", async () => {
    vi.mocked(listChannelTasks).mockResolvedValue({ tasks: [], truncated: true });
    const res = await get("?status=open");
    expect(listChannelTasks).toHaveBeenCalledWith(expect.anything(), "c-1", "open");
    expect(await res.json()).toEqual({ tasks: [], truncated: true });
  });

  it("an unknown task is a 404 with its code", async () => {
    vi.mocked(readChannelTask).mockRejectedValue(new TaskNotFoundError(TASK));
    const res = await get(`?task=${TASK}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).toContain("TASK_NOT_FOUND");
  });

  it("a malformed task id is a 400, never a uuid-cast 500", async () => {
    const res = await get("?task=nope");
    expect(res.status).toBe(400);
    expect(readChannelTask).not.toHaveBeenCalled();
  });
});

describe("POST /api/channels/[channelId]/tasks", () => {
  it("answers 201 for a create and 200 for any other action", async () => {
    vi.mocked(applyTaskAction).mockResolvedValue({ task: { id: TASK } } as never);
    expect((await post({ action: "create", title: "Fix" })).status).toBe(201);
    expect((await post({ action: "set_status", task: TASK, status: "resolved" })).status).toBe(200);
  });

  it("refuses an action outside the union before the service", async () => {
    const res = await post({ action: "delete", task: TASK });
    expect(res.status).toBe(400);
    expect(applyTaskAction).not.toHaveBeenCalled();
  });
});
