"use strict";
/**
 * `dopl_channel` ROOM-LIFECYCLE op handlers: open (create a channel, or a
 * direct 1:1) and invite (add a workspace member). ⚠ `channel-` filename prefix
 * required by the parity split-scan (parity.test.ts).
 *
 * ⚠ Every string below is server NARRATION with no untrusted framing, and two
 * peer-authored values reach it:
 *   - `ch.name` / `channel.name` — `resolveChannelOr` lists PUBLIC channels the
 *     caller was never invited to, so the name can come from someone the agent
 *     never contacted. Neutralized at every site.
 *   - `member.label` (`profiles.display_name`) — already render-safe from
 *     `resolveMemberOr`. ⚠ Do NOT neutralize twice.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opOpen = opOpen;
exports.opInvite = opInvite;
const call_ref_js_1 = require("../call-ref.js");
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const narration_1 = require("./narration");
async function opOpen(client, opts) {
    // Direct branch: open (or dedup-return) a 1:1 channel — the server dedups a
    // repeat DM to the same peer, so this is idempotent.
    if (opts.direct) {
        const member = await (0, channel_shared_1.resolveMemberOr)(client, opts.member);
        if ((0, channel_shared_1.isErr)(member))
            return member;
        const channel = await client.createChannel({
            direct: true,
            memberUserId: member.userId,
        });
        return (0, respond_1.ok)([
            `Opened a direct message with ${member.label} (id: \`${channel.id}\` · slug: \`${channel.slug}\`).`,
            `Post with ${(0, call_ref_js_1.callRef)("channel.send", { channel: `"${channel.id}"`, body: '"..."' })}.`,
        ].join("\n"));
    }
    const name = opts.name;
    let channel;
    try {
        channel = await client.createChannel({
            name,
            topic: opts.topic,
            visibility: opts.visibility,
        });
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            // ⚠ NOT a duplicate-name collision (names auto-dedupe via slug
            // suffixing): a 409 here is a transient same-derived-slug insert race
            // between concurrent opens. Nothing was created; a retry succeeds.
            return (0, respond_1.err)(`Hit a transient naming conflict creating "${name}" (a rare concurrent-open race on the derived slug). Nothing was created — just retry the same open and it should succeed.`);
        }
        throw e;
    }
    const visNote = channel.visibility === "private"
        ? "Private — only invited members can see it."
        : "Public — visible to the whole workspace.";
    // ⚠ **THE ROOM'S DESCRIPTION, ECHOED BACK (ruling, Samuel, 2026-09-15)** — the
    // product's word for the wire field `topic`. ECHOED because `summary` carries
    // four meanings on this tool and a creator who set the wrong one should see
    // which room they actually described.
    // ⚠ NEUTRALIZED on the same FLAT rule as everything else on this surface, and
    // `neutralizeInline` DIRECTLY rather than `inlineOr`: a description that
    // flattens to nothing is one this line should not print at all, where NO_NAME
    // ("(unnamed)") answers a different question.
    const safeTopic = channel.topic ? (0, channel_shared_1.neutralizeInline)(channel.topic) : null;
    const description = safeTopic ? ` Description: ${safeTopic}` : "";
    return (0, respond_1.ok)([
        // ⚠ Caller's own name, one argument old — neutralized on the same FLAT
        // rule as everything else. Per-site judgement about who could have
        // authored a value is what leaves a peer-typed string raw.
        `Created channel **${(0, channel_shared_1.inlineOr)(channel.name, narration_1.NO_NAME)}** (slug: \`${channel.slug}\` · id: \`${channel.id}\`). ${visNote}${description}`,
        `Post with ${(0, call_ref_js_1.callRef)("channel.send", { channel: `"${channel.slug}"`, body: '"..."' })}; add members with ${(0, call_ref_js_1.callRef)("channel.rooms.invite", {}, { form: "op" })}.`,
    ].join("\n"));
}
async function opInvite(client, channelRef, memberRef) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, narration_1.NO_NAME);
    const member = await (0, channel_shared_1.resolveMemberOr)(client, memberRef);
    if ((0, channel_shared_1.isErr)(member))
        return member;
    let added;
    try {
        added = await client.inviteToChannel(ch.id, member.userId);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`${member.label} is already a member of **${chName}**.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Added ${member.label} to **${chName}** as ${added.role}.`);
}
