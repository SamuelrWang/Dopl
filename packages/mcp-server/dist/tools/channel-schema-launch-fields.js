"use strict";
/**
 * The `op="manage" action="launch"` shape fields. Spread LAST into `CHANNEL_INPUT_SHAPE` so the served
 * schema stays byte-stable (`channel-schema-budget.test.ts` and `tool-budget.test.ts` fail both ways).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LAUNCH_INPUT_FIELDS = void 0;
const zod_1 = require("zod");
const channel_ops_launch_color_1 = require("./channel-ops-launch-color");
exports.LAUNCH_INPUT_FIELDS = {
    model: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe(
    // An id the machine's runtime does not offer is refused `no-model` (`channel-doctrine.ts › MANAGE`).
    'op="manage" action="launch" (optional): the model to run the agent on. Omit for the identity\'s model, else the default.'),
    /** A free string on purpose: the desktop registry decides membership. Separate from `model`; neither is derived from the other. */
    runtime: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(32)
        .optional()
        .describe('op="manage" action="launch" (optional): WHICH RUNTIME, e.g. claude or codex — NOT a `model`, which picks a model inside it. Omit for the channel\'s own. One that machine cannot start is REFUSED, never swapped.'),
    // ID or exact name in one param, the idiom of `dopl_kb`'s `base`.
    identity: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(120)
        .optional()
        .describe(
    // The ID/NAME split mirrors `service-resolve-ref.ts › resolveIdentityRef`; pinned by `channel-ops-launch-body.test.ts`.
    'op="manage" action="launch" (optional): the AGENT IDENTITY the new agent runs as, under THE OPERATOR\'S visibility. An ID resolves wherever it lives; a NAME, in THIS CHANNEL\'S container. Omit for a blank agent.'),
    color: channel_ops_launch_color_1.AGENT_COLOR_FIELD,
    // `tools`: hand mirror of `src/features/channels/schema-launch-modes.ts › LAUNCH_TOOL_MODES` — the
    // levels first, then each runtime's own words. `chain` has three values because absent is not `off`.
    // ⚠ **THE PROSE MOVED TO `channel-doctrine.ts › FIELDS` (ASK 9, 2026-10-12), THE
    // SHAPE STAYED.** This param is PUSHED on every connection and its 922 bytes were
    // mostly these enums — which cannot move, they ARE the contract — plus four
    // descriptions. Grammar B's `cites` param needed room on this surface and the
    // ratchet's rule is that a rise is paid for by a fall on a pushed one, so the
    // explanatory half is now PULLED: every rule below still reaches an agent, through
    // the guide instead of every handshake. `channel-ops-agent-mode.test.ts` asserts
    // FIELDS still carries the clamp sentence, so this cannot quietly become a deletion.
    posture: zod_1.z
        .object({
        tools: zod_1.z
            .enum([
            "ask", "auto", "full",
            "manual", "accept_edits", "bypass",
            "untrusted", "granular", "on-request", "never",
            "allowlist", "auto-review", "run-everything",
        ])
            .optional(),
        messages: zod_1.z
            .enum(["ask", "auto_inbound", "auto_outbound", "auto_both"])
            .optional(),
        chain: zod_1.z.enum(["inherit", "on", "off"]).optional(),
    })
        .optional()
        .describe(
    // "how much freedom to ASK FOR" is pinned by phrase and stays HERE; the clamp
    // sentence it used to carry is pinned in FIELDS now.
    'op="manage" action="launch" / action="posture" (optional): how much freedom to ASK FOR — see FIELDS.'),
};
