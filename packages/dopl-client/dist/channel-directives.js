"use strict";
/**
 * THE DIRECTIVE LANES — what a channel client can ASK AN OPERATOR'S OWN DESKTOP to do:
 * the LAUNCH mailbox (launch / end / rename, 2026-08-22) and the PRIVATE DIRECT lane
 * (2026-08-31).
 *
 * ⚠ **ITS OWN MODULE BECAUSE `channel.ts` IS AT THE 500-LINE CAP** (§1; the `size-check`
 * CI job and `max-lines` in `eslint.config.mjs`, F-689). The seam is the one the file
 * already drew with a banner comment: everything above it is a channel's OWN rows —
 * messages, threads, artifacts, members — and everything here is a REQUEST TO A MACHINE
 * that the server only files.
 *
 * ⚠ **RE-EXPORTED UNCHANGED FROM `channel.ts`, SO NO CALLER MOVED**, the same discipline
 * `channel-artifact-types.ts` follows on the type side.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLaunchDirective = createLaunchDirective;
exports.createAgentDirective = createAgentDirective;
exports.getLaunchDirective = getLaunchDirective;
exports.createAgentDirection = createAgentDirection;
exports.getAgentDirection = getAgentDirection;
exports.listAgentDirections = listAgentDirections;
const enc = encodeURIComponent;
// ─── Launch directives (launch-over-MCP, 2026-08-22) ────────────────
/**
 * ASK THE OPERATOR'S OWN DESKTOP TO START AN AGENT.
 *
 * ⚠ A REQUEST, NOT A COMMAND. The server files a row; the machine decides. The
 * `offline` branch means the machine is not listening and NOTHING WAS FILED.
 * ⚠ There is no operator argument, by design — see
 * {@link LaunchDirectiveCreateInput}.
 */
async function createLaunchDirective(t, input) {
    return t.request("/api/channels/launch-directives", {
        method: "POST",
        body: input,
        toolName: "channel_launch_agent",
    });
}
/**
 * ASK THE OPERATOR'S OWN DESKTOP TO **END** OR **RENAME** ONE OF ITS AGENTS
 * (2026-09-01).
 *
 * ⚠ **THE SAME MAILBOX, A DIFFERENT KIND — so the result is a `LaunchDirective`
 * and `getLaunchDirective` polls it.** There is no second lane and no second poll
 * endpoint; only the CREATE body differs, because a launch's shape (goal, model,
 * identity) and an end's (which agent) have nothing in common.
 * ⚠ A REQUEST, NOT A COMMAND, exactly as a launch is. `offline` means the machine
 * is not listening and NOTHING WAS FILED.
 * ⚠ **NO LAUNCH TOGGLE APPLIES TO THESE TWO.** The desktop's launch-over-MCP
 * setting gates `launch_agent` and neither of these; do not tell a caller to turn
 * it on because an end was refused.
 */
async function createAgentDirective(t, input) {
    return t.request("/api/channels/launch-directives/agent", {
        method: "POST",
        body: input,
        toolName: "channel_agent_directive",
    });
}
/**
 * POLL ONE DIRECTIVE — what a bounded hold reads while the desktop decides.
 *
 * ⚠ COARSE POLLING ONLY (1-2s). A directive lives at most two minutes and the
 * decision is a human-scale toggle plus a process spawn; polling faster buys
 * nothing and multiplies requests across every armed launch.
 * ⚠ Another operator's directive answers 404, indistinguishable from absent.
 */
async function getLaunchDirective(t, id) {
    const data = await t.request(`/api/channels/launch-directives/${enc(id)}`, { toolName: "channel_launch_poll" });
    return data.directive;
}
// ── THE PRIVATE DIRECT LANE (2026-08-31) ───────────────────────────────────
//
// ⚠ THE SIBLING OF THE LAUNCH MAILBOX ABOVE, AND NOT A MODE OF IT. A launch asks
// for a PROCESS; a direction asks an EXISTING one to hear something privately.
// ⚠ `claim` AND `decide` ARE DELIBERATELY ABSENT, exactly as they are for
// launches: those two routes are consumed only by the DESKTOP, which addresses
// them by path from `main/agent-direction-wire.js`. Binding them on this client
// would publish verbs the MCP surface must never be able to reach.
async function createAgentDirection(t, input) {
    return t.request("/api/channels/agent-directions", {
        method: "POST",
        body: input,
        toolName: "channel_direct_agent",
    });
}
async function getAgentDirection(t, id) {
    const data = await t.request(`/api/channels/agent-directions/${enc(id)}`, { toolName: "channel_direct_poll" });
    return data.direction;
}
/** The caller's own recent directions — what `op="read_directions"` renders.
 *  ⚠ TERMINAL ROWS INCLUDED, unlike the desktop's backstop read: the `reply` is
 *  the whole reason this op exists. */
async function listAgentDirections(t, query = {}) {
    const params = new URLSearchParams();
    if (query.channel)
        params.set("channel", query.channel);
    if (query.agent)
        params.set("agent", query.agent);
    const qs = params.toString();
    const data = await t.request(`/api/channels/agent-directions/recent${qs ? `?${qs}` : ""}`, { toolName: "channel_read_directions" });
    return data.directions;
}
