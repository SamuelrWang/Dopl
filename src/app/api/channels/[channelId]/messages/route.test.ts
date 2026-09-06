/**
 * THE TRANSCRIPT READ'S ENVELOPE — `entries` beside `messages`, and absent
 * unless the page actually folded (artifacts #1220 §4, ratified in the Mobile
 * Command Center room 2026-09-06; A4 closing slice).
 *
 * ⚠ **THE ADDITIVE CONTRACT IS THE WHOLE SUBJECT.** `messages` stays complete
 * and authoritative so an artifact-unaware client — an installed desktop, an
 * older web build — renders the run exactly as it did yesterday; a card-aware
 * renderer reads `entries` when they are there. Two ways this ships wrong and
 * both are pinned below: an `entries: null` KEY on every ordinary read (which
 * teaches a client that the server always folds and doubles nothing but noise),
 * and an envelope that drops or reshapes `messages` before the human decision to
 * do so has been made.
 *
 * ⚠ **THE FOLD VERDICT IS NOT THIS ROUTE'S, AND THAT IS THE OTHER PIN.** Whether
 * a read folds is decided once, in `server/service-artifacts.ts ›
 * readNamesMessages` (a `thread` read and a `since`+`before` window NAME
 * messages and never fold), and its own suite pins every direction. What this
 * file proves is the CHAIN: the route parses those four params and hands them to
 * the service verbatim, so a thread read arrives at that pin as a thread read.
 * A route that silently dropped `thread` would fold a named read while every
 * unit test still passed.
 */

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

vi.mock("@/features/channels/server/service", () => ({
  buildChannelContext: (auth: WorkspaceAuthContext) => ({
    userId: auth.userId,
    workspaceId: auth.workspaceId,
  }),
  readTranscript: vi.fn(),
  postMessage: vi.fn(),
}));

import { GET } from "./route";
import { readTranscript } from "@/features/channels/server/service";

const MESSAGES = [
  { id: "m-1", seq: 1, body: "one" },
  { id: "m-2", seq: 2, body: "two" },
];

const CARD = {
  type: "artifact",
  folded: {
    artifact: { id: "a-1", name: "Rollout plan", summary: "" },
    count: 2,
    firstSeq: 1,
    lastSeq: 2,
  },
};

function get(query = "") {
  return GET(
    new NextRequest(`https://dopl.test/api/channels/c-1/messages${query}`),
    { params: Promise.resolve({ channelId: "c-1" }) } as never
  );
}

const readMock = vi.mocked(readTranscript);

beforeEach(() => {
  readMock.mockReset();
});

describe("GET /api/channels/[channelId]/messages", () => {
  it("omits `entries` ENTIRELY when nothing on the page folded", async () => {
    readMock.mockResolvedValue({ messages: MESSAGES, entries: null } as never);
    const body = await (await get()).json();
    // ⚠ ABSENT, not `entries: null`: the key's presence is the signal that this
    // page has a folded rendering, and a null on every read would make it noise.
    expect("entries" in body).toBe(false);
    expect(body.messages).toEqual(MESSAGES);
  });

  it("carries `entries` BESIDE an unchanged `messages` when it folded", async () => {
    const entries = [{ type: "message", message: MESSAGES[0] }, CARD];
    readMock.mockResolvedValue({ messages: MESSAGES, entries } as never);
    const body = await (await get()).json();
    expect(body.entries).toEqual(entries);
    // ⚠ THE PAGE IS STILL WHOLE. The breaking flip — dropping `messages` once
    // every renderer reads entries — is a human decision that has not been made,
    // and a route that anticipated it would make it silently.
    expect(body.messages).toEqual(MESSAGES);
  });

  it("hands the service the thread, so a named read reaches the pin as one", async () => {
    readMock.mockResolvedValue({ messages: MESSAGES, entries: null } as never);
    await get("?thread=t-9");
    expect(readMock).toHaveBeenCalledWith(
      expect.anything(),
      "c-1",
      expect.objectContaining({ thread: "t-9" })
    );
  });

  it("a thread read carries no entries — the fold never reaches a named read", async () => {
    readMock.mockResolvedValue({ messages: MESSAGES, entries: null } as never);
    const body = await (await get("?thread=t-9")).json();
    expect("entries" in body).toBe(false);
  });

  it("forwards the bounded window verbatim — `since` AND `before` together", async () => {
    readMock.mockResolvedValue({ messages: MESSAGES, entries: null } as never);
    await get("?since=10&before=40&limit=25");
    expect(readMock).toHaveBeenCalledWith(
      expect.anything(),
      "c-1",
      // ⚠ BOTH cursors, or the service cannot tell a window (which names a
      // message) from a plain cursor (which does not) — the one distinction
      // `readNamesMessages` turns on.
      expect.objectContaining({ since: 10, before: 40, limit: 25 })
    );
  });

  it("passes a lone cursor as a lone cursor — the incremental read still folds", async () => {
    readMock.mockResolvedValue({ messages: MESSAGES, entries: [CARD] } as never);
    await get("?since=10");
    const query = readMock.mock.calls[0][2] as { since?: number; before?: number };
    expect(query.since).toBe(10);
    expect(query.before).toBeUndefined();
  });
});
