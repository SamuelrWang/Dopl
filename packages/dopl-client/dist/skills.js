"use strict";
/**
 * Skills methods for `DoplClient`.
 *
 * Read paths (`listSkills`, `getSkill`) are surfaced to all callers.
 * Write paths (`createSkill`, `updateSkill`, `deleteSkill`, file CRUD)
 * are gated server-side by the per-skill `agent_write_enabled` toggle
 * for API-key (agent) callers; session callers bypass that check.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSkills = listSkills;
exports.getSkill = getSkill;
exports.createSkill = createSkill;
exports.updateSkill = updateSkill;
exports.deleteSkill = deleteSkill;
exports.listSkillFiles = listSkillFiles;
exports.readSkillFile = readSkillFile;
exports.createSkillFile = createSkillFile;
exports.writeSkillFile = writeSkillFile;
exports.renameSkillFile = renameSkillFile;
exports.deleteSkillFile = deleteSkillFile;
const enc = encodeURIComponent;
// ─── Read ───────────────────────────────────────────────────────────
async function listSkills(t) {
    const data = await t.request("/api/skills", {
        toolName: "skill_list",
    });
    return data.skills;
}
async function getSkill(t, slug) {
    return t.request(`/api/skills/${enc(slug)}`, {
        toolName: "skill_get",
    });
}
async function createSkill(t, input) {
    return t.request("/api/skills", {
        method: "POST",
        body: input,
        toolName: "skill_create",
    });
}
async function updateSkill(t, slug, patch) {
    const data = await t.request(`/api/skills/${enc(slug)}`, {
        method: "PATCH",
        body: patch,
        toolName: "skill_update",
    });
    return data.skill;
}
async function deleteSkill(t, slug) {
    await t.requestNoContent(`/api/skills/${enc(slug)}`, "DELETE", "skill_delete");
}
// ─── File CRUD ──────────────────────────────────────────────────────
async function listSkillFiles(t, slug) {
    const data = await t.request(`/api/skills/${enc(slug)}/files`, { toolName: "skill_list_files" });
    return data.files;
}
async function readSkillFile(t, slug, fileName) {
    const data = await t.request(`/api/skills/${enc(slug)}/files/${enc(fileName)}`, { toolName: "skill_read_file" });
    return data.file;
}
async function createSkillFile(t, slug, input) {
    const data = await t.request(`/api/skills/${enc(slug)}/files`, { method: "POST", body: input, toolName: "skill_create_file" });
    return data.file;
}
async function writeSkillFile(t, slug, fileName, body) {
    const data = await t.request(`/api/skills/${enc(slug)}/files/${enc(fileName)}`, { method: "PUT", body: { body }, toolName: "skill_write_file" });
    return data.file;
}
async function renameSkillFile(t, slug, currentName, newName) {
    const data = await t.request(`/api/skills/${enc(slug)}/files/${enc(currentName)}`, { method: "PATCH", body: { name: newName }, toolName: "skill_rename_file" });
    return data.file;
}
async function deleteSkillFile(t, slug, fileName) {
    await t.requestNoContent(`/api/skills/${enc(slug)}/files/${enc(fileName)}`, "DELETE", "skill_delete_file");
}
