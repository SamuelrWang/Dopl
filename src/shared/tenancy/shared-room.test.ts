import { describe, expect, it } from "vitest";
import { isSharedRoom } from "./shared-room";
import { isSharedChannel } from "@/features/channels/lib/tool-profile-resolve";

/**
 * 🔒 **THE ONE PREDICATE, OVER ITS WHOLE INPUT DOMAIN** (Samuel's rulings R-08
 * and R-15, 2026-09-17; F-513).
 *
 * ⚠ **THE ARMS BELOW ARE A CONTRACT, NOT A TABLE OF EXAMPLES.** Four readers
 * narrow on this answer — the launch tool profile, the MCP container lock, the
 * MCP confirm class and the container-publish acknowledgement — and each of
 * them fails OPEN if the unknown arms ever flip. `0`, `null` and `undefined`
 * are the unknown, and the unknown is SHARED.
 */
describe("isSharedRoom — the member count is the whole question", () => {
  it("exactly one member is SOLO, and it is the only solo answer", () => {
    expect(isSharedRoom(1)).toBe(false);
    for (const n of [2, 3, 9, 40, 1_000]) {
      expect(isSharedRoom(n), `memberCount=${n}`).toBe(true);
    }
  });

  it("🔒 an ABSENT count is SHARED — unknown narrows, it never widens", () => {
    expect(isSharedRoom(undefined)).toBe(true);
    expect(isSharedRoom(null)).toBe(true);
  });

  it("🔒 ZERO is SHARED — 'I could not count them' is never 'there is nobody'", () => {
    expect(isSharedRoom(0)).toBe(true);
  });

  it("takes NO container kind, and there is nowhere to pass one", () => {
    // ⚠ The type is the assertion: a second parameter is what R-08 deleted, and
    // the arity is what stops one being reintroduced by a caller rather than by
    // a ruling.
    expect(isSharedRoom.length).toBe(1);
  });
});

describe("isSharedChannel is the same function under its channel-shaped name", () => {
  it("is literally the same reference — a re-export, not a second body", () => {
    expect(isSharedChannel).toBe(isSharedRoom);
  });
});
