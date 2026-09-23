"use strict";
/**
 * Requests to an operator's own desktop that the server only files: the launch mailbox (launch / end /
 * rename / set_agent_mode) and the private direct lane. Re-exported from `channel.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLaunchDirective = createLaunchDirective;
exports.createAgentDirective = createAgentDirective;
exports.getLaunchDirective = getLaunchDirective;
exports.createAgentDirection = createAgentDirection;
exports.getAgentDirection = getAgentDirection;
exports.listAgentDirections = listAgentDirections;
const enc = encodeURIComponent;
/** File a launch request; `offline` means nothing was filed. No operator argument, by design. */
async function createLaunchDirective(t, input) {
    return t.request("/api/channels/launch-directives", {
        method: "POST",
        body: input,
        toolName: "channel_launch_agent",
    });
}
/** File an end / rename / set_agent_mode on the same mailbox (`getLaunchDirective` polls it).
 *  The launch toggle does not gate end/rename, so never advise turning it on for their refusal. */
async function createAgentDirective(t, input) {
    return t.request("/api/channels/launch-directives/agent", {
        method: "POST",
        body: input,
        toolName: "channel_agent_directive",
    });
}
/** Poll one directive. Coarse polling only (1-2s); another operator's directive answers 404. */
async function getLaunchDirective(t, id) {
    const data = await t.request(`/api/channels/launch-directives/${enc(id)}`, { toolName: "channel_launch_poll" });
    return data.directive;
}
// The private direct lane. `claim`/`decide` are deliberately unbound: only the desktop calls them,
// by path, and the MCP surface must never reach those verbs.
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
/** The caller's own recent directions, terminal rows included (the `reply` is the point). */
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
