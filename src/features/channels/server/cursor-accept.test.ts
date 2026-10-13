/**
 * **BOTH CURSOR FORMS, ONE DECODE, ONE NUMBER DOWNSTREAM** (B6-2, 2026-10-12).
 *
 * ⚠ **THE INTEGER ARM IS NOT A LEGACY COURTESY — IT IS THE ONLY FORM ANY CLIENT
 * SENDS TODAY**, and will be for as long as an un-upgraded desktop exists. Every
 * client derives its own cursor from `message.seq` on the rows it was handed
 * (`channel-listener.js:95`, `use-channel-messages.ts`), so integers keep arriving
 * until those are released AND adopted. The first assertion below is therefore the
 * compatibility one, not the new feature.
 *
 * ⚠ **AND THE SCOPE BINDING IS ENFORCED BY THE CIPHER, NOT BY A CHECK.** The
 * cross-scope cases pass only because the scope is part of the AAD — there is no
 * `if (scope !== …)` anywhere to forget. That is why they are asserted here rather
 * than trusted from the codec's own suite: this is the layer that chooses which
 * scope to pass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

import { acceptChannelCursor } from "./cursor-accept";
import { encodeChannelCursor, type CursorScope } from "./cursor-codec";
import { ChannelCursorUndecodableError } from "./errors";

const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const CHANNEL: CursorScope = { kind: "channel", channelId: "chan-1" };
const OTHER: CursorScope = { kind: "channel", channelId: "chan-2" };
const WORKSPACE: CursorScope = { kind: "workspace", workspaceId: "ws-1" };
const ACCOUNT: CursorScope = { kind: "account" };

beforeEach(() => {
  vi.stubEnv("DOPL_CURSOR_KEY", randomBytes(32).toString("base64"));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a legacy integer still works, unchanged", () => {
  it("🔒 passes a number straight through — every client sends one today", () => {
    for (const seq of [0, 1, 4461, Number.MAX_SAFE_INTEGER]) {
      expect(acceptChannelCursor(seq, CHANNEL, USER)).toBe(seq);
    }
  });

  it("🔒 needs NO key — an integer must work on a deploy with none", () => {
    // Dev, CI, and any deploy mid-rollout. If this needed a key, B6-2 would be a
    // breaking change rather than an additive one.
    vi.stubEnv("DOPL_CURSOR_KEY", "");
    expect(acceptChannelCursor(4461, CHANNEL, USER)).toBe(4461);
  });

  it("absent stays absent — `undefined` is not zero", () => {
    expect(acceptChannelCursor(undefined, CHANNEL, USER)).toBeUndefined();
  });
});

describe("a token decodes, at the scope it was minted for", () => {
  it("round-trips through the accept layer", () => {
    const token = encodeChannelCursor(4461, CHANNEL, USER);
    expect(acceptChannelCursor(token, CHANNEL, USER)).toBe(4461);
  });

  it("every scope kind", () => {
    for (const scope of [CHANNEL, WORKSPACE, ACCOUNT]) {
      const token = encodeChannelCursor(7, scope, USER);
      expect(acceptChannelCursor(token, scope, USER)).toBe(7);
    }
  });

  it("🔒 a CHANNEL token is refused by another channel", () => {
    const token = encodeChannelCursor(4461, CHANNEL, USER);
    expect(() => acceptChannelCursor(token, OTHER, USER)).toThrow(
      ChannelCursorUndecodableError,
    );
  });

  it("🔒 a CHANNEL token is refused by the workspace hold and the account read", () => {
    // The transposition the integer always allowed: one number was valid in every
    // space that accepted a cursor.
    const token = encodeChannelCursor(4461, CHANNEL, USER);
    expect(() => acceptChannelCursor(token, WORKSPACE, USER)).toThrow(
      ChannelCursorUndecodableError,
    );
    expect(() => acceptChannelCursor(token, ACCOUNT, USER)).toThrow(
      ChannelCursorUndecodableError,
    );
  });

  it("🔒 and an ACCOUNT token is refused by a single channel", () => {
    const token = encodeChannelCursor(4461, ACCOUNT, USER);
    expect(() => acceptChannelCursor(token, CHANNEL, USER)).toThrow(
      ChannelCursorUndecodableError,
    );
  });

  it("🔒 another reader's token is refused — a cursor is not portable", () => {
    const token = encodeChannelCursor(4461, CHANNEL, USER);
    expect(() => acceptChannelCursor(token, CHANNEL, PEER)).toThrow(
      ChannelCursorUndecodableError,
    );
  });
});

describe("a string that is not a token is REFUSED, never parsed", () => {
  it("🔒 no `Number()` fallback — a NaN cursor must never reach the query", () => {
    // `schema-reads.ts` makes this unreachable through a route, and it is written
    // as a refusal anyway because the next caller may not come through zod. A
    // silent `Number("12abc") → NaN` landing in `gt("seq", NaN)` is the shape of
    // bug this lane exists to avoid.
    for (const junk of ["12abc", "4461", "", "none", "null", "dc2.AAAA"]) {
      expect(
        () => acceptChannelCursor(junk, CHANNEL, USER),
        junk,
      ).toThrow(ChannelCursorUndecodableError);
    }
  });

  it("🔒 and the refusal carries the remedy, so a caller can act on it", () => {
    expect(() => acceptChannelCursor("nope", CHANNEL, USER)).toThrow(
      /without a cursor/i,
    );
  });
});
