"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const vitest_1 = require("vitest");
const channel_await_budget_1 = require("./channel-await-budget");
// ── The env-tunable hold (incident lever) ───────────────────────────────
(0, vitest_1.describe)("resolveAwaitHoldMs — DOPL_AWAIT_HOLD_MS", () => {
    (0, vitest_1.it)("defaults to the 215s default hold for anything unparseable", () => {
        for (const raw of [undefined, "", "   ", "abc", "120s", "12.5", "-1", "1e5"]) {
            (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)(raw)).toBe(215_000);
        }
    });
    (0, vitest_1.it)("takes an integer value and clamps it into [50s, the cap]", () => {
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)("90000")).toBe(90_000);
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)(" 90000 ")).toBe(90_000);
        // Below the floor a hold can never cross the 2-minute backgrounding mark,
        // so the lever may SHORTEN the hold but never disable the wake outright.
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)("0")).toBe(50_000);
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)("1000")).toBe(50_000);
        // And it can never raise the hold past what the route's maxDuration covers.
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)("600000")).toBe(channel_await_budget_1.AWAIT_HOLD_CAP_MS);
        // The incident lever for a client-side call deadline: 55s fits every hold
        // under a 60s per-call abort (Q9) without disabling the op.
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldMs)("55000")).toBe(55_000);
    });
});
// ── Q9: the hold sits under every deadline around it ────────────────────
(0, vitest_1.describe)("await hold margin", () => {
    (0, vitest_1.it)("the DEFAULT hold clears the /api/mcp function ceiling with margin", () => {
        // The route authenticates, boots the server and runs a workspace handshake
        // before this op starts, and the platform clock covers all of it. A hold
        // sized up to the ceiling loses that race, and the caller then gets a raw
        // transport error — which carries NONE of the re-arm teaching that lives
        // in the graceful result.
        const held = (0, channel_await_budget_1.resolveAwaitHoldMs)(undefined);
        (0, vitest_1.expect)(held).toBe(215_000);
        (0, vitest_1.expect)(held).toBe(channel_await_budget_1.AWAIT_HOLD_DEFAULT_MS);
        (0, vitest_1.expect)(held).toBeLessThan(channel_await_budget_1.MCP_ROUTE_MAX_DURATION_MS - channel_await_budget_1.AWAIT_HOLD_MARGIN_MS);
    });
    (0, vitest_1.it)("FIX M3: the margin covers the CAP too, not only the default", () => {
        // The default was the only thing this relation was asserted against, so the
        // cap had quietly drifted to 240s — where cap + margin is EXACTLY the route
        // ceiling, i.e. no margin at all — and any caller could reach it by passing
        // `timeout_ms` explicitly. The reachable maximum is what has to fit.
        (0, vitest_1.expect)(channel_await_budget_1.AWAIT_HOLD_CAP_MS).toBe(230_000);
        (0, vitest_1.expect)(channel_await_budget_1.AWAIT_HOLD_CAP_MS).toBeLessThanOrEqual(channel_await_budget_1.MCP_ROUTE_MAX_DURATION_MS - channel_await_budget_1.AWAIT_HOLD_MARGIN_MS);
        // ...and the cap is still long enough to be a wake: a hold has to outlast
        // the ~2min backgrounding mark or the whole primitive is gone.
        (0, vitest_1.expect)(channel_await_budget_1.AWAIT_HOLD_CAP_MS).toBeGreaterThan(120_000);
        (0, vitest_1.expect)(channel_await_budget_1.AWAIT_HOLD_DEFAULT_MS).toBeLessThanOrEqual(channel_await_budget_1.AWAIT_HOLD_CAP_MS);
    });
    (0, vitest_1.it)("FIX M3: the tool schema and its description advertise the same cap", () => {
        // Three literals used to say 240000 independently. A cap the schema accepts
        // but the deadline chain does not cover is the bug this pins shut.
        const toolSrc = (0, node_fs_1.readFileSync)(node_path_1.default.resolve(process.cwd(), "src", "tools", "channel.ts"), "utf8");
        (0, vitest_1.expect)(toolSrc).toMatch(/\.max\(AWAIT_HOLD_CAP_MS\)/);
        (0, vitest_1.expect)(toolSrc).not.toMatch(/240_000|240000/);
        // The agent-facing text is generated from the constants, not retyped.
        (0, vitest_1.expect)(toolSrc).toMatch(/max \$\{AWAIT_HOLD_CAP_MS\}/);
        (0, vitest_1.expect)(toolSrc).toMatch(/<=\$\{AWAIT_HOLD_CAP_MS\}/);
    });
    (0, vitest_1.it)("pins the mirrored route ceiling against the route's own maxDuration", () => {
        // MCP_ROUTE_MAX_DURATION_MS is a copy of `export const maxDuration` in
        // src/app/api/mcp/route.ts. If that route is retuned this fails, instead of
        // the margin silently becoming fiction.
        const routeSrc = (0, node_fs_1.readFileSync)(node_path_1.default.resolve(process.cwd(), "..", "..", "src", "app", "api", "mcp", "route.ts"), "utf8");
        const declared = /export const maxDuration = (\d+)/.exec(routeSrc);
        (0, vitest_1.expect)(declared, "maxDuration not found in src/app/api/mcp/route.ts").not.toBeNull();
        (0, vitest_1.expect)(Number(declared[1]) * 1_000).toBe(channel_await_budget_1.MCP_ROUTE_MAX_DURATION_MS);
    });
    (0, vitest_1.it)("an explicit ask may still reach the cap, but the env lever wins", () => {
        // The default is a DEFAULT, not a ceiling — a caller who deliberately asks
        // for the cap gets it...
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldCeilingMs)(undefined)).toBe(channel_await_budget_1.AWAIT_HOLD_CAP_MS);
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldCeilingMs)("  ")).toBe(channel_await_budget_1.AWAIT_HOLD_CAP_MS);
        // ...but the incident lever is a real ceiling, or an explicit `timeout_ms`
        // at the cap would route straight around the thing shortening holds.
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldCeilingMs)("55000")).toBe(55_000);
        (0, vitest_1.expect)((0, channel_await_budget_1.resolveAwaitHoldCeilingMs)("600000")).toBe(channel_await_budget_1.AWAIT_HOLD_CAP_MS);
    });
    (0, vitest_1.it)("one inner poll stays under the client + route bounds beneath it", () => {
        // The inner chain: the op's 50s poll < @dopl/client's 55s network timeout <
        // the /api/channels/[id]/await route's own 60s maxDuration. Each layer has
        // to be able to answer before the one above it gives up, or the graceful
        // empty result is replaced by an abort at every level.
        const clientSrc = (0, node_fs_1.readFileSync)(node_path_1.default.resolve(process.cwd(), "..", "dopl-client", "src", "channel.ts"), "utf8");
        const netTimeout = /AWAIT_TIMEOUT_MS = (\d+)_(\d+)/.exec(clientSrc);
        (0, vitest_1.expect)(netTimeout, "AWAIT_TIMEOUT_MS not found in @dopl/client channel.ts").not.toBeNull();
        const netMs = Number(`${netTimeout[1]}${netTimeout[2]}`);
        (0, vitest_1.expect)(netMs).toBe(55_000);
        (0, vitest_1.expect)(channel_await_budget_1.AWAIT_POLL_MS).toBeLessThan(netMs);
    });
});
