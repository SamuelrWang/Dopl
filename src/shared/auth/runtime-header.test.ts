/**
 * `X-Dopl-Runtime` — the header reader and the credential bound.
 *
 * The module is two functions with one job between them: say what the header
 * CLAIMED, and say what the server is willing to STAMP for the credential that
 * presented it. Splitting them is the whole design — `/api/mcp` forwards the
 * claim verbatim onto its loopback and the narrowing happens THERE, where the
 * caller's own token is known, so this file pins that neither half quietly
 * grows the other's responsibility.
 *
 * WHY THE BOUND IS ASYMMETRIC (2026-08-05, docs/CHANNELS-ROLLBACK-PLAN.md §3.4).
 * `desktop-session` labels a session the desktop SPAWNED, which authenticates
 * with the device's OAuth token — so requiring a session credential there would
 * refuse the exact caller the value exists for. `desktop-ui` labels a PERSON
 * typing in the app's own UI window, whose posts leave main on the operator's
 * own session credential, so an agent token claiming it is refused. That
 * refusal is what keeps an external MCP post from acquiring the requester
 * window the operator's own typing gets.
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
    // The seam that lets `/api/mcp` forward a caller's claim onto the loopback
    // without deciding anything about it. If this ever started refusing
    // desktop-ui, the narrowing below would be doing its work twice in one
    // place and not at all in the other.
    expect(readRuntimeHeader(req(DESKTOP_UI_RUNTIME))).toBe("desktop-ui");
  });
});

describe("narrowRuntime — the VERDICT", () => {
  const session = { agentCredential: false };
  const agent = { agentCredential: true };

  it("desktop-session passes on the header alone, agent credential included", () => {
    // Its whole population IS agent tokens: sdk-loader puts the header on the
    // device credential every spawned session's MCP entry carries.
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
