/**
 * **THE OPAQUE CURSOR CODEC** (B6-1, 2026-10-12).
 *
 * ⚠ **THE HEADLINE CASE IS "THE SEQ DOES NOT APPEAR IN THE TOKEN", BECAUSE THAT
 * IS THE ENTIRE POINT.** A round-trip test passes for a signed integer, a
 * base64'd integer, and even for `String(seq)` — none of which close the leak this
 * feature exists for. So the suite asserts CONFIDENTIALITY first and correctness
 * second.
 *
 * ⚠ **AND EVERY REFUSAL IS ASSERTED AS THE SAME REFUSAL.** Wrong key, wrong
 * scope, wrong reader, truncated, tampered, not-a-token: one error type, one
 * message. A test that accepted different errors per cause would invite a future
 * edit to leak which check failed, which is how a token gets narrowed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

import {
  CURSOR_PREFIX,
  cursorScopeKey,
  cursorTokensAvailable,
  decodeCursor,
  encodeCursor,
  isCursorToken,
  type CursorScope,
} from "./cursor-codec";
import { ChannelCursorUndecodableError } from "./errors";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const USER = "11111111-e29b-41d4-a716-446655440000";
const PEER = "22222222-e29b-41d4-a716-446655440000";
const CHANNEL: CursorScope = { kind: "channel", channelId: "chan-1" };
const ACCOUNT: CursorScope = { kind: "account" };

/**
 * ⚠ **`vi.stubEnv`, NOT `process.env` MUTATION.** `NODE_ENV` is typed read-only
 * (Next's env types), so assigning it compiles under vitest and fails `tsc` —
 * which is how this suite first went green while the typecheck refused it. Stubbing
 * is also the only parallel-safe form: these suites share one process, and a key
 * left set would silently change another file's behaviour.
 *
 * ⚠ **`""` IS THE "UNSET" IDIOM** here, because `delete process.env.X` hits the same
 * read-only type. The codec reads the key with a falsy check, so empty and absent
 * are the same input — which is itself worth having asserted.
 */
beforeEach(() => {
  vi.stubEnv("DOPL_CURSOR_KEY", KEY_A);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a token hides the number — the reason this exists", () => {
  it("🔒 the seq appears NOWHERE in the token — three needles, three wrong codecs", () => {
    /**
     * ⚠ **THE HEX NEEDLE THIS REPLACES WAS FLAKY AND WEAK AT ONCE** (Review 40,
     * measured): `(4461).toString(16)` is `"116d"`, four hex characters in a
     * 72-character hex haystack, so it FALSE-REDS about **1 run in 984** (1,016
     * collisions in 1,000,000 random 36-byte buffers, measured locally) — and it
     * would not have caught `base64url(String(seq))` either.
     *
     * Each needle below catches a DIFFERENT wrong implementation, which is why all
     * three stay:
     *   • the raw string in the token → a signed-but-plaintext cursor (`4461.<mac>`)
     *   • `utf8` / `latin1` of the decoded body → `base64url(String(seq))`
     *   • the 8-byte BIG-ENDIAN plaintext → a codec that encodes the real payload
     *     without encrypting it (ECB, XOR, or no cipher at all)
     *
     * The 8-byte needle cannot collide by chance in any run that matters: it is
     * 2^64 wide, against 2^16 for the four hex characters it replaces.
     */
    const seq = 4461;
    const token = encodeCursor(seq, CHANNEL, USER);
    const body = Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url");
    const plainBE8 = Buffer.alloc(8);
    plainBE8.writeBigUInt64BE(BigInt(seq));

    expect(token).not.toContain(String(seq));
    expect(body.toString("utf8")).not.toContain(String(seq));
    expect(body.toString("latin1")).not.toContain(String(seq));
    expect(body.includes(plainBE8)).toBe(false);
  });

  it("🔒 the SAME seq encodes differently every time", () => {
    // A deterministic token would let a reader test two cursors for equality and
    // recover the ordering — and ordering is most of what the integer leaked.
    const a = encodeCursor(4461, CHANNEL, USER);
    const b = encodeCursor(4461, CHANNEL, USER);
    expect(a).not.toBe(b);
    expect(decodeCursor(a, CHANNEL, USER)).toBe(4461);
    expect(decodeCursor(b, CHANNEL, USER)).toBe(4461);
  });

  it("🔒 two ADJACENT seqs give tokens of identical length and no shared tail", () => {
    // Length or a common suffix would order them without decoding.
    const a = encodeCursor(4461, CHANNEL, USER);
    const b = encodeCursor(4462, CHANNEL, USER);
    expect(a.length).toBe(b.length);
    expect(a.slice(-8)).not.toBe(b.slice(-8));
  });
});

describe("round trip", () => {
  it("carries every seq a BIGINT column can hand us", () => {
    for (const seq of [0, 1, 2, 999, 4461, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      const token = encodeCursor(seq, CHANNEL, USER);
      expect(decodeCursor(token, CHANNEL, USER), String(seq)).toBe(seq);
    }
  });

  it("every scope kind round-trips, and keys differently", () => {
    expect(cursorScopeKey(CHANNEL)).toBe("channel:chan-1");
    expect(cursorScopeKey(ACCOUNT)).toBe("account");
    expect(cursorScopeKey({ kind: "workspace", workspaceId: "ws-1" })).toBe(
      "workspace:ws-1",
    );
    for (const scope of [CHANNEL, ACCOUNT, { kind: "workspace", workspaceId: "ws-1" } as const]) {
      expect(decodeCursor(encodeCursor(7, scope, USER), scope, USER)).toBe(7);
    }
  });

  it("the prefix is stable, and tells a token from a legacy integer", () => {
    expect(encodeCursor(1, CHANNEL, USER).startsWith("dc1.")).toBe(true);
    expect(isCursorToken(encodeCursor(1, CHANNEL, USER))).toBe(true);
    for (const legacy of ["0", "4461", "", "none", "-1"]) {
      expect(isCursorToken(legacy), legacy).toBe(false);
    }
  });

  it("refuses to encode something that is not a cursor", () => {
    for (const bad of [-1, 1.5, NaN, Infinity, 2 ** 53]) {
      expect(() => encodeCursor(bad, CHANNEL, USER), String(bad)).toThrow();
    }
  });
});

describe("every refusal is the SAME refusal", () => {
  const expectRefusal = (fn: () => unknown) => {
    expect(fn).toThrow(ChannelCursorUndecodableError);
    expect(fn).toThrow(/cannot be read by this server/);
  };

  it("🔒 a cursor minted for ANOTHER READER", () => {
    const token = encodeCursor(4461, CHANNEL, USER);
    expectRefusal(() => decodeCursor(token, CHANNEL, PEER));
  });

  it("🔒 a cursor minted for ANOTHER SCOPE — a channel cursor is not an account one", () => {
    const token = encodeCursor(4461, CHANNEL, USER);
    expectRefusal(() => decodeCursor(token, ACCOUNT, USER));
    expectRefusal(() =>
      decodeCursor(token, { kind: "channel", channelId: "chan-2" }, USER),
    );
  });

  it("🔒 a cursor minted under a RETIRED KEY", () => {
    const token = encodeCursor(4461, CHANNEL, USER);
    vi.stubEnv("DOPL_CURSOR_KEY", KEY_B);
    expectRefusal(() => decodeCursor(token, CHANNEL, USER));
  });

  it("🔒 a TAMPERED token", () => {
    const token = encodeCursor(4461, CHANNEL, USER);
    const body = Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url");
    body[body.length - 1] ^= 0xff; // flip the tag
    expectRefusal(() =>
      decodeCursor(CURSOR_PREFIX + body.toString("base64url"), CHANNEL, USER),
    );
    const mid = Buffer.from(token.slice(CURSOR_PREFIX.length), "base64url");
    mid[14] ^= 0x01; // flip the ciphertext
    expectRefusal(() =>
      decodeCursor(CURSOR_PREFIX + mid.toString("base64url"), CHANNEL, USER),
    );
  });

  it("🔒 a TRUNCATED or overlong token", () => {
    const token = encodeCursor(4461, CHANNEL, USER);
    expectRefusal(() => decodeCursor(token.slice(0, token.length - 4), CHANNEL, USER));
    expectRefusal(() => decodeCursor(token + "AAAA", CHANNEL, USER));
  });

  it("🔒 something that is not a token at all", () => {
    for (const junk of ["", "4461", "dc1.", "dc1.!!!!", "dc2.AAAA", "null"]) {
      expectRefusal(() => decodeCursor(junk, CHANNEL, USER));
    }
  });

  it("🔒 and with NO KEY configured, every token is undecodable", () => {
    const token = encodeCursor(4461, CHANNEL, USER);
    vi.stubEnv("DOPL_CURSOR_KEY", "");
    expectRefusal(() => decodeCursor(token, CHANNEL, USER));
  });
});

describe("the key, and the one dev fallback (ASK 12)", () => {
  it("accepts the key as base64 OR hex", () => {
    const hex = randomBytes(32).toString("hex");
    vi.stubEnv("DOPL_CURSOR_KEY", hex);
    expect(decodeCursor(encodeCursor(9, CHANNEL, USER), CHANNEL, USER)).toBe(9);
  });

  it("🔒 a key of the WRONG LENGTH is no key — not a truncated one", () => {
    vi.stubEnv("DOPL_CURSOR_KEY", Buffer.alloc(16).toString("base64"));
    vi.stubEnv("NODE_ENV", "development");
    expect(cursorTokensAvailable()).toBe(false);
    expect(() => encodeCursor(1, CHANNEL, USER)).toThrow(/not configured/);
  });

  it("dev with no key falls back — tokens are simply unavailable", () => {
    vi.stubEnv("DOPL_CURSOR_KEY", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(cursorTokensAvailable()).toBe(false);
  });

  it("🔒 PRODUCTION with no key REFUSES — a fail-open here is the leak with extra steps", () => {
    vi.stubEnv("DOPL_CURSOR_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => cursorTokensAvailable()).toThrow(/DOPL_CURSOR_KEY is not configured/);
  });

  it("production WITH a key is available", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cursorTokensAvailable()).toBe(true);
  });
});
