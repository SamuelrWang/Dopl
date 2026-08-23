/**
 * `/api/channels/sessions` — the two things that have already gone wrong on this surface:
 *   - IT VALIDATES BEFORE TOUCHING THE DATABASE. `?channelId=` went straight into `.eq()` and a
 *     non-uuid came back as a 500; the POST body has the same hazard with more surface (a CHECK
 *     violation as a 500, and a `channel_name` newline forging a line in `read_sessions`).
 *   - IT NEVER TAKES AN IDENTITY FROM THE CALLER. Both halves build context from
 *     `withWorkspaceAuth`; the table REVOKEs writes from `authenticated`, so the service IS the
 *     fence.
 * Auth is mocked at the wrapper: what is under test is the composition.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  workspaceId: "ws-1",
  workspaceSlug: "acme",
  workspacePublicId: "pub-1",
  role: "member",
  apiKeyWorkspaceId: null,
};

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: WorkspaceAuthContext) => Promise<Response>) =>
    (req: Request) =>
      handler(req, AUTH),
}));

vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: WorkspaceAuthContext) => ({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: "user",
    role: auth.role,
  }),
  listSessionStates: vi.fn(),
  reportSessionStates: vi.fn(),
}));

import { GET, POST } from "./route";
import {
  listSessionStates,
  reportSessionStates,
} from "@/features/channels/server/service";

const CHAN = "550e8400-e29b-41d4-a716-446655440000";
const TASK = "44444444-e29b-41d4-a716-446655440000";

const entry = (over: Record<string, unknown> = {}) => ({
  sessionKey: `${CHAN}:${TASK}`,
  channelId: CHAN,
  threadId: TASK,
  name: "flint",
  state: "working",
  channelName: "General",
  threadTitle: "Deploy check",
  ...over,
});

const post = (body: unknown) =>
  POST(
    new NextRequest("https://dopl.test/api/channels/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const get = (query = "") =>
  GET(new NextRequest(`https://dopl.test/api/channels/sessions${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reportSessionStates).mockResolvedValue({
    stored: 1,
    changed: 1,
    removed: 0,
  });
  vi.mocked(listSessionStates).mockResolvedValue({
    sessions: [],
    operatorOnline: false,
  });
});

describe("GET — the read", () => {
  it("answers the caller's own sessions", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [], operatorOnline: false });
    expect(listSessionStates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", workspaceId: "ws-1" }),
      undefined
    );
  });

  /**
   * ⚠ THE SECOND KEY IS THE ANTIDOTE TO THE STALE-IDLE LIE (F-294). Without it
   * the MCP render cannot tell a desktop that DIED from an agent that is merely
   * between turns, because the push is change-driven and both look identical on
   * the wire. It is derived server-side against `PRESENCE_ONLINE_WINDOW_MS`, so
   * no client re-derives freshness against a second number.
   */
  it("reports the caller's own presence freshness beside the rows", async () => {
    vi.mocked(listSessionStates).mockResolvedValue({
      sessions: [],
      operatorOnline: true,
    });
    expect(await (await get()).json()).toEqual({
      sessions: [],
      operatorOnline: true,
    });
  });

  it("refuses a malformed `?channelId=` with a 400, not a 500 (F-145)", async () => {
    const res = await get("?channelId=oops");
    expect(res.status).toBe(400);
    expect(listSessionStates).not.toHaveBeenCalled();
  });
});

describe("POST — the write", () => {
  it("stores the reported set under the AUTHENTICATED context", async () => {
    const res = await post({ sessions: [entry()] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 1, changed: 1, removed: 0 });
    expect(reportSessionStates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", workspaceId: "ws-1" }),
      [entry()]
    );
  });

  it("a caller-supplied user id is not in the parsed input at all", async () => {
    // The service reads ids off `ctx`, so even a body naming another member arrives as the
    // caller's own report.
    await post({
      sessions: [{ ...entry(), userId: "someone-else", workspaceId: "not-mine" }],
    });
    const [ctx, sessions] = vi.mocked(reportSessionStates).mock.calls[0];
    expect(ctx).toEqual(expect.objectContaining({ userId: "user-1", workspaceId: "ws-1" }));
    expect(sessions[0]).not.toHaveProperty("userId");
    expect(sessions[0]).not.toHaveProperty("workspaceId");
  });

  it("an EMPTY report is a real instruction, and reaches the service", async () => {
    vi.mocked(reportSessionStates).mockResolvedValue({
      stored: 0,
      changed: 0,
      removed: 2,
    });
    const res = await post({ sessions: [] });
    expect(res.status).toBe(200);
    expect(reportSessionStates).toHaveBeenCalledWith(expect.anything(), []);
  });

  it("refuses a value the column's CHECK would refuse — 400, before the database", async () => {
    const bad = [
      { label: "a handle outside the generator's charset", over: { name: "Flint!" } },
      { label: "a state the pill vocabulary does not have", over: { state: "thinking" } },
      { label: "a channel name carrying a newline", over: { channelName: "General\nAdmin" } },
      { label: "a thread title over the mirrored bound", over: { threadTitle: "t".repeat(201) } },
      { label: "a non-uuid channel id", over: { channelId: "nope" } },
    ];
    for (const { over } of bad) {
      const res = await post({ sessions: [entry(over)] });
      expect(res.status).toBe(400);
    }
    expect(reportSessionStates).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const res = await POST(
      new NextRequest("https://dopl.test/api/channels/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
    expect(reportSessionStates).not.toHaveBeenCalled();
  });

  it("a service failure is a failure — the write never degrades to a shrug", async () => {
    // ⚠ The READ may degrade a missing relation to `[]`; a WRITE may not — swallowing one
    // reports a store that did not happen.
    vi.mocked(reportSessionStates).mockRejectedValue(
      Object.assign(new Error("relation missing"), { code: "PGRST205" })
    );
    const res = await post({ sessions: [entry()] });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
