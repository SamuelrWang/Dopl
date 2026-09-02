/**
 * THE SESSION WORKSPACE PIN (T41) — the store, and its fail-closed rules.
 *
 * ⚠ **WHAT THIS SUITE IS ABOUT IS THE FAILURE DIRECTION, NOT THE HAPPY PATH.**
 * A pin is a convenience; the thing that must hold is that every way of losing
 * one degrades to NO PIN — which is the pre-existing `WORKSPACE_REQUIRED`
 * refusal listing the caller's workspaces — and never to a pin pointing
 * somewhere the caller did not name. `session-pin-boot.test.ts` drives the same
 * rules through the REAL `bootServer` and the REAL `current_workspace` tool;
 * this file pins the store's own behaviour.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  SESSION_PIN_TTL_MS,
  clearSessionPin,
  readSessionPin,
  resetSessionPinsForTest,
  writeSessionPin,
} from "./session-pin.js";

beforeEach(() => {
  resetSessionPinsForTest();
});

describe("the session workspace pin", () => {
  it("reads back what it wrote, for that key alone", () => {
    expect(writeSessionPin("tok-a", "ws-1")).toBe(true);
    writeSessionPin("tok-b", "ws-2");
    expect(readSessionPin("tok-a")).toBe("ws-1");
    expect(readSessionPin("tok-b")).toBe("ws-2");
    // ⚠ A key nobody wrote is NO PIN, never another session's.
    expect(readSessionPin("tok-c")).toBeNull();
  });

  it("REFUSES a write with no session key rather than sharing a bucket", () => {
    // ⚠ The refusal is the point: a transport that cannot identify its session
    // has nowhere to store a default, and `meta-tools.ts` must RENDER that
    // rather than report a pin nothing stored.
    expect(writeSessionPin(undefined, "ws-1")).toBe(false);
    expect(writeSessionPin("", "ws-1")).toBe(false);
    expect(readSessionPin(undefined)).toBeNull();
    expect(readSessionPin("")).toBeNull();
  });

  it("expires past the TTL, and a read REFRESHES an active one", () => {
    const t0 = 1_000_000;
    writeSessionPin("tok-a", "ws-1", t0);

    // Just inside the window: still there, and this read moves the stamp.
    const midway = t0 + SESSION_PIN_TTL_MS - 1;
    expect(readSessionPin("tok-a", midway)).toBe("ws-1");

    // ⚠ Past the ORIGINAL write by nearly TWICE the TTL, but within one TTL of
    // the read above — an ACTIVE connection keeps its pin indefinitely, which is
    // the whole reason the TTL is an abuse bound rather than a session length.
    const secondTouch = midway + SESSION_PIN_TTL_MS - 1;
    expect(readSessionPin("tok-a", secondTouch)).toBe("ws-1");

    // Abandoned: a full TTL past the LAST touch, not past the first write.
    expect(readSessionPin("tok-a", secondTouch + SESSION_PIN_TTL_MS)).toBeNull();
    // ⚠ And the expired entry is GONE, not merely hidden — a second read must
    // not resurrect it by arriving with an earlier clock.
    expect(readSessionPin("tok-a", midway)).toBeNull();
  });

  it("clears, and says whether there was anything to clear", () => {
    writeSessionPin("tok-a", "ws-1");
    expect(clearSessionPin("tok-a")).toBe(true);
    expect(readSessionPin("tok-a")).toBeNull();
    // ⚠ Idempotent, and the second answer is FALSE so the tool can say "nothing
    // changed" instead of claiming it removed something.
    expect(clearSessionPin("tok-a")).toBe(false);
    expect(clearSessionPin(undefined)).toBe(false);
  });

  it("sweeps expired entries on write, so an abandoned key cannot accumulate", () => {
    const t0 = 1_000_000;
    writeSessionPin("stale", "ws-old", t0);
    // A later write sweeps: the expired row is dropped without anybody reading
    // it, which is what bounds the map for a process that never sees that
    // session again.
    writeSessionPin("fresh", "ws-new", t0 + SESSION_PIN_TTL_MS);
    expect(readSessionPin("stale", t0 + SESSION_PIN_TTL_MS)).toBeNull();
    expect(readSessionPin("fresh", t0 + SESSION_PIN_TTL_MS)).toBe("ws-new");
  });

  it("overwrites in place rather than stacking", () => {
    writeSessionPin("tok-a", "ws-1");
    writeSessionPin("tok-a", "ws-2");
    expect(readSessionPin("tok-a")).toBe("ws-2");
  });
});
