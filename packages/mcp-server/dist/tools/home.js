"use strict";
/**
 * `dopl_home` — THE CALLER'S OWN HOME CHANNELS, and the only surface that hands
 * out the handle every other tool takes as `workspace=` for one.
 *
 * ── WHY IT IS NOT `list_workspaces`, AND WHY IT IS NOT A DOMAIN TOOL ────────
 *
 * A home channel is a hidden `kind='link'` CONTAINER workspace. It is unlistable
 * BY DESIGN: `workspace-directory.ts › getWorkspaceList` filters through
 * `isStandardWorkspace`, and INVARIANTS §4A forbids advertising a container as a
 * workspace anywhere. **Do not loosen that predicate** — it is a positive test
 * precisely so a future `kind` cannot leak into it (F-295), and four consumers
 * share it. This tool answers containers as what they ARE to the operator:
 * home channels, each carrying the container id that addresses it.
 *
 * ⚠ IT REGISTERS ON THE META PATH BUT IS CHARGED (Samuel's ruling Q2 (b),
 * 2026-08-28). Meta, because the domain path injects a `workspace=` argument and
 * this is the tool that makes such an argument answerable — publishing one here
 * would be an argument that can only ever be wrong. Charged, because unlike the
 * two orientation tools it reads content-adjacent data and WRITES. The charge is
 * written explicitly in `registrar.ts › registerMetaTool`, not folded into a
 * shared wrapper.
 *
 * 🔒 THE LOCK. `home-scopes.ts › listHomeChannels` narrows to `lockedTo`; a
 * container-locked session sees exactly the room it is standing in and no
 * evidence that another exists. Reading `client.getHomeChannels()` directly from
 * here would void B3's whole point.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHomeTool = registerHomeTool;
const zod_1 = require("zod");
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
const home_scopes_js_1 = require("./home-scopes.js");
const tool_errors_js_1 = require("./tool-errors.js");
const tool_style_js_1 = require("./tool-style.js");
const NO_NAME = "`(unnamed)`";
/**
 * ⚠ THE ONE SHAPE OBJECT — passed to `composeDescription` for its bounds AND to
 * the registrar for enforcement, so the limit an agent reads is the limit the
 * schema applies. Two objects is how a description comes to promise 80 while
 * the schema takes 200.
 */
const HOME_SHAPE = {
    op: zod_1.z
        .enum(["list_channels", "create_channel"])
        .describe("Operation to perform."),
    name: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('op="create_channel" (required): the channel\'s name. It names the room and its hidden container both — there is no second name to set.'),
};
/**
 * ⚠ **RENDERED, NOT WRITTEN** (A14) — `tool-style.ts › composeDescription`.
 *
 * ⚠ THE INVITE REFUSAL LEFT THE PROSE AND BECAME AN ERROR ROW. It was a
 * 230-char paragraph pushed on every connection to describe something a caller
 * can only discover by trying; it is `HOME_ERRORS`'s `invite_is_app_only` now,
 * rendered in the same shape as every other named refusal on this surface, and
 * an agent that hits it matches the code rather than re-reading the paragraph.
 * The `1-80` character bound left too — the schema publishes it, and
 * `renderLimits` states the consequence from that one source.
 */
const HOME_DESCRIPTION = (0, tool_style_js_1.composeDescription)({
    headline: "Your HOME CHANNELS — the 1:1 and small-group rooms on your account, outside any workspace. NOT workspaces, and list_workspaces deliberately omits them.",
    policy: 'op="create_channel" writes; nothing here deletes, and nothing here invites.',
    routing: ["Use dopl_channel with `workspace=<container id>` to read or post in one."],
    body: [
        "Each room has a hidden CONTAINER; its id is what every other tool takes as `workspace=`, and it is how you reach the room's knowledge, agents and messages at all.",
        '- "list_channels" — the rooms YOU are in: name, container id, dopl_channel\'s `channel=` id, and who else is in it. Your own membership, never a directory of anybody else\'s rooms.',
        '- "create_channel" — Requires: name. You land in it ALONE; a finished state, not a half-built one.',
    ],
    limits: { shape: HOME_SHAPE, only: ["name"] },
    errors: tool_errors_js_1.HOME_ERRORS,
    examples: [{ op: "list_channels" }, { op: "create_channel", name: "Ops" }],
    cap: tool_style_js_1.DESCRIPTION_MAX_CHARS,
});
/**
 * ⚠ WHOSE VIEW THIS IS, on the RESULT. The list is the caller's own membership
 * rows, and under a container lock it is narrowed to ONE — so a short list is
 * not a claim about the account.
 */
const HOME_SCOPE_NOTE = `_Home channels you are a member of. A session pinned to a shared home channel sees THAT ONE only, so a single row can mean "you are locked to this room" rather than "you have one". This is not a workspace list — dopl_home rooms are absent from list_workspaces by design._`;
function renderChannel(channel) {
    const peers = channel.peers ?? [];
    const who = peers.length === 0
        ? "just you"
        : peers
            .map((p) => (0, narration_js_1.inlineOr)(p.displayName ?? p.email, "`(unnamed member)`"))
            .join(", ");
    const lines = [
        `- ${(0, narration_js_1.inlineOr)(channel.name, NO_NAME)} — ${who}`,
        //  ⚠ THE CONTAINER ID IS THE POINT OF THIS ROW. Every other tool takes it as
        //  `workspace=`; without it a home channel is unreachable, because nothing
        //  else on the surface lists one.
        `  workspace=\`${channel.workspaceId}\` · channel=\`${channel.channelId}\``,
    ];
    if (channel.lastMessagePreview) {
        // ⚠ A peer-authored message body, spliced into a line we wrote — a VALUE.
        lines.push(`  last: ${(0, narration_js_1.inlineOr)(channel.lastMessagePreview, "`(empty)`")}`);
    }
    return lines;
}
async function opListChannels(client, directory) {
    const channels = await (0, home_scopes_js_1.listHomeChannels)(client, directory);
    if (channels.length === 0) {
        return (0, respond_js_1.ok)(`No home channels. ${HOME_SCOPE_NOTE}\n\nCreate one with \`dopl_home(op='create_channel', name='…')\`.`);
    }
    const lines = ["## Home channels\n"];
    for (const channel of channels)
        lines.push(...renderChannel(channel));
    lines.push("", HOME_SCOPE_NOTE);
    return (0, respond_js_1.ok)(lines.join("\n"));
}
/**
 * ⚠ THE FOLLOW-UP IS REFUSED BY DESIGN AND THE RESULT SAYS SO IMMEDIATELY. An
 * agent that makes a room and is not told it cannot invite anybody will look for
 * an invite op, then a link op, then a members op, and read each absence as a
 * broken connection. One sentence at creation time closes that loop.
 */
async function opCreateChannel(client, name) {
    const { channel } = await client.createHomeChannel({ name });
    return (0, respond_js_1.ok)([
        `Created home channel ${(0, narration_js_1.inlineOr)(channel.name, NO_NAME)}. You are in it alone.`,
        `Address it with workspace=\`${channel.workspaceId}\` on any other tool, and with channel=\`${channel.channelId}\` on dopl_channel.`,
        `⚠ You cannot add a person to it. Minting the invitation is an interactive-session act, refused over MCP for every role and token — ask the user to add someone from the Dopl app.`,
    ].join("\n"));
}
function registerHomeTool(registerMetaTool, client, directory) {
    registerMetaTool("dopl_home", HOME_DESCRIPTION, HOME_SHAPE, async (args) => {
        switch (args.op) {
            case "list_channels":
                return opListChannels(client, directory);
            case "create_channel": {
                const miss = (0, respond_js_1.missingParams)("create_channel", args, ["name"]);
                if (miss)
                    return miss;
                return opCreateChannel(client, args.name);
            }
        }
    }, 
    // ⚠ THE ONE CHARGED META TOOL. See this file's header and
    // `registrar.ts › registerMetaTool`.
    { charged: true });
}
