/**
 * Route-param extractors for the chats API. ⚠ The id guards are load-bearing:
 * `chats.id` and `chat_folders.id` are `UUID PRIMARY KEY`
 * (`20260707170000_chats.sql`) and the repository filters on them directly
 * (`chats/server/repository.ts › .eq("id", …)`), so an unvalidated non-UUID
 * reaches Postgres as a 22P02 cast failure — a generic 500 plus a
 * `system_events` row on EVERY such call. It must fail as the SAME 404 (and the
 * same wording) a missing or foreign id gets, so ids cannot be probed.
 */

import { describe, it, expect } from "vitest";
import { HttpError } from "@/shared/lib/http-error";
import {
  requireChatId,
  requireFolderId,
  toChatErrorResponse,
} from "./chat-route";
import { ChatNotFoundError, ChatFolderNotFoundError } from "@/features/chats/server/errors";

const UUID = "550e8400-e29b-41d4-a716-446655440000";
const BAD_IDS = ["nope", "123", `${UUID}x`, "' OR 1=1--", "../../etc/passwd", "null"];

function thrownBy(fn: () => unknown): HttpError {
  try {
    fn();
  } catch (err) {
    return err as HttpError;
  }
  throw new Error("expected a throw");
}

describe("requireChatId", () => {
  it("returns a well-formed uuid (any case)", () => {
    expect(requireChatId({ chatId: UUID })).toBe(UUID);
    expect(requireChatId({ chatId: UUID.toUpperCase() })).toBe(UUID.toUpperCase());
  });

  it("404s a non-uuid instead of letting it hit the uuid column", () => {
    for (const bad of BAD_IDS) {
      const err = thrownBy(() => requireChatId({ chatId: bad }));
      expect(err, bad).toBeInstanceOf(HttpError);
      expect(err.status, bad).toBe(404);
      expect(err.code, bad).toBe("CHAT_NOT_FOUND");
    }
  });

  it("400s a missing param", () => {
    expect(thrownBy(() => requireChatId(undefined)).status).toBe(400);
    expect(thrownBy(() => requireChatId({})).code).toBe("MISSING_CHAT_ID");
  });

  it("is INDISTINGUISHABLE from a missing/foreign chat, so ids cannot be probed", () => {
    const malformed = thrownBy(() => requireChatId({ chatId: "nope" }));
    const absent = new ChatNotFoundError("nope");
    expect(malformed.message).toBe(absent.message);
  });
});

describe("requireFolderId", () => {
  it("returns a well-formed uuid", () => {
    expect(requireFolderId({ folderId: UUID })).toBe(UUID);
  });

  it("404s a non-uuid", () => {
    for (const bad of BAD_IDS) {
      const err = thrownBy(() => requireFolderId({ folderId: bad }));
      expect(err.status, bad).toBe(404);
      expect(err.code, bad).toBe("CHAT_FOLDER_NOT_FOUND");
    }
  });

  it("400s a missing param", () => {
    expect(thrownBy(() => requireFolderId({})).code).toBe("MISSING_FOLDER_ID");
  });

  it("is indistinguishable from a missing/foreign folder", () => {
    const malformed = thrownBy(() => requireFolderId({ folderId: "nope" }));
    expect(malformed.message).toBe(new ChatFolderNotFoundError("nope").message);
  });
});

describe("the route answer, so no 5xx is logged", () => {
  it("a malformed chat id renders 404 — never the 500 that writes a system_events row", async () => {
    for (const bad of BAD_IDS) {
      const res = toChatErrorResponse(thrownBy(() => requireChatId({ chatId: bad })));
      expect(res.status, bad).toBe(404);
      expect(res.status, bad).not.toBe(500);
      await expect(res.json()).resolves.toEqual({
        error: { code: "CHAT_NOT_FOUND", message: `Chat not found: ${bad}` },
      });
    }
  });

  it("a malformed folder id renders 404 too", () => {
    const res = toChatErrorResponse(
      thrownBy(() => requireFolderId({ folderId: "nope" }))
    );
    expect(res.status).toBe(404);
  });
});
