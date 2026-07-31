/**
 * THE DEADLINE CHAIN around `dopl_channel(op="await")` — the numbers in
 * `channel-await-budget.ts`, pinned against the layers they have to fit under.
 * Split out of `channel-wake.test.ts` at the §2 500-line cap.
 *
 * What is pinned here:
 *   - the DEFAULT hold clears the /api/mcp function ceiling with margin (Q9);
 *   - the mirrored route ceiling still matches the route's own maxDuration;
 *   - the env lever is a real ceiling, so `timeout_ms` cannot route around it,
 *     while an explicit ask can still reach the cap;
 *   - the CAP clears the route ceiling by the same margin the default does
 *     (FIX M3 — it did not, and only the default was ever asserted);
 *   - one inner poll answers before the client + route bounds beneath it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  AWAIT_HOLD_CAP_MS,
  AWAIT_HOLD_DEFAULT_MS,
  AWAIT_HOLD_MARGIN_MS,
  AWAIT_POLL_MS,
  MCP_ROUTE_MAX_DURATION_MS,
  resolveAwaitHoldCeilingMs,
  resolveAwaitHoldMs,
} from "./channel-await-budget";


// ── The env-tunable hold (incident lever) ───────────────────────────────

describe("resolveAwaitHoldMs — DOPL_AWAIT_HOLD_MS", () => {
  it("defaults to the 215s default hold for anything unparseable", () => {
    for (const raw of [undefined, "", "   ", "abc", "120s", "12.5", "-1", "1e5"]) {
      expect(resolveAwaitHoldMs(raw)).toBe(215_000);
    }
  });

  it("takes an integer value and clamps it into [50s, the cap]", () => {
    expect(resolveAwaitHoldMs("90000")).toBe(90_000);
    expect(resolveAwaitHoldMs(" 90000 ")).toBe(90_000);
    // Below the floor a hold can never cross the 2-minute backgrounding mark,
    // so the lever may SHORTEN the hold but never disable the wake outright.
    expect(resolveAwaitHoldMs("0")).toBe(50_000);
    expect(resolveAwaitHoldMs("1000")).toBe(50_000);
    // And it can never raise the hold past what the route's maxDuration covers.
    expect(resolveAwaitHoldMs("600000")).toBe(AWAIT_HOLD_CAP_MS);
    // The incident lever for a client-side call deadline: 55s fits every hold
    // under a 60s per-call abort (Q9) without disabling the op.
    expect(resolveAwaitHoldMs("55000")).toBe(55_000);
  });
});

// ── Q9: the hold sits under every deadline around it ────────────────────

describe("await hold margin", () => {
  it("the DEFAULT hold clears the /api/mcp function ceiling with margin", () => {
    // The route authenticates, boots the server and runs a workspace handshake
    // before this op starts, and the platform clock covers all of it. A hold
    // sized up to the ceiling loses that race, and the caller then gets a raw
    // transport error — which carries NONE of the re-arm teaching that lives
    // in the graceful result.
    const held = resolveAwaitHoldMs(undefined);
    expect(held).toBe(215_000);
    expect(held).toBe(AWAIT_HOLD_DEFAULT_MS);
    expect(held).toBeLessThan(MCP_ROUTE_MAX_DURATION_MS - AWAIT_HOLD_MARGIN_MS);
  });

  it("FIX M3: the margin covers the CAP too, not only the default", () => {
    // The default was the only thing this relation was asserted against, so the
    // cap had quietly drifted to 240s — where cap + margin is EXACTLY the route
    // ceiling, i.e. no margin at all — and any caller could reach it by passing
    // `timeout_ms` explicitly. The reachable maximum is what has to fit.
    expect(AWAIT_HOLD_CAP_MS).toBe(230_000);
    expect(AWAIT_HOLD_CAP_MS).toBeLessThanOrEqual(
      MCP_ROUTE_MAX_DURATION_MS - AWAIT_HOLD_MARGIN_MS,
    );
    // ...and the cap is still long enough to be a wake: a hold has to outlast
    // the ~2min backgrounding mark or the whole primitive is gone.
    expect(AWAIT_HOLD_CAP_MS).toBeGreaterThan(120_000);
    expect(AWAIT_HOLD_DEFAULT_MS).toBeLessThanOrEqual(AWAIT_HOLD_CAP_MS);
  });

  it("FIX M3: the tool schema and its description advertise the same cap", () => {
    // Three literals used to say 240000 independently. A cap the schema accepts
    // but the deadline chain does not cover is the bug this pins shut.
    const toolSrc = readFileSync(
      path.resolve(process.cwd(), "src", "tools", "channel.ts"),
      "utf8",
    );
    expect(toolSrc).toMatch(/\.max\(AWAIT_HOLD_CAP_MS\)/);
    expect(toolSrc).not.toMatch(/240_000|240000/);
    // The agent-facing text is generated from the constants, not retyped.
    expect(toolSrc).toMatch(/max \$\{AWAIT_HOLD_CAP_MS\}/);
    expect(toolSrc).toMatch(/<=\$\{AWAIT_HOLD_CAP_MS\}/);
  });

  it("pins the mirrored route ceiling against the route's own maxDuration", () => {
    // MCP_ROUTE_MAX_DURATION_MS is a copy of `export const maxDuration` in
    // src/app/api/mcp/route.ts. If that route is retuned this fails, instead of
    // the margin silently becoming fiction.
    const routeSrc = readFileSync(
      path.resolve(process.cwd(), "..", "..", "src", "app", "api", "mcp", "route.ts"),
      "utf8",
    );
    const declared = /export const maxDuration = (\d+)/.exec(routeSrc);
    expect(declared, "maxDuration not found in src/app/api/mcp/route.ts").not.toBeNull();
    expect(Number(declared![1]) * 1_000).toBe(MCP_ROUTE_MAX_DURATION_MS);
  });

  it("an explicit ask may still reach the cap, but the env lever wins", () => {
    // The default is a DEFAULT, not a ceiling — a caller who deliberately asks
    // for the cap gets it...
    expect(resolveAwaitHoldCeilingMs(undefined)).toBe(AWAIT_HOLD_CAP_MS);
    expect(resolveAwaitHoldCeilingMs("  ")).toBe(AWAIT_HOLD_CAP_MS);
    // ...but the incident lever is a real ceiling, or an explicit `timeout_ms`
    // at the cap would route straight around the thing shortening holds.
    expect(resolveAwaitHoldCeilingMs("55000")).toBe(55_000);
    expect(resolveAwaitHoldCeilingMs("600000")).toBe(AWAIT_HOLD_CAP_MS);
  });

  it("one inner poll stays under the client + route bounds beneath it", () => {
    // The inner chain: the op's 50s poll < @dopl/client's 55s network timeout <
    // the /api/channels/[id]/await route's own 60s maxDuration. Each layer has
    // to be able to answer before the one above it gives up, or the graceful
    // empty result is replaced by an abort at every level.
    const clientSrc = readFileSync(
      path.resolve(process.cwd(), "..", "dopl-client", "src", "channel.ts"),
      "utf8",
    );
    const netTimeout = /AWAIT_TIMEOUT_MS = (\d+)_(\d+)/.exec(clientSrc);
    expect(netTimeout, "AWAIT_TIMEOUT_MS not found in @dopl/client channel.ts").not.toBeNull();
    const netMs = Number(`${netTimeout![1]}${netTimeout![2]}`);
    expect(netMs).toBe(55_000);
    expect(AWAIT_POLL_MS).toBeLessThan(netMs);
  });
});
