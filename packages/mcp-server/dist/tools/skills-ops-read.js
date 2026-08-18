"use strict";
/**
 * `dopl_skill` READ op handlers: list (active + caller-visible, grouped by
 * folder), get (resolved detail + reference availability), read (SKILL.md plus
 * its Version token). Non-mutating. Routed from the registrar in `skills.ts`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opGet = opGet;
exports.opRead = opRead;
const narration_1 = require("./narration");
const respond_1 = require("./respond");
const skills_shared_1 = require("./skills-shared");
async function opList(client, folder) {
    const skills = await client.listSkills();
    let active = skills.filter((s) => s.status === "active");
    if (folder !== undefined) {
        const want = folder.trim();
        active = active.filter((s) => (s.folder ?? "") === want);
    }
    if (active.length === 0) {
        // ⚠ The EMPTY case is the same overclaim: a member whose colleague owns
        // private skills must not be told the workspace has none. Both branches say
        // whose view this is.
        return (0, respond_1.ok)(folder !== undefined
            ? `No active skills visible to you in folder ${(0, narration_1.inlineOr)(folder, "`(unnamed folder)`")}. ${skills_shared_1.SCOPE_NOTE}`
            : `No active skills visible to you in this workspace. Drafts and other members' private or team-scoped skills are not listed, so this is not proof the workspace has none — dopl_members(op="access_matrix") is the inventory. Create one with \`dopl_skill\` op="create" (requires the workspace to allow agent writes).`);
    }
    // Group by folder; unfiled last.
    const byFolder = new Map();
    for (const s of active) {
        const key = s.folder ?? "";
        byFolder.set(key, [...(byFolder.get(key) ?? []), s]);
    }
    const folders = [...byFolder.keys()].sort((a, b) => {
        if (a === "")
            return 1;
        if (b === "")
            return -1;
        return a.localeCompare(b);
    });
    const lines = ["## Skills\n"];
    for (const key of folders) {
        lines.push(`### ${key === "" ? "Unfiled" : `📁 ${(0, narration_1.inlineOr)(key, "`(unnamed folder)`")}`}`);
        lines.push("");
        for (const s of byFolder.get(key)) {
            const visBadge = s.visibility === "private"
                ? " _(private)_"
                : s.accessMode === "teams"
                    ? " _(team-shared)_"
                    : "";
            lines.push(`- \`${s.slug}\` (id: \`${s.id}\`) — ${(0, narration_1.inlineOr)(s.name, skills_shared_1.NO_NAME)}${visBadge}`);
            lines.push(`  ${(0, narration_1.inlineOr)(s.description, "`(no description)`")}`);
            lines.push(`  **When to use:** ${(0, narration_1.inlineOr)(s.whenToUse, "`(not described)`")}`);
            if (s.whenNotToUse) {
                lines.push(`  **When NOT to use:** ${(0, narration_1.inlineOr)(s.whenNotToUse, "")}`);
            }
        }
        lines.push("");
    }
    lines.push(`Showing ${active.length} skill${active.length === 1 ? "" : "s"}: active, and visible to you. ${skills_shared_1.SCOPE_NOTE}`);
    lines.push("", "Call `dopl_skill` op=\"get\" (or op=\"read\") with a slug to load the SKILL.md procedure for the skill that fits the task.");
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, slug, detail, 
// Caller's user id, for the authorship framing only.
callerUserId = null) {
    try {
        const { skill, files, references } = await client.getSkill(slug);
        const file = files.find((f) => f.name === "SKILL.md") ?? files[0];
        const body = file?.body ?? "";
        // ⚠ The FILE's authorship, falling back to the skill row's — the BODY is
        // what is framed, so the body's authors decide.
        const foreign = (0, narration_1.isForeignAuthored)(file ?? skill, callerUserId);
        const lines = [];
        // ⚠ Framing FIRST, ahead of the heading, so it precedes every peer-typed
        // string and not merely the body. Suppressed in `summary` mode, where there
        // is no body to frame.
        if (foreign && detail !== "summary") {
            lines.push(skills_shared_1.UNTRUSTED_SKILL_BODY_HEADER, "");
        }
        lines.push(`# Skill ${(0, narration_1.inlineOr)(skill.name, skills_shared_1.NO_NAME)} \`${skill.slug}\``);
        const scope = skill.visibility === "private"
            ? "private"
            : skill.accessMode === "teams"
                ? "team-shared"
                : "public";
        lines.push(`id: \`${skill.id}\` · status: ${skill.status} · sharing: ${scope} · folder: ${skill.folder ? (0, narration_1.inlineOr)(skill.folder, "`(unnamed folder)`") : "—"} · agent-write ${skill.agentWriteEnabled ? "on" : "off"}`);
        lines.push(`last edited by ${skill.lastEditedSource} · updated ${skill.updatedAt}`);
        lines.push(`When to use: ${skill.whenToUse}`);
        if (skill.whenNotToUse) {
            lines.push(`When NOT to use: ${skill.whenNotToUse}`);
        }
        if (references.length > 0) {
            lines.push("");
            lines.push("## References");
            for (const ref of references) {
                const status = ref.available ? "✓" : "✗ (not available)";
                if (ref.kind === "kb") {
                    lines.push(`- KB \`${ref.slug}\` (${(0, narration_1.inlineOr)(ref.label, "`(unlabelled)`")}) ${status}` +
                        (ref.available
                            ? ""
                            : " — broken ref; the skill mentions this KB but it isn't in the workspace."));
                }
                else {
                    const fieldHint = ref.field ? `.${ref.field}` : "";
                    lines.push(`- Connector \`${ref.provider}${fieldHint}\` (${(0, narration_1.inlineOr)(ref.label, "`(unlabelled)`")}) ${status}`);
                }
            }
            // ⚠ `available` is an EXISTENCE check, NOT an access check:
            // `knowledgeBaseSlugExists` filters on workspace + slug + `deleted_at IS
            // NULL` and consults no visibility, so a ref to another member's PRIVATE
            // base is marked ✓ here and 404s on the read. Saying so is free; the
            // per-ref access check that would fix it is a query per reference.
            lines.push(`_✓ means the reference EXISTS in this workspace, not that you can read it: a base private to another member still shows ✓ and then 404s on dopl_kb(op="read_file")._`);
        }
        if (detail === "summary") {
            lines.push("");
            lines.push(`_Summary view — SKILL.md is ${body.length.toLocaleString()} chars. Pass detail="full" or use op="read" for the body._`);
        }
        else {
            lines.push("");
            lines.push("## SKILL.md");
            lines.push("");
            lines.push(body);
        }
        return (0, respond_1.ok)(lines.join("\n"));
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No skill \`${slug}\`. List skills with dopl_skill(op="list").`);
        }
        return (0, respond_1.err)(`Couldn't load skill \`${slug}\`: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
async function opRead(client, slug, 
// Caller's user id, for the authorship framing only.
callerUserId = null) {
    try {
        const file = await client.readSkillBody(slug);
        // ⚠ `op="read"` is the BARER body surface (no metadata, no references, just
        // the procedure), so it most needs to say WHOSE procedure it is.
        const header = (0, narration_1.isForeignAuthored)(file, callerUserId)
            ? `${skills_shared_1.UNTRUSTED_SKILL_BODY_HEADER}\n\n`
            : "";
        return (0, respond_1.ok)(`${header}# \`${slug}\` / SKILL.md\nVersion: \`${file.updatedAt}\` (pass as expected_version to write)\n\n${file.body}`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't read SKILL.md from \`${slug}\`: ${(0, skills_shared_1.failureDetail)(e)}`);
    }
}
