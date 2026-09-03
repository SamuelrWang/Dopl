"use strict";
/**
 * `op="status"` — THE STATE MACHINE, READ IN ONE CALL.
 *
 * ⚠ **`read_sessions` AND `read_directions` WERE TWO OPS FOR ONE QUESTION** (B8,
 * 2026-09-02). "What is running on my machine" and "what is queued for it" are
 * the two halves of the same answer, and an orchestrator that asked only the
 * first read a machine with nothing running and no idea that three directions
 * were waiting to be claimed. `delivery=idle` on a send says the message was
 * FILED; this is the op that says what became of it, so the two contracts meet.
 *
 * ⚠ **COMPOSED FROM THE TWO EXISTING RENDERERS, NOT REWRITTEN.** Each already
 * owns a vocabulary — the session table's hedged cells and its legend, the
 * mailbox's scope line — and merging them into one renderer would mean one
 * function deciding which of two vocabularies a row belongs to. The seam is a
 * blank line.
 *
 * ⚠ **THE DIRECTIONS HALF IS APPENDED, NEVER SUBSTITUTED.** An error from either
 * half returns AS the result: a status page that silently drops the half that
 * failed is a page claiming a machine has no pending work when nobody asked it.
 *
 * ⚠ `channel-` filename prefix is REQUIRED by the parity split-scan.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opStatus = opStatus;
const respond_1 = require("./respond");
const channel_ops_read_1 = require("./channel-ops-read");
const channel_ops_account_1 = require("./channel-ops-account");
const channel_ops_direct_1 = require("./channel-ops-direct");
/** The text of a handler's answer — every one of them is a single text block. */
function textOf(res) {
    return res.content.map((c) => c.text).join("\n");
}
async function opStatus(client, directory, opts = {}) {
    const scoped = opts.channel !== undefined && opts.channel.trim() !== "";
    // ⚠ **THE ACCOUNT-WIDE READ IS A SIBLING HANDLER, NOT A BRANCH** — its whole
    // result vocabulary splices one `ref` and its scope is one room, so threading
    // an absent ref through it would produce a page with a hole in it. The
    // argument is stated once, in `channel-ops-account.ts`'s header.
    const sessions = scoped
        ? await (0, channel_ops_read_1.opReadSessions)(client, opts.channel, opts.format)
        : await (0, channel_ops_account_1.opReadSessionsAccount)(client, directory);
    if (sessions.isError)
        return sessions;
    const directions = await (0, channel_ops_direct_1.opReadDirections)(client, {
        channel: scoped ? opts.channel : undefined,
        agent: opts.agent,
    });
    if (directions.isError)
        return directions;
    return (0, respond_1.ok)(`${textOf(sessions)}\n\n${textOf(directions)}`);
}
