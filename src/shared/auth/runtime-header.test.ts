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
  DESKTOP_SESSION_RUNTIME,
  DESKTOP_UI_RUNTIME,
  RUNTIME_HEADER,
  narrowRuntime,
  readRuntimeHeader,
} from "./runtime-header";

const req = (value?: string) => ({
  headers: new Headers(value === undefined ? {} : { [RUNTIME_HEADER]: value }),
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
