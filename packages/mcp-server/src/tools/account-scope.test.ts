/**
 * 🔒 THE ACCOUNT-WIDE READS UNDER THE CONTAINER LOCK (B3).
 *
 * `GET /api/channels/account/**` is `withUserAuth` and answers for the WHOLE
 * ACCOUNT, because that is the question T20/T21/T22 exist to answer in one call.
 * A locked session must see exactly the room it stands in and learn nothing
 * about the existence of another, and the route cannot enforce that — a lock is
 * a property of one MCP CONNECTION, not of the credential.
 *
 * ⚠ **THE EASIEST WAY TO REGRESS THIS IS TO CALL THE CLIENT DIRECTLY**, which is
 * why `account-scope.ts` exists at all and why this suite drives it rather than
 * asserting on `narrowToLock`. `container-lock.test.ts` makes the same argument
 * for `dopl_home`.
 *
 * ⚠ THIS IS A TRIPWIRE SUITE, NOT A CONTAINMENT SUITE — Bash can open a second
 * unpinned MCP connection. Do not read a green run here as containment.
 */

import { describe, expect, it, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import type { WorkspaceDirectory } from "../workspace-directory.js";
import { accountMessages, accountStatus } from "./account-scope.js";

function directory(locked: string | null): WorkspaceDirectory {
  return {
    getWorkspaceList: async () => [],
    resolveWorkspaceRef: async () => null,
    noWorkspaceError: async () => ({ content: [], isError: true }),
    lockedWorkspaceId: () => locked,
  };
}

const CHANNELS = [
  { channelId: "ch-a", workspaceId: "ws-locked", channelName: "Mine" },
  { channelId: "ch-b", workspaceId: "ws-other", channelName: "Elsewhere" },
];

const MESSAGES = [
  { channelId: "ch-a", workspaceId: "ws-locked", seq: 10 },
  { channelId: "ch-b", workspaceId: "ws-other", seq: 11 },
  { channelId: "ch-b", workspaceId: "ws-other", seq: 12 },
];

function client(): DoplClient {
  return {
    getAccountStatus: vi.fn().mockResolvedValue({
      channels: CHANNELS,
      operatorOnline: true,
      since: 1,
      truncated: { channels: false, unread: false, waiting: false },
    }),
    readAccountMessages: vi.fn().mockResolvedValue({
      messages: MESSAGES,
      channelCount: 2,
      truncated: false,
    }),
  } as unknown as DoplClient;
}

describe("the account-wide reads under a container lock", () => {
  it("answer the whole account when there is NO lock", async () => {
    const status = await accountStatus(client(), directory(null));
    expect(status.channels.map((c) => c.channelId)).toEqual(["ch-a", "ch-b"]);

    const page = await accountMessages(client(), directory(null), { since: 1 });
    expect(page.messages).toHaveLength(3);
    // ⚠ Unlocked, the server's own count is passed through untouched.
    expect(page.channelCount).toBe(2);
  });

  it("🔒 narrow the STATUS to the locked container alone", async () => {
    const status = await accountStatus(client(), directory("ws-locked"));
    expect(status.channels.map((c) => c.channelId)).toEqual(["ch-a"]);
    // No evidence the other room exists — not its id, not its name.
    expect(JSON.stringify(status)).not.toContain("ws-other");
    expect(JSON.stringify(status)).not.toContain("Elsewhere");
  });

  it("🔒 narrow the MESSAGE page, and RE-DERIVE channelCount", async () => {
    const page = await accountMessages(client(), directory("ws-locked"), {
      since: 1,
    });
    expect(page.messages).toHaveLength(1);
    expect(page.messages[0].channelId).toBe("ch-a");
    // ⚠ THE ONE FIELD NARROWING MUST REWRITE. The server counts the channels it
    // WATCHED; passing that through would tell a locked agent how many rooms its
    // operator has, which is the enumeration the lock exists to deny.
    expect(page.channelCount).toBe(1);
  });

  it("pass the server's CLIP flags through untouched", async () => {
    const c = client();
    (c.getAccountStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      channels: CHANNELS,
      operatorOnline: false,
      since: null,
      truncated: { channels: true, unread: false, waiting: true },
    });
    const status = await accountStatus(c, directory("ws-locked"));
    // ⚠ Narrowing removes rows the caller may not see; a ceiling is a different
    // fact. Collapsing the two would let a locked session read "nothing was
    // clipped" as "you have exactly one room".
    expect(status.truncated).toEqual({
      channels: true,
      unread: false,
      waiting: true,
    });
  });

  it("tolerate an older server that sends no rows at all", async () => {
    const c = {
      getAccountStatus: vi.fn().mockResolvedValue({
        operatorOnline: true,
        since: null,
        truncated: { channels: false, unread: false, waiting: false },
      }),
      readAccountMessages: vi
        .fn()
        .mockResolvedValue({ channelCount: 0, truncated: false }),
    } as unknown as DoplClient;
    // ⚠ `?? []` — a `.filter` on undefined throws where an empty list merely
    // says "none".
    await expect(accountStatus(c, directory(null))).resolves.toMatchObject({
      channels: [],
    });
    await expect(
      accountMessages(c, directory(null), { since: 1 }),
    ).resolves.toMatchObject({ messages: [] });
  });
});
