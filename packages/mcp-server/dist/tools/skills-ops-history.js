"use strict";
/**
 * `dopl_skill` op="history" and op="restore" — the SKILL.md body's version list, one version
 * read, and the write-back. The app's history panel reads the same routes.
 *
 * ⚠ `history` WITH `revision` IS THE PREVIEW (the old body plus the current Version to pass), so
 * the old/new summary is in hand BEFORE the write. ⚠ `restore` REQUIRES `slug` as well as the
 * version id and refuses a version that belongs to ANOTHER skill — the route is keyed by version
 * alone, and an id copied from the wrong list must not roll back the wrong procedure.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opHistory = opHistory;
exports.opRestore = opRestore;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const skills_shared_1 = require("./skills-shared");
const channel_shared_1 = require("./channel-shared");
const revision_render_1 = require("./revision-render");
const tool_errors_1 = require("./tool-errors");
async function currentBody(client, slug) {
    try {
        return await client.readSkillBody(slug);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't read SKILL.md from ${(0, narration_1.inlineOr)(slug, "`(empty)`")}: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
/** The version, or a named refusal — including a version that belongs to another skill. */
async function versionOf(client, file, versionId) {
    try {
        const version = await client.getSkillVersion(versionId);
        if (version.skillId === file.skillId)
            return version;
    }
    catch (e) {
        if (!(0, respond_1.isNotFound)(e))
            throw e;
    }
    return (0, respond_1.err)((0, tool_errors_1.refusal)((0, revision_render_1.revisionNotFound)(revision_render_1.HISTORY_OP), `${(0, narration_1.inlineOr)(versionId, "`(empty)`")} is not a version of this skill.`));
}
async function opHistory(client, slug, callerUserId, opts) {
    const file = await currentBody(client, slug);
    if ((0, channel_shared_1.isErr)(file))
        return file;
    const current = `Current: Version \`${file.updatedAt}\` · ${file.body.length} chars.`;
    if (opts.revision !== undefined) {
        const version = await versionOf(client, file, opts.revision);
        if ((0, channel_shared_1.isErr)(version))
            return version;
        const header = (0, narration_1.isForeignAuthored)({ createdBy: version.authorId, lastEditedBy: null }, callerUserId)
            ? `${skills_shared_1.UNTRUSTED_SKILL_BODY_HEADER}\n\n`
            : "";
        return (0, respond_1.ok)([
            `${header}# Version \`${version.id}\` of ${(0, narration_1.inlineOr)(slug, "`(empty)`")} / SKILL.md`,
            `Saved ${version.createdAt} via ${version.source} · ${version.body.length} chars.`,
            current,
            `Restoring writes THIS body over the current one as a NEW save; nothing is deleted. To do it: op="restore" slug="${slug}" revision="${version.id}" expected_version="${file.updatedAt}".`,
            "",
            "---",
            "",
            version.body,
        ].join("\n"));
    }
    const history = await client.getSkillHistory(slug, { limit: opts.limit ?? revision_render_1.HISTORY_PAGE_DEFAULT });
    const lines = [`# History: ${(0, narration_1.inlineOr)(slug, "`(empty)`")} / SKILL.md`, current, ""];
    if (history.versions.length === 0)
        lines.push("_No saved versions._");
    for (const v of history.versions) {
        const who = v.authorId && v.authorId === callerUserId ? "you" : "a member";
        lines.push(`- \`${v.id}\` · ${v.createdAt} · by ${who} via ${v.source} · ${v.bodyBytes} bytes`);
    }
    lines.push("", history.versions.length >= (opts.limit ?? revision_render_1.HISTORY_PAGE_DEFAULT)
        ? `Showing the newest ${history.versions.length}; raise \`limit\` for older ones.`
        : "End of history.", `Preview one with op="history" revision="<id>"; restore with op="restore" revision="<id>" expected_version="${file.updatedAt}".`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opRestore(client, slug, versionId, expectedVersion) {
    const file = await currentBody(client, slug);
    if ((0, channel_shared_1.isErr)(file))
        return file;
    if (file.updatedAt !== expectedVersion) {
        return (0, revision_render_1.staleBeforeRestore)('op="read"', file.updatedAt, expectedVersion);
    }
    const version = await versionOf(client, file, versionId);
    if ((0, channel_shared_1.isErr)(version))
        return version;
    let saved;
    try {
        saved = await client.restoreSkillVersion(versionId, expectedVersion);
    }
    catch (e) {
        const mapped = (0, revision_render_1.restoreRefusal)(e, 'op="read"', revision_render_1.HISTORY_OP) ?? (0, skills_shared_1.agentWriteDenied)(e);
        if (mapped)
            return mapped;
        throw e;
    }
    const unchanged = saved.updatedAt === expectedVersion;
    return (0, respond_1.ok)([
        unchanged
            ? `Nothing to restore: SKILL.md of ${(0, narration_1.inlineOr)(slug, "`(empty)`")} already matches version \`${versionId}\`.`
            : `Restored SKILL.md of ${(0, narration_1.inlineOr)(slug, "`(empty)`")} to version \`${versionId}\` — written as a NEW save; every earlier version is still in op="history".`,
        `Version \`${expectedVersion}\` → \`${saved.updatedAt}\` · ${file.body.length} → ${saved.body.length} chars.`,
    ].join("\n"));
}
