/**
 * THE DEADLINE CHAIN around `dopl_channel(op="read", wait_ms=…)` — the numbers in
 * `channel-hold-budget.ts`, pinned against the layers they must fit under:
 *   - the DEFAULT hold clears the /api/mcp function ceiling with margin (Q9);
 *   - the mirrored route ceiling still matches the route's own maxDuration;
 *   - the env lever is a real ceiling, so `wait_ms` cannot route around it,
 *     while an explicit ask can still reach the cap;
 *   - the CAP clears the route ceiling by the same margin the default does
 *     (FIX M3 — it did not, and only the default was ever asserted);
 *   - one inner poll answers before the client + route bounds beneath it.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  HOLD_CAP_MS,
  HOLD_DEFAULT_MS,
  HOLD_MARGIN_MS,
  HOLD_POLL_MS,
  MCP_ROUTE_MAX_DURATION_MS,
  resolveHoldCeilingMs,
  resolveHoldMs,
} from "./channel-hold-budget";
// ⚠ The tool's file set is DISCOVERED (shared with parity.test.ts), never typed
// out here.
import { sourceOf, toolGroupFiles } from "./tool-group-files.js";
// ⚠ THE CAP'S AGENT-FACING HOME SINCE B8 (2026-09-02) — it is the PUBLISHED
// SCHEMA's `maximum` keyword on `wait_ms`. T82 moved the prose out of the
// description into the doctrine; B8 took it out of the doctrine too, because
// `channel-schema.ts`'s header now forbids any `.describe()` or rule text from
// hand-typing a bound the schema itself publishes. So the assertion follows the
// number to the surface that still carries it, and is still computed off the
// constant.
import { z } from "zod";
import { CHANNEL_INPUT_SHAPE } from "./channel-schema";


// ── The env-tunable hold (incident lever) ───────────────────────────────

describe("resolveHoldMs — DOPL_AWAIT_HOLD_MS", () => {
  it("defaults to the 215s default hold for anything unparseable", () => {
    for (const raw of [undefined, "", "   ", "abc", "120s", "12.5", "-1", "1e5"]) {
      expect(resolveHoldMs(raw)).toBe(215_000);
    }
  });

  it("takes an integer value and clamps it into [50s, the cap]", () => {
    expect(resolveHoldMs("90000")).toBe(90_000);
    expect(resolveHoldMs(" 90000 ")).toBe(90_000);
    // ⚠ Below the floor a hold never crosses the 2-min backgrounding mark — the
    // lever may SHORTEN the hold, never disable the wake.
    expect(resolveHoldMs("0")).toBe(50_000);
    expect(resolveHoldMs("1000")).toBe(50_000);
    expect(resolveHoldMs("600000")).toBe(HOLD_CAP_MS);
    // Incident lever for a client-side call deadline: 55s fits every hold under
    // a 60s per-call abort without disabling the op.
    expect(resolveHoldMs("55000")).toBe(55_000);
  });
});

// ── Q9: the hold sits under every deadline around it ────────────────────

describe("await hold margin", () => {
  it("the DEFAULT hold clears the /api/mcp function ceiling with margin", () => {
    // ⚠ The route authenticates, boots the server and runs a workspace
    // handshake before this op starts, all under the platform clock — a hold
    // sized to the ceiling loses that race and yields a raw transport error
    // carrying NONE of the re-arm teaching.
    const held = resolveHoldMs(undefined);
    expect(held).toBe(215_000);
    expect(held).toBe(HOLD_DEFAULT_MS);
    expect(held).toBeLessThan(MCP_ROUTE_MAX_DURATION_MS - HOLD_MARGIN_MS);
  });

  it("FIX M3: the margin covers the CAP too, not only the default", () => {
    // ⚠ Assert against the CAP, not just the default: the cap is reachable via
    // an explicit `wait_ms`, and the reachable maximum is what has to fit.
    expect(HOLD_CAP_MS).toBe(230_000);
    expect(HOLD_CAP_MS).toBeLessThanOrEqual(
      MCP_ROUTE_MAX_DURATION_MS - HOLD_MARGIN_MS,
    );
    // ⚠ …and long enough to still BE a wake — a hold must outlast the ~2 min
    // backgrounding mark.
    expect(HOLD_CAP_MS).toBeGreaterThan(120_000);
    expect(HOLD_DEFAULT_MS).toBeLessThanOrEqual(HOLD_CAP_MS);
  });

  it("FIX M3: the tool schema PUBLISHES the cap, and no file retypes it", () => {
    // ⚠ A cap the schema accepts but the deadline chain does not cover is the
    // bug this pins shut, so no file may retype the literal.
    //
    // ⚠ The file list is DISCOVERED, not typed: a hardcoded list lets the next
    // module split carry the cap into a file this scan does not read.
    // `channel-hold-budget.ts` is the ONLY exclusion — the constant lives
    // there; every other file must reach the number through it.
    const surface = toolGroupFiles("channel.ts").filter(
      (f) => f !== "channel-hold-budget.ts",
    );
    // ⚠ Sanity: a rename dropping the `channel-` prefix empties this scan
    // silently.
    expect(surface).toContain("channel-schema.ts");
    expect(surface).toContain("channel-description.ts");
    const toolSrc = surface.map(sourceOf).join("\n");
    expect(toolSrc).toMatch(/\.max\(HOLD_CAP_MS\)/);
    expect(toolSrc).not.toMatch(/240_000|240000/);
    // ⚠ **THE `.describe()` HALF LEFT ON 2026-09-02 (A14), AND THIS IS WHERE
    // THAT DECISION IS RECORDED.** It asserted `max ${HOLD_CAP_MS}` in
    // `timeout_ms`'s own describe text. Interpolated, so it never drifted — but
    // the number ALSO reaches the client as the schema's `maximum` keyword and,
    // where it is worth stating, once more in the rendered `Limits:` line, and
    // `tool-style.ts › renderLimits` is now the ONE place a bound becomes prose.
    // Three copies of one fact on every connection is what that rule exists to
    // refuse, so the describe carries none.
    // ⚠ NOTHING IS UNPINNED BY THE REMOVAL. `.max(HOLD_CAP_MS)` above is
    // what actually publishes the number, the literal ban below it is
    // unchanged, and the doctrine assertion at the end is computed off the
    // constant — all three still fail the moment the cap is retuned.
    // ⚠ THE ADVERTISED HALF MOVED AGAIN, SO THE ASSERTION FOLLOWED IT (B8,
    // 2026-09-02). T82 moved the cap's prose from `CHANNEL_DESCRIPTION` into the
    // doctrine, where this pinned `cap ${seconds}s`. B8 deleted that sentence
    // rather than re-spelling it: `channel-schema.ts` now forbids prose from
    // hand-typing a bound the schema publishes, and `wait_ms` (which absorbed
    // `timeout_ms`) carries `.max(HOLD_CAP_MS)`, so the number reaches
    // every client as the JSON Schema `maximum` keyword. Pinned on the PUBLISHED
    // schema — the exact conversion `tools/list` renders — and still computed
    // off the constant, so a hand-typed number fails the moment the cap is
    // retuned.
    const published = z.toJSONSchema(z.object(CHANNEL_INPUT_SHAPE), {
      io: "input",
    }) as { properties: Record<string, { maximum?: number }> };
    expect(published.properties.wait_ms.maximum).toBe(HOLD_CAP_MS);
  });

  it("pins the mirrored route ceiling against the route's own maxDuration", () => {
    // ⚠ MCP_ROUTE_MAX_DURATION_MS is a HAND COPY of `export const maxDuration`
    // in src/app/api/mcp/route.ts — retuning the route fails here instead of
    // making the margin fiction.
    const routeSrc = readFileSync(
      path.resolve(process.cwd(), "..", "..", "src", "app", "api", "mcp", "route.ts"),
      "utf8",
    );
    const declared = /export const maxDuration = (\d+)/.exec(routeSrc);
    expect(declared, "maxDuration not found in src/app/api/mcp/route.ts").not.toBeNull();
    expect(Number(declared![1]) * 1_000).toBe(MCP_ROUTE_MAX_DURATION_MS);
  });

  it("an explicit ask may still reach the cap, but the env lever wins", () => {
    // The default is a DEFAULT, not a ceiling...
    expect(resolveHoldCeilingMs(undefined)).toBe(HOLD_CAP_MS);
    expect(resolveHoldCeilingMs("  ")).toBe(HOLD_CAP_MS);
    // ⚠ ...but the incident lever IS a real ceiling, or an explicit
    // `wait_ms` routes straight around the thing shortening holds.
    expect(resolveHoldCeilingMs("55000")).toBe(55_000);
    expect(resolveHoldCeilingMs("600000")).toBe(HOLD_CAP_MS);
  });

  it("one inner poll stays under the client + route bounds beneath it", () => {
    // ⚠ Inner chain: op poll < @dopl/client network timeout < the await route's
    // maxDuration. Each layer must answer before the one above gives up, or the
    // graceful empty result is replaced by an abort.
    const clientSrc = readFileSync(
      path.resolve(process.cwd(), "..", "dopl-client", "src", "channel.ts"),
      "utf8",
    );
    const netTimeout = /AWAIT_TIMEOUT_MS = (\d+)_(\d+)/.exec(clientSrc);
    expect(netTimeout, "AWAIT_TIMEOUT_MS not found in @dopl/client channel.ts").not.toBeNull();
    const netMs = Number(`${netTimeout![1]}${netTimeout![2]}`);
    expect(netMs).toBe(55_000);
    expect(HOLD_POLL_MS).toBeLessThan(netMs);
  });
});
