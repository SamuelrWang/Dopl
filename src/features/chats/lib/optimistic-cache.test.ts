/**
 * The rules that decide whether an optimistic chat write leaves a lie behind.
 *
 * Each case here is a way the pending row and the saved row could both end up
 * in a cache, or a way a patch could quietly widen past the row it was aimed
 * at. They are pure functions on the RAW response bodies, so none of this
 * needs React, a DOM or a network.
 */

import { describe, expect, it } from "vitest";
import type { Chat, ChatDetail, ChatFolder } from "../types";
import {
  addFolderRow,
  applyFolderScopeToChats,
  buildPendingFolder,
  isPendingId,
  mergeChatDetail,
  patchChatRow,
  pendingFolderId,
  removeChatRow,
  replaceChatRow,
  scopeBody,
  scopeFields,
  upsertFolderRow,
  type ChatFoldersCache,
  type ChatListCache,
} from "./optimistic-cache";

function chat(over: Partial<Chat> = {}): Chat {
  return {
    id: "c-1",
    folderId: null,
    title: "Migration planning",
    overview: "Planned the desktop migration.",
    pinned: false,
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
    owner: { userId: "u-me", name: "Ada", avatarUrl: null },
    source: "claude-code",
    project: null,
    format: "summarized",
    sessionDate: "2026-08-01",
    exportedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    messageCount: 12,
    deliverables: [],
    learnings: [],
    ...over,
  };
}

function folder(over: Partial<ChatFolder> = {}): ChatFolder {
  return {
    id: "f-1",
    name: "Migration",
    visibility: "private",
    accessMode: "workspace",
    grantedTeamIds: [],
    ...over,
  };
}

const list = (...chats: Chat[]): ChatListCache => ({ chats, hiddenCount: 0 });
const folderList = (...folders: ChatFolder[]): ChatFoldersCache => ({ folders });

describe("scope mapping", () => {
  it("resolves the same columns the server writes", () => {
    expect(scopeFields("private", ["t-1"])).toEqual({
      visibility: "private",
      // `updateChatForUser` lands anything that is not public+teams on
      // 'workspace' with no grants — a private chat keeps none.
      accessMode: "workspace",
      grantedTeamIds: [],
    });
    expect(scopeFields("team", ["t-1", "t-2"])).toEqual({
      visibility: "public",
      accessMode: "teams",
      grantedTeamIds: ["t-1", "t-2"],
    });
    expect(scopeFields("workspace", ["t-1"])).toEqual({
      visibility: "public",
      accessMode: "workspace",
      grantedTeamIds: [],
    });
  });

  it("sends teamIds only where the server reads them", () => {
    expect(scopeBody("private", ["t-1"])).toEqual({ visibility: "private" });
    expect(scopeBody("team", ["t-1"])).toEqual({
      visibility: "public",
      accessMode: "teams",
      teamIds: ["t-1"],
    });
    expect(scopeBody("workspace", [])).toEqual({
      visibility: "public",
      accessMode: "workspace",
    });
  });
});

describe("pending folders", () => {
  it("mints a marked, unique id", () => {
    const a = pendingFolderId();
    const b = pendingFolderId();
    expect(isPendingId(a)).toBe(true);
    expect(isPendingId("f-1")).toBe(false);
    expect(a).not.toBe(b);
  });

  it("inserts alphabetically rather than appending", () => {
    const next = addFolderRow(
      folderList(folder({ id: "f-a", name: "Alpha" }), folder({ id: "f-z", name: "Zulu" })),
      buildPendingFolder("pending:x", "Mid")
    );
    expect(next?.folders.map((f) => f.name)).toEqual(["Alpha", "Mid", "Zulu"]);
  });

  it("DECLINES TO SEED a cache that has no data", () => {
    // A folders read still in flight has nothing for the write to append to;
    // seeding it would render a one-folder archive and then have the landing
    // read replace it.
    expect(addFolderRow(undefined, buildPendingFolder("pending:x", "Mid"))).toBeUndefined();
  });

  it("swaps the pending twin for the saved row without duplicating it", () => {
    const tempId = "pending:x";
    const seeded = addFolderRow(folderList(), buildPendingFolder(tempId, "Mid"));
    const reconciled = upsertFolderRow(seeded, folder({ id: "f-9", name: "Mid" }), tempId);
    expect(reconciled?.folders).toHaveLength(1);
    expect(reconciled?.folders[0].id).toBe("f-9");
  });

  it("replaces in place when the id is already the server's", () => {
    const next = upsertFolderRow(
      folderList(folder({ name: "Migration" })),
      folder({ name: "Migration", visibility: "public", accessMode: "teams" })
    );
    expect(next?.folders).toHaveLength(1);
    expect(next?.folders[0].accessMode).toBe("teams");
  });
});

describe("chat list patches", () => {
  it("merges one row and leaves the rest byte-identical", () => {
    const other = chat({ id: "c-2" });
    const next = patchChatRow(list(chat(), other), "c-1", { pinned: true });
    expect(next?.chats[0].pinned).toBe(true);
    expect(next?.chats[1]).toBe(other);
  });

  it("is a no-op on a miss, never an append", () => {
    const next = patchChatRow(list(chat()), "c-nope", { pinned: true });
    expect(next?.chats).toHaveLength(1);
    expect(next?.chats[0].pinned).toBe(false);
  });

  it("replaces a row wholesale from the server's answer", () => {
    const next = replaceChatRow(list(chat()), chat({ title: "Renamed", pinned: true }));
    expect(next?.chats[0].title).toBe("Renamed");
  });

  it("drops exactly the deleted row and keeps hiddenCount", () => {
    const next = removeChatRow(
      { chats: [chat(), chat({ id: "c-2" })], hiddenCount: 4 },
      "c-1"
    );
    expect(next?.chats.map((c) => c.id)).toEqual(["c-2"]);
    expect(next?.hiddenCount).toBe(4);
  });

  it("propagates a folder's scope to its filed chats only", () => {
    const next = applyFolderScopeToChats(
      list(
        chat({ id: "c-in", folderId: "f-1" }),
        chat({ id: "c-out", folderId: "f-2" }),
        chat({ id: "c-unfiled", folderId: null })
      ),
      "f-1",
      scopeFields("team", ["t-1"])
    );
    expect(next?.chats[0].accessMode).toBe("teams");
    expect(next?.chats[0].grantedTeamIds).toEqual(["t-1"]);
    expect(next?.chats[1].visibility).toBe("private");
    expect(next?.chats[2].visibility).toBe("private");
  });
});

describe("transcript cache", () => {
  const detail: ChatDetail = {
    ...chat(),
    messages: [
      { index: 1, role: "user", summary: "Asked", verbatim: null },
      { index: 2, role: "agent", summary: "Answered", verbatim: null },
    ],
  };

  it("MERGES header fields and keeps the transcript", () => {
    // The chat PATCH answers with the LIST-level `Chat` — no `messages`.
    // Assigning it here would evict a 200-message transcript on a pin toggle.
    const next = mergeChatDetail({ chat: detail }, chat({ pinned: true }));
    expect(next?.chat.pinned).toBe(true);
    expect(next?.chat.messages).toHaveLength(2);
  });

  it("declines a cache with no transcript loaded", () => {
    expect(mergeChatDetail(undefined, { pinned: true })).toBeUndefined();
  });
});
