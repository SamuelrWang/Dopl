/**
 * `X-Dopl-Runtime` — the header reader and the credential bound.
 *
 * ⚠ Two functions, deliberately split: what the header CLAIMED vs what the
 * server will STAMP for the presenting credential. `/api/mcp` forwards the claim
 * verbatim onto its loopback and narrows THERE, where the caller's own token is
 * known. Neither half may grow the other's responsibility.
 *
 * ⚠ The bound is ASYMMETRIC: `desktop-session` authenticates with the device's
 * OAuth token, so requiring a session credential refuses the caller it exists
 * for; `desktop-ui` claims a PERSON typing in the app's UI on the operator's own
 * session credential, so an agent token claiming it is refused.
 */

import { describe, it, expect } from "vitest";
import {
  CLAUDE_VENDOR,
  CODEX_VENDOR,
  CURSOR_VENDOR,
  DESKTOP_SESSION_RUNTIME,
  DESKTOP_UI_RUNTIME,
  RUNTIME_HEADER,
  VENDOR_HEADER,
  narrowRuntime,
  narrowVendor,
  readRuntimeHeader,
  readVendorHeader,
} from "./runtime-header";

const req = (value?: string) => ({
  headers: new Headers(value === undefined ? {} : { [RUNTIME_HEADER]: value }),
});
const vendorReq = (value?: string) => ({
  headers: new Headers(value === undefined ? {} : { [VENDOR_HEADER]: value }),
});

describe("readRuntimeHeader — the CLAIM", () => {
  it("recognizes both values this app produces", () => {
    expect(readRuntimeHeader(req(DESKTOP_SESSION_RUNTIME))).toBe("desktop-session");
    expect(readRuntimeHeader(req(DESKTOP_UI_RUNTIME))).toBe("desktop-ui");
  });

  it("is undefined with no header at all (an external agent, a script)", () => {
    expect(readRuntimeHeader(req())).toBeUndefined();
  });

  it("exact match, no case folding, no prefixes", () => {
    for (const value of [
      "Desktop-Session",
      "DESKTOP-UI",
      "Desktop-UI",
      "desktop",
      "desktop-session-x",
      "desktop-ui-x",
      "desktop_ui",
      "external",
      "web",
      "",
    ]) {
      expect(readRuntimeHeader(req(value))).toBeUndefined();
    }
  });

  it("does NOT apply the credential bound — it has no credential to judge", () => {
    // ⚠ The seam letting `/api/mcp` forward a claim onto the loopback without
    // deciding anything. Refusing desktop-ui here would narrow twice in one
    // place and not at all in the other.
    expect(readRuntimeHeader(req(DESKTOP_UI_RUNTIME))).toBe("desktop-ui");
  });
});

describe("narrowRuntime — the VERDICT", () => {
  const session = { agentCredential: false };
  const agent = { agentCredential: true };

  it("desktop-session passes on the header alone, agent credential included", () => {
    // ⚠ Its whole population IS agent tokens.
    expect(narrowRuntime(DESKTOP_SESSION_RUNTIME, agent)).toBe("desktop-session");
    expect(narrowRuntime(DESKTOP_SESSION_RUNTIME, session)).toBe("desktop-session");
  });

  it("desktop-ui is stamped for a SESSION credential", () => {
    expect(narrowRuntime(DESKTOP_UI_RUNTIME, session)).toBe("desktop-ui");
  });

  it("desktop-ui is REFUSED for an agent credential — the honesty bound", () => {
    expect(narrowRuntime(DESKTOP_UI_RUNTIME, agent)).toBeUndefined();
  });

  it("fails closed on anything unrecognized, either credential", () => {
    for (const value of [
      undefined,
      null,
      "",
      "  desktop-ui  ",
      "Desktop-UI",
      "desktop",
      "external",
    ]) {
      expect(narrowRuntime(value, session)).toBeUndefined();
      expect(narrowRuntime(value, agent)).toBeUndefined();
    }
  });
});

/**
 * ⚠ CUSTODY AND VENDOR ARE TWO DIMENSIONS, and this block is the pin that keeps
 * them from collapsing into one (2026-08-31, runtime-adapter port step 1). The
 * failure it guards is silent: a vendor word admitted into the RUNTIME enum
 * would leave every non-Claude session stamped with a value that
 * `runtimeWord`, `channel-wake-guidance` and `targeting.js › DESKTOP_RUNTIMES`
 * all read as "not the desktop", changing what those sessions are taught and
 * whether a requester window opens — with nothing failing.
 */
describe("the VENDOR dimension is separate from the custody enum", () => {
  it("a vendor word is NOT a runtime value, on either reader", () => {
    for (const vendor of [CLAUDE_VENDOR, CODEX_VENDOR, CURSOR_VENDOR]) {
      expect(readRuntimeHeader(req(vendor))).toBeUndefined();
      expect(narrowRuntime(vendor, { agentCredential: false })).toBeUndefined();
      expect(narrowRuntime(vendor, { agentCredential: true })).toBeUndefined();
    }
  });

  it("a runtime word is NOT a vendor value, on either reader", () => {
    for (const runtime of [DESKTOP_SESSION_RUNTIME, DESKTOP_UI_RUNTIME]) {
      expect(readVendorHeader(vendorReq(runtime))).toBeUndefined();
      expect(narrowVendor(runtime)).toBeUndefined();
    }
  });

  it("recognizes the three vendors the port will register", () => {
    for (const vendor of [CLAUDE_VENDOR, CODEX_VENDOR, CURSOR_VENDOR]) {
      expect(readVendorHeader(vendorReq(vendor))).toBe(vendor);
      expect(narrowVendor(vendor)).toBe(vendor);
    }
  });

  it("absent stays absent — a custody stamp never implies a vendor", () => {
    // ⚠ The whole point of `null`-means-unknown: an older desktop build stamps
    // custody and no vendor, and defaulting that to `claude` is how a Codex
    // session gets taught a tool verb it does not have.
    expect(readVendorHeader(vendorReq())).toBeUndefined();
    expect(readVendorHeader({ headers: new Headers({ [RUNTIME_HEADER]: DESKTOP_SESSION_RUNTIME }) }))
      .toBeUndefined();
  });

  it("exact match, no case folding, no prefixes", () => {
    for (const value of ["Claude", "CODEX", "cursor-agent", "gpt", ""]) {
      expect(readVendorHeader(vendorReq(value))).toBeUndefined();
      expect(narrowVendor(value)).toBeUndefined();
    }
    // ⚠ Padding is NOT tested through the reader: `Headers` trims values on the
    // way in, so `"claude "` arrives as `claude` and would assert the opposite
    // of what it reads like. The narrower is where padding is really refused —
    // it takes the string as given, exactly as `narrowRuntime` does above.
    for (const value of ["  claude  ", "claude ", " codex", undefined, null]) {
      expect(narrowVendor(value)).toBeUndefined();
    }
  });
});
