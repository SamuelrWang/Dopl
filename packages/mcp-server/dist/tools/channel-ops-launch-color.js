"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGENT_COLOR_FIELD = exports.AGENT_COLOR_KEYS = void 0;
exports.asAgentColorKey = asAgentColorKey;
exports.freeColors = freeColors;
exports.colorTaken = colorTaken;
const zod_1 = require("zod");
const respond_1 = require("./respond");
/**
 * Agent colour for `manage action="launch"`: the sixteen keys, the published `color` field and the
 * 409 colour-taken refusal. A colour is a marker, never a status. Error `details` are duck-typed.
 */
/**
 * The sixteen keys in the server's pick order (the refusal's first free key is the one it would pick).
 * Hand mirror of `src/features/channels/lib/agent-colors.ts › AGENT_COLOR_KEYS`, held to the union by
 * `satisfies` and pinned by `channel-ops-launch-color.test.ts`. An enum: a published `pattern` is forbidden (`tool-style.test.ts`).
 */
exports.AGENT_COLOR_KEYS = [
    "agent-01", "agent-02", "agent-03", "agent-04",
    "agent-05", "agent-06", "agent-07", "agent-08",
    "agent-09", "agent-10", "agent-11", "agent-12",
    "agent-13", "agent-14", "agent-15", "agent-16",
];
/** Narrows (never casts) the dispatch arg; absent and unrecognized both mean the server picks the first free key. */
function asAgentColorKey(value) {
    return value && exports.AGENT_COLOR_KEYS.includes(value)
        ? value
        : undefined;
}
/** The 409's `details.free`, shape-checked; `[]` when absent or malformed. */
function freeColors(e) {
    const details = e?.details;
    const raw = details?.free;
    if (!Array.isArray(raw))
        return [];
    return raw.filter((c) => typeof c === "string" && c.length > 0);
}
/** `err`, because nothing was filed; lists the free keys and asks for the same `client_msg_id` on retry. */
function colorTaken(wanted, free) {
    const named = wanted ? `\`${wanted}\`` : "that colour";
    if (free.length === 0) {
        return (0, respond_1.err)(`No agent was requested — ${named} is already held by a live agent in this channel, and **nothing was filed**. Every one of the sixteen colours is currently out, so there is none to move to: re-issue WITHOUT \`color\` and the agent runs uncoloured (its posts still read as an agent's), or wait for an agent to end and free one.`);
    }
    return (0, respond_1.err)([
        `No agent was requested — ${named} is already held by a live agent in this channel, and **nothing was filed**. Colours are unique per channel across ALL members, so another member's agent may be wearing the one you asked for.`,
        `Re-issue with one of these, keeping the SAME \`client_msg_id\` so a retry cannot file twice:`,
        free.map((c) => `\`${c}\``).join(", "),
        `⚠ Or omit \`color\` entirely and the first free one is assigned — which is what you want unless the operator asked for a specific colour. A colour is only ever a marker, never a status.`,
    ].join("\n"));
}
/** The published `color` field (via `channel-schema-launch-fields.ts`); its standing rules live in `channel-doctrine.ts › FIELDS`. */
exports.AGENT_COLOR_FIELD = zod_1.z
    .enum(exports.AGENT_COLOR_KEYS)
    .optional()
    .describe('op="manage" action="launch" (optional): the agent\'s COLOUR — a marker, never a status. Omit for the first free key; a taken one is a 409.');
