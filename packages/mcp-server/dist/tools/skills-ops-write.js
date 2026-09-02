"use strict";
/**
 * `dopl_skill` WRITE op handlers. ⚠ Every one can come back 403
 * `SKILL_AGENT_WRITE_DISABLED`, which is why `agentWriteDenied` lives beside
 * `failureDetail` in `skills-shared.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opWrite = opWrite;
exports.opCreate = opCreate;
exports.opUpdate = opUpdate;
exports.opSetVisibility = opSetVisibility;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const skills_shared_1 = require("./skills-shared");
async function opWrite(client, slug, body, expected_version, force) {
    try {
        const { file } = await client.writeSkillBody(slug, body, force ? null : expected_version);
        return (0, respond_1.ok)(`Wrote SKILL.md in \`${slug}\` (${file.body.length} chars). New version: \`${file.updatedAt}\`.`);
    }
    catch (e) {
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`SKILL.md in \`${slug}\` changed since you last read it. Call dopl_skill(op="read", slug) to get the current body + version, reconcile your changes, then retry write with that expected_version (or pass force=true to overwrite).`);
        }
        // Skill flagged read-only to agents — clean message, not a raw code.
        const denied = (0, skills_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        return (0, respond_1.err)(`Couldn't write SKILL.md in \`${slug}\`: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
async function opCreate(client, params) {
    try {
        const { skill, primaryFile } = await client.createSkill({
            name: params.name,
            description: params.description,
            whenToUse: params.when_to_use,
            whenNotToUse: params.when_not_to_use ?? null,
            slug: params.slug,
            status: params.status,
            agentWriteEnabled: params.agent_write_enabled,
            folder: params.folder ?? null,
            body: params.body,
        });
        const visNote = skill.visibility === "private"
            ? "Private to you — only you and your agent can see it."
            : "Visible to the whole workspace.";
        // ⚠ A draft or private skill is invisible to op="list" — say why, or the
        // caller's next listing silently omits what it just made.
        const listNote = skill.status !== "active"
            ? ` It is a ${skill.status}, so dopl_skill(op="list") will NOT show it until status="active".`
            : skill.visibility === "private"
                ? ` Other members' op="list" will not show it while it is private.`
                : "";
        return (0, respond_1.ok)(`Created skill ${(0, narration_1.inlineOr)(skill.name, skills_shared_1.NO_NAME)} (slug: \`${skill.slug}\`). ` +
            `Status: ${skill.status}. ${visNote}${listNote} ` +
            `SKILL.md (${primaryFile.body.length} chars) is ready to edit with \`dopl_skill\` op="write".`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't create skill: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
async function opUpdate(client, params) {
    const slug = params.slug;
    // ⚠ `agent_write_enabled` is a HUMAN-controlled per-skill protection flag: an
    // agent flipping it via MCP is silently dropped server-side, so reject loudly
    // rather than reporting a success that did not happen.
    if (params.agent_write_enabled !== undefined) {
        return (0, respond_1.err)("agent_write_enabled can't be changed by an agent — set it from the Dopl web UI.");
    }
    try {
        const updated = await client.updateSkill(slug, {
            name: params.name,
            description: params.description,
            whenToUse: params.when_to_use,
            whenNotToUse: params.when_not_to_use,
            slug: params.new_slug,
            status: params.status,
            folder: params.folder,
        });
        return (0, respond_1.ok)(`Updated skill ${(0, narration_1.inlineOr)(updated.name, skills_shared_1.NO_NAME)} (slug: \`${updated.slug}\`). Status: ${updated.status}.` +
            (updated.status !== "active"
                ? ` A non-active skill is not listed by dopl_skill(op="list").`
                : "") +
            (updated.folder ? ` Folder: ${(0, narration_1.inlineOr)(updated.folder, "`(unnamed folder)`")}.` : ""));
    }
    catch (e) {
        // Skill flagged read-only to agents — clean message, not a raw code.
        const denied = (0, skills_shared_1.agentWriteDenied)(e);
        if (denied)
            return denied;
        return (0, respond_1.err)(`Couldn't update skill \`${slug}\`: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
async function opSetVisibility(client, slug, visibility) {
    if (visibility !== "public" && visibility !== "private") {
        return (0, respond_1.err)(`set_visibility takes visibility="public" or "private".`);
    }
    try {
        const skill = await client.updateSkill(slug, { visibility });
        return (0, respond_1.ok)(visibility === "public"
            ? `Published skill ${(0, narration_1.inlineOr)(skill.name, skills_shared_1.NO_NAME)} (slug: \`${skill.slug}\`) — now visible workspace-wide.`
            : `Skill ${(0, narration_1.inlineOr)(skill.name, skills_shared_1.NO_NAME)} (slug: \`${skill.slug}\`) is now private — only its owner can see it, and it drops out of every other member's dopl_skill(op="list").`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't change sharing on \`${slug}\`: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
