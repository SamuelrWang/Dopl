"use strict";
// Directive rows and client stubs for the channel launch / agent-op suites; not a *.test.ts (imported, never run), excluded from the package build.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAUNCH = exports.launchText = exports.renameText = exports.endText = exports.settledMode = exports.settled = exports.polls = exports.created = exports.modeDirective = exports.agentDirective = exports.launched = exports.DIRECTIVE_ID = exports.AGENT = exports.CHANNEL_ROW = exports.CHANNEL = void 0;
exports.directive = directive;
exports.launchClient = launchClient;
exports.agentClient = agentClient;
const vitest_1 = require("vitest");
const channel_ops_agent_1 = require("./channel-ops-agent");
const channel_ops_launch_1 = require("./channel-ops-launch");
exports.CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };
/** The full channel row, for suites driven through `registerChannelTool`. */
exports.CHANNEL_ROW = {
    ...exports.CHANNEL,
    workspaceId: "ws-1",
    topic: "",
    visibility: "private",
    createdBy: "u1",
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
};
exports.AGENT = "a1b2c3d4";
exports.DIRECTIVE_ID = "55555555-5555-5555-5555-555555555555";
/** A pending launch row; the fields it omits stay absent, as on an older server's row. */
function directive(over = {}) {
    return {
        id: exports.DIRECTIVE_ID,
        channelId: exports.CHANNEL.id,
        threadId: null,
        goal: "ship the parser",
        model: null,
        status: "pending",
        identityId: null,
        identityName: null,
        refusalReason: null,
        agentId: null,
        claimedAt: null,
        decidedAt: null,
        expiresAt: "2026-08-22T12:02:00.000Z",
        createdAt: "2026-08-22T12:00:00.000Z",
        ...over,
    };
}
const launched = (over = {}) => directive({ status: "launched", agentId: "abcd1234", ...over });
exports.launched = launched;
/** A pending `end` row aimed at {@link AGENT}; pass `kind` for another verb. */
const agentDirective = (over = {}) => directive({
    kind: "end",
    operatorUserId: "user-1",
    goal: null,
    targetAgentId: exports.AGENT,
    targetName: null,
    ...over,
});
exports.agentDirective = agentDirective;
/** A pending `set_agent_mode` row: every posture column present, the echo columns null. */
const modeDirective = (over = {}) => (0, exports.agentDirective)({
    kind: "set_agent_mode",
    startToolMode: null,
    startMessageMode: null,
    chain: null,
    targetToolMode: "auto",
    targetMessageMode: null,
    appliedToolMode: null,
    appliedMessageMode: null,
    appliedChain: null,
    ...over,
});
exports.modeDirective = modeDirective;
function launchClient(over = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [exports.CHANNEL]),
        createLaunchDirective: vitest_1.vi.fn(async () => ({ offline: false, directive: directive() })),
        getLaunchDirective: vitest_1.vi.fn(async () => directive()),
        ...over,
    };
}
/** A client whose launch create already answers with this row (no poll needed). */
const created = (over) => launchClient({
    createLaunchDirective: vitest_1.vi.fn(async () => ({ offline: false, directive: directive(over) })),
});
exports.created = created;
/** A client whose launch create stays pending and whose poll answers with this row. */
const polls = (over) => launchClient({ getLaunchDirective: vitest_1.vi.fn(async () => directive(over)) });
exports.polls = polls;
function agentClient(over = {}) {
    return {
        listChannels: vitest_1.vi.fn(async () => [exports.CHANNEL]),
        createAgentDirective: vitest_1.vi.fn(async () => ({ offline: false, directive: (0, exports.agentDirective)() })),
        getLaunchDirective: vitest_1.vi.fn(async () => (0, exports.agentDirective)()),
        ...over,
    };
}
/** A client whose agent-op create answers with a settled row, so no hold runs. */
const settled = (over, row = exports.agentDirective) => agentClient({
    createAgentDirective: vitest_1.vi.fn(async () => ({ offline: false, directive: row(over) })),
});
exports.settled = settled;
const settledMode = (over) => (0, exports.settled)(over, exports.modeDirective);
exports.settledMode = settledMode;
const endText = async (c) => (await (0, channel_ops_agent_1.opEndAgent)(c, "general", exports.AGENT, { waitMs: 0 })).content[0].text;
exports.endText = endText;
const renameText = async (c, name = "Research") => (await (0, channel_ops_agent_1.opRenameAgent)(c, "general", exports.AGENT, name, { waitMs: 0 })).content[0].text;
exports.renameText = renameText;
// `name` is required: a launch without it measures the missing-param refusal, not the case's subject.
const launchText = async (c, opts = {}) => (await (0, channel_ops_launch_1.opLaunchAgent)(c, "general", { name: "Scout", ...opts })).content[0].text;
exports.launchText = launchText;
/** `dopl_channel` args for a launch through the dispatcher. */
exports.LAUNCH = {
    op: "manage",
    action: "launch",
    channel: "general",
    name: "Scout",
    body: "ship it",
    wait_ms: 0,
};
