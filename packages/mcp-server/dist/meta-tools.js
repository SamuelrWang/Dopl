"use strict";
/**
 * meta-tools.ts — `dopl_workspaces`, the orientation tool.
 *
 * ⚠ USER-scoped, not workspace-scoped: a membership lookup needs no workspace,
 * which is why it registers through `registerMetaTool` (no injected
 * `workspace=` arg) and reports the connection's container in its footer.
 * Everything else the domain path enforces — the gates, `strictInput` — applies
 * identically; see `registrar.ts`.
 *
 * ── ⚠ THREE TOOLS BECAME ONE (B13, 2026-09-02) ─────────────────────────────
 *
 * `list_workspaces`, `current_workspace` and `dopl_home` answered three
 * questions that had stopped being three: *which containers am I in*, *which
 * one does a no-arg call hit*, and *which of them are home channels*. B10
 * deletes the middle one — there is no default workspace to report, because
 * "home is the default; all workspaces are just normal workspaces" — and with
 * it the reason the third existed. A home-channel container was hidden from
 * `list_workspaces` only because a listing was an advertisement of things a
 * no-arg call might silently pick; nothing picks now, so a container is simply
 * one more container the caller is in, LISTED WITH ITS KIND.
 *
 * ⚠ **WHAT LEFT WITH THEM, AND IT IS A SURFACE DECISION, NOT A TIDY-UP.**
 * `current_workspace(op="set"|"clear")` — the session pin — is gone with the
 * default it pinned.
 *
 * ⚠ **`create_home_channel` CAME BACK AT THE INTEGRATION (F-621).** B13 retired
 * `dopl_home(op="create_channel")` with its tool and named no successor, which
 * is a wire-visible deletion of a capability rather than a rename — so the op
 * moved here instead. Minting a room and INVITING somebody into one are not the
 * same act: the invite half has been `sessionOnly` since the tool shipped, and
 * a room an agent can make but not populate is a finished state, not a
 * half-built one. Reading a home channel was never affected — its container id
 * is on every row here, and `dopl_status` answers for the rooms inside it.
 *
 * 🔒 **`op` IS OPTIONAL AND ITS DEFAULT MUST STAY THE READ.**
 * `gating.ts › opRefusal` returns `null` for an ABSENT op — an op-less tool has
 * nothing to gate — so a default that wrote would be a write no scope gate ever
 * sees. The default is `list`, and this tool is the one an agent that has lost
 * its bearings calls with `{}`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerWorkspaceMetaTools = registerWorkspaceMetaTools;
const zod_1 = require("zod");
const tool_style_js_1 = require("./tools/tool-style.js");
const identity_js_1 = require("./tools/identity.js");
const narration_js_1 = require("./tools/narration.js");
const workspace_arg_js_1 = require("./workspace-arg.js");
const respond_js_1 = require("./tools/respond.js");
const instructions_js_1 = require("./instructions.js");
const workspace_directory_js_1 = require("./workspace-directory.js");
/**
 * ⚠ **RENDERED, NOT WRITTEN** (A14) — `tool-style.ts › composeDescription`
 * holds the order for all eleven tools, and refuses a headline over its window
 * or a description over its cap at import time.
 *
 * ⚠ IT IS BUDGETED AT {@link READ_DESCRIPTION_MAX_CHARS}, NOT THE DISPATCH CAP.
 * It takes no arguments at all — no `op` enum whose every member
 * `parity.test.ts` requires glossed, which is the only thing that gives a tool
 * a floor above 450.
 */
const WORKSPACES_SHAPE = {
    op: zod_1.z
        .enum(["list", "create_home_channel"])
        .optional()
        .describe('Default: "list".'),
    name: zod_1.z
        .string()
        .trim()
        .min(1)
        .max(80)
        .optional()
        .describe('op="create_home_channel" (required): names the room and its hidden container both.'),
};
const WORKSPACES_DESCRIPTION = (0, tool_style_js_1.composeDescription)({
    headline: "Every container you are in — workspaces AND home channels, each with its kind, its id and your role. The only place a container id is published.",
    policy: 'Only "create_home_channel" writes; nothing deletes or invites.',
    routing: [
        "Use dopl_status for the rooms, sessions and unanswered asks inside them.",
    ],
    body: [
        '- "list" (default) — every container and the id you pass as `workspace=`.',
        '- "create_home_channel" — Requires: name. A room outside any workspace, yours alone.',
    ],
    examples: [{}, { op: "create_home_channel", name: "Ops" }],
    cap: tool_style_js_1.READ_DESCRIPTION_MAX_CHARS,
});
/**
 * ⚠ THE FOLLOW-UP IS REFUSED BY DESIGN AND THE RESULT SAYS SO IMMEDIATELY —
 * carried over verbatim from the deleted `dopl_home`, because the loop it
 * closes is unchanged. An agent that makes a room and is not told it cannot
 * invite anybody will look for an invite op, then a link op, then a members op,
 * and read each absence as a broken connection.
 */
async function opCreateHomeChannel(client, name) {
    const { channel } = await client.createHomeChannel({ name });
    return (0, respond_js_1.ok)([
        `Created home channel ${(0, narration_js_1.inlineOr)(channel.name, instructions_js_1.UNNAMED_WORKSPACE)}. You are in it alone.`,
        // ⚠ THE OPS ARE NAMED, and they are named from `WORKSPACE_ARG_OPS`
        // rather than by hand: this line said "on any other tool" and B13 had
        // already made that false — the arg is IGNORED off that table, so the
        // advice cost a call and a footer note to discover.
        `Address it with workspace=\`${channel.workspaceId}\` on ${(0, workspace_arg_js_1.workspaceArgTargets)()}, and with channel=\`${channel.channelId}\` on dopl_channel.`,
        `⚠ You cannot add a person to it. Minting the invitation is an interactive-session act, refused over MCP for every role and token — ask the user to add someone from the Dopl app.`,
    ].join("\n"));
}
function registerWorkspaceMetaTools(registerMetaTool, { directory, activeWorkspace, caller, client }) {
    /**
     * The CREDENTIAL this connection acts through, as a standalone block.
     *
     * ⚠ **IT IS THE SESSION LINE AND NOT THE CALLER LINE**, and the difference is
     * B13's: `appendDoplStatus` now renders `caller: id=…` on EVERY successful
     * response, bound container or not, so restating it here would print one
     * agent's identity twice in one answer. What the footer deliberately does NOT
     * carry is the credential label (a per-response tax on every result), and
     * that is exactly the fact somebody reaching for this tool is missing.
     */
    function callerBlock() {
        const lines = (0, identity_js_1.sessionLines)(caller);
        return lines.length > 0 ? [...lines, ""] : [];
    }
    async function opList() {
        const list = await directory.getWorkspaceList();
        if (list.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: "You're not an active member of any container yet.",
                    },
                ],
            };
        }
        const lines = [
            ...callerBlock(),
            "Containers you are in:",
            "",
            instructions_js_1.UNTRUSTED_DIRECTORY_NOTE,
            "",
        ];
        for (const w of list) {
            const kind = (0, workspace_directory_js_1.containerKind)(w);
            // ⚠ KIND IS RENDERED, NOT INFERRED BY THE READER, and a container's SLUG
            // is withheld — its id is the only handle that addresses it, and printing
            // a slug beside a room would read as a second, equivalent address.
            const address = kind === "workspace"
                ? `slug: \`${w.slug}\` · id: \`${w.id}\``
                : `id: \`${w.id}\``;
            const here = w.id === activeWorkspace?.id ? " ←" : "";
            lines.push(`- ${(0, narration_js_1.inlineOr)(w.name, instructions_js_1.UNNAMED_WORKSPACE)} — ${kind} (${address}, role: ${w.role})${here}`);
        }
        lines.push("");
        lines.push(activeWorkspace
            ? "← this connection's container: a call that names none lands there."
            : // ⚠ NOT "you have no default" — there is no default to lack. The
                // server answers for a call that names nothing, and saying so is what
                // stops an agent hunting for a tool that would set one.
                "This connection names no container, so a call that names none is resolved for you. Pass `workspace=` to list or create somewhere specific.");
        return { content: [{ type: "text", text: lines.join("\n") }] };
    }
    registerMetaTool("dopl_workspaces", WORKSPACES_DESCRIPTION, WORKSPACES_SHAPE, async (args) => {
        if ((args.op ?? "list") === "list")
            return opList();
        const miss = (0, respond_js_1.missingParams)("create_home_channel", args, ["name"]);
        return miss ?? opCreateHomeChannel(client, args.name);
    });
}
