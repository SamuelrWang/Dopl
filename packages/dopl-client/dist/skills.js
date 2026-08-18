"use strict";
/**
 * Skills methods for `DoplClient`.
 *
 * Reads are open to all callers. Writes are gated server-side by the per-skill
 * `agent_write_enabled` toggle for API-key (agent) callers; session callers
 * bypass that check.
 *
 * Skills are single-file: one SKILL.md body via `readSkillBody` /
 * `writeSkillBody`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.listSkills = listSkills;
exports.getSkill = getSkill;
exports.createSkill = createSkill;
exports.updateSkill = updateSkill;
exports.deleteSkill = deleteSkill;
exports.readSkillBody = readSkillBody;
exports.writeSkillBody = writeSkillBody;
const errors_js_1 = require("./errors.js");
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
// ─── Body read / write (the single SKILL.md) ────────────────────────
async function readSkillBody(t, slug) {
    const data = await t.request(`/api/skills/${enc(slug)}/body`, { toolName: "skill_read" });
    return data.file;
}
async function writeSkillBody(t, slug, body, expectedVersion) {
    // Optimistic concurrency, tri-state on `expectedVersion`:
    //   - string    → atomic CAS (412 on mismatch).
    //   - undefined → strict: existing body refuses 412 — caller must read first
    //                 and pass the Version it saw. ⚠ Do NOT re-add the old
    //                 read-at-write auto-guard: it only proved nothing changed in
    //                 the microseconds before the PUT, and silently clobbered
    //                 writes landing after the caller's real read.
    //   - null      → force: blind overwrite, no precondition.
    let version;
    if (expectedVersion === null) {
        version = undefined;
    }
    else if (expectedVersion === undefined) {
        let exists = false;
        try {
            await readSkillBody(t, slug);
            exists = true;
        }
        catch (e) {
            if (!(e instanceof errors_js_1.DoplApiError) || e.status !== 404)
                throw e;
        }
        if (exists) {
            throw new errors_js_1.DoplApiError(412, JSON.stringify({
                error: {
                    code: "EXPECTED_VERSION_REQUIRED",
                    message: "This skill already has a body. Read it first and pass its Version as expected_version (or force to overwrite).",
                },
            }));
        }
    }
    else {
        version = expectedVersion;
    }
    const data = await t.request(`/api/skills/${enc(slug)}/body`, {
        method: "PUT",
        body: { body },
        toolName: "skill_write",
        customHeaders: version ? { "X-Updated-At": version } : undefined,
    });
    return data;
}
