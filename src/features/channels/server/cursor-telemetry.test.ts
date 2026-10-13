/**
 * **B6-4: the cursor-form counter** (2026-10-13).
 *
 * What it must do: say which form arrived (absent / integer / token / other)
 * and whether the caller advertised `X-Dopl-Cursor: opaque-1`, on a closed set
 * of values, never echoing the cursor itself, and never failing a read.
 * The route-level matrix (every surface emits its own name) lives in
 * `src/app/api/channels/cursor-telemetry.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

import {
  cursorCapability,
  cursorForm,
  logCursorForm,
  type CursorSurface,
} from "./cursor-telemetry";
import { acceptChannelCursor } from "./cursor-accept";
import { encodeChannelCursor, type CursorScope } from "./cursor-codec";
import { ChannelCursorUndecodableError } from "./errors";

const USER = "11111111-e29b-41d4-a716-446655440000";
const CHANNEL: CursorScope = { kind: "channel", channelId: "chan-1" };

let log: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubEnv("DOPL_CURSOR_KEY", randomBytes(32).toString("base64"));
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  log.mockRestore();
  vi.unstubAllEnvs();
});

/** Every `[cursor-form]` line logged so far. */
function lines(): string[] {
  return log.mock.calls
    .map((c: unknown[]) => String(c[0]))
    .filter((l: string) => l.startsWith("[cursor-form]"));
}

describe("cursorForm", () => {
  it("names each of the four forms", () => {
    expect(cursorForm(undefined)).toBe("absent");
    expect(cursorForm(0)).toBe("integer");
    expect(cursorForm(4461)).toBe("integer");
    expect(cursorForm("dc1.AAAA")).toBe("token");
    expect(cursorForm("4461")).toBe("other");
    expect(cursorForm("dc2.AAAA")).toBe("other");
    expect(cursorForm("")).toBe("other");
  });
});

describe("cursorCapability", () => {
  it("is true only for the exact advertised value", () => {
    expect(cursorCapability(new Headers({ "X-Dopl-Cursor": "opaque-1" }))).toBe(true);
    expect(cursorCapability(new Headers({ "x-dopl-cursor": "opaque-1" }))).toBe(true);
    expect(cursorCapability(new Headers({ "X-Dopl-Cursor": "opaque-2" }))).toBe(false);
    expect(cursorCapability(new Headers({ "X-Dopl-Cursor": "" }))).toBe(false);
    expect(cursorCapability(new Headers())).toBe(false);
  });
});

describe("logCursorForm", () => {
  it("🔒 emits exactly one line, surface x form x advertised, and nothing else", () => {
    logCursorForm(4461, { surface: "account-status", advertised: true });
    logCursorForm(undefined, { surface: "workspace-await", advertised: false });
    logCursorForm("dc1.AAAA", { surface: "messages-read" });
    expect(lines()).toEqual([
      "[cursor-form] surface=account-status form=integer advertised=yes",
      "[cursor-form] surface=workspace-await form=absent advertised=no",
      "[cursor-form] surface=messages-read form=token advertised=unknown",
    ]);
  });

  it("🔒 never writes the cursor value, integer or token", () => {
    const token = encodeChannelCursor(918273, CHANNEL, USER);
    logCursorForm(918273, { surface: "channel-await", advertised: true });
    logCursorForm(token, { surface: "channel-await", advertised: true });
    logCursorForm("777123junk", { surface: "channel-await", advertised: true });
    const out = lines().join("\n");
    expect(lines()).toHaveLength(3);
    expect(out).not.toContain("918273");
    expect(out).not.toContain(token.slice(4));
    expect(out).not.toContain("777123");
  });

  it("🔒 every line is drawn from the closed set (bounded cardinality)", () => {
    const surfaces: CursorSurface[] = [
      "channel-await",
      "workspace-await",
      "account-messages",
      "account-status",
      "messages-read",
    ];
    const values = [undefined, 7, "dc1.AAAA", "junk"];
    const caps = [true, false, undefined];
    for (const surface of surfaces)
      for (const v of values)
        for (const advertised of caps) logCursorForm(v, { surface, advertised });
    const shape =
      /^\[cursor-form\] surface=(channel-await|workspace-await|account-messages|account-status|messages-read) form=(absent|integer|token|other) advertised=(yes|no|unknown)$/;
    expect(lines()).toHaveLength(60);
    for (const l of lines()) expect(l).toMatch(shape);
    expect(new Set(lines()).size).toBe(60);
  });

  it("DOPL_CURSOR_DIAG=0 silences it", () => {
    vi.stubEnv("DOPL_CURSOR_DIAG", "0");
    logCursorForm(1, { surface: "channel-await", advertised: true });
    expect(lines()).toEqual([]);
  });

  it("🔒 a failing logger never fails the read", () => {
    log.mockImplementation(() => {
      throw new Error("log sink down");
    });
    expect(() => logCursorForm(1, { surface: "channel-await" })).not.toThrow();
    expect(acceptChannelCursor(4461, CHANNEL, USER, { surface: "channel-await" })).toBe(4461);
  });
});

describe("acceptChannelCursor counts every arrival", () => {
  const T = { surface: "channel-await" as const, advertised: true };

  it("🔒 counts an absent cursor (the denominator)", () => {
    expect(acceptChannelCursor(undefined, CHANNEL, USER, T)).toBeUndefined();
    expect(lines()).toEqual([
      "[cursor-form] surface=channel-await form=absent advertised=yes",
    ]);
  });

  it("🔒 counts a refused string as `other` BEFORE the refusal throws", () => {
    expect(() => acceptChannelCursor("12abc", CHANNEL, USER, T)).toThrow(
      ChannelCursorUndecodableError,
    );
    expect(lines()).toEqual([
      "[cursor-form] surface=channel-await form=other advertised=yes",
    ]);
  });

  it("🔒 counts a token that then fails to decode as `token`", () => {
    const foreign = encodeChannelCursor(9, { kind: "account" }, USER);
    expect(() => acceptChannelCursor(foreign, CHANNEL, USER, T)).toThrow(
      ChannelCursorUndecodableError,
    );
    expect(lines()).toEqual([
      "[cursor-form] surface=channel-await form=token advertised=yes",
    ]);
  });

  it("counts a decoded token and an integer once each", () => {
    const token = encodeChannelCursor(5, CHANNEL, USER);
    expect(acceptChannelCursor(token, CHANNEL, USER, T)).toBe(5);
    expect(acceptChannelCursor(5, CHANNEL, USER, T)).toBe(5);
    expect(lines()).toEqual([
      "[cursor-form] surface=channel-await form=token advertised=yes",
      "[cursor-form] surface=channel-await form=integer advertised=yes",
    ]);
  });
});
