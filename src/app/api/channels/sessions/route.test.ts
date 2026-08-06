/**
 * `/api/channels/sessions` — read-session-state's two halves (rollback §3.5).
 *
 * WHAT THIS FILE IS FOR. The handler is thin by design, and the two things it
 * does are exactly the two that have already gone wrong on this surface:
 *
 *   - IT VALIDATES BEFORE IT TOUCHES THE DATABASE. `?channelId=` went straight
 *     into `.eq()` and a non-uuid came back as a 500 (F-145). The POST body has
 *     the same shape of hazard with more surface — a `name` or a `state` the
 *     column's CHECK refuses is a constraint violation surfacing as a 500, and
 *     a `channel_name` carrying a newline is a forged line in the server
 *     narration of `read_sessions`.
 *   - IT NEVER TAKES AN IDENTITY FROM THE CALLER. Both halves build their
 *     context from `withWorkspaceAuth` and pass it to the service, which is
 *     what makes the write scoped to the caller's own rows on a table whose
 *     writes are REVOKEd from `authenticated` (so the statement runs with RLS
 *     bypassed and the service IS the fence).
 *
 * Auth is mocked at the wrapper (the `api/knowledge/bases/route.test.ts`
 * idiom) — what is under test is the composition, not `withWorkspaceAuth`.
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
  vi.mocked(listSessionStates).mockResolvedValue([]);
});

describe("GET — the read", () => {
  it("answers the caller's own sessions", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
    expect(listSessionStates).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", workspaceId: "ws-1" }),
      undefined
    );
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
    // The schema is strict about what it KEEPS, and the service reads the ids
    // off `ctx`. Even a body that names another member reaches the service as
    // the caller's own report.
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
    // The READ degrades a missing relation to `[]` because the answer is the
    // same either way. A write that swallowed one would report a store that did
    // not happen, and `read_sessions` would then be honestly empty about a
    // machine that is honestly working.
    vi.mocked(reportSessionStates).mockRejectedValue(
      Object.assign(new Error("relation missing"), { code: "PGRST205" })
    );
    const res = await post({ sessions: [entry()] });
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
