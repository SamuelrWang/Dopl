"use strict";
/**
 * MCP tools for the user's skills.
 *
 * Skills are folders of `.md` files; SKILL.md is the canonical procedure
 * entry point. Writes are gated server-side by the per-skill
 * `agent_write_enabled` toggle; calls without the toggle 403 with
 * `SKILL_AGENT_WRITE_DISABLED`.
 *
 * Consolidated into two `op`-dispatched tools (the canonical pattern from
 * `setups.ts`):
 *   - `dopl_skill`       — reads + non-destructive writes.
 *   - `dopl_skill_admin` — DESTRUCTIVE deletes, split out on purpose.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSkillTools = registerSkillTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const skill_authoring_guide_js_1 = require("../prompts/skill-authoring-guide.js");
function errorMessage(e) {
    if (e && typeof e === "object" && "message" in e) {
        return String(e.message);
    }
    return String(e);
}
const SKILL_DESCRIPTION = `Read and author the user's skills. Each skill is a folder of \`.md\` files; the canonical procedure lives in SKILL.md. Set \`op\` to one of:
- "list" — list the user's active skills in the active workspace with trigger metadata (name, description, when_to_use, when_not_to_use, status) so you can pick the right skill before loading bodies. Call at every new task boundary.
- "get" — fetch a skill's resolved bundle: every file (SKILL.md + supplementary), reference availability for KBs and connectors, and metadata. Read SKILL.md first as the procedure; consult supplementary files only when SKILL.md tells you to. KB references appear as \`[label](dopl://kb/<slug>)\` — use \`dopl_kb(op='read_file')\` / \`dopl_kb(op='get_tree')\` to load that KB when you actually need it. Requires: slug.
- "create" — create a new skill (returns the row + a fresh SKILL.md). New skills default to private. Requires: name, description, when_to_use. Optional: when_not_to_use, slug (auto-derived), status (defaults active), body (initial SKILL.md content). Before calling: use op="authoring_guide" so the description and when_to_use are written to the framework's standards.
- "update" — update skill metadata (name, description, when_to_use, when_not_to_use, new_slug, status, agent_write_enabled). Agents cannot flip \`agent_write_enabled\` themselves — that's a session-only setting. Requires: slug.
- "list_files" — list the files inside a skill (name + position + length each). Use op="read_file" for a specific body. Requires: slug.
- "read_file" — read one file from a skill. SKILL.md is the canonical procedure entry point; supplementary files (e.g. \`examples.md\`, \`references/*.md\`) are referenced from SKILL.md and loaded on demand. Requires: slug, file_name.
- "create_file" — create a new supplementary file SKILL.md links to (\`examples.md\`, \`references/<topic>.md\`, \`templates/<name>.md\`). Cannot recreate SKILL.md (created by op="create"). Names must match \`[A-Za-z0-9._-]+\\.md\` (no slashes — flat namespace). Requires: slug, file_name.
- "write_file" — overwrite a skill file's body (PUT semantics). The whole body is replaced — read it first with op="read_file" for a partial edit AND to get the Version token; pass that as \`expected_version\` so a concurrent edit can't be silently overwritten (you'll get a 412 to reconcile instead). Requires: slug, file_name, body.
- "rename_file" — rename a file inside a skill. Cannot rename SKILL.md. Requires: slug, file_name, new_name.
- "set_visibility" — change a skill's sharing: "public" (workspace-visible) or "private" (owner-only). Owner or workspace-admin only. Team-scoped sharing (specific teams) is managed from the web UI; a team-scoped skill set here to "public" becomes workspace-wide. Requires: slug, visibility.
- "authoring_guide" — fetch the canonical skill-authoring framework: what makes a high-quality skill, how to write description + when_to_use, the canonical body section order, anti-patterns, and a quality checklist. Call before authoring any new skill (every op="create"). The framework is also loaded into the system prompt at session start; this op is the explicit affordance to re-read it deliberately when you're about to write.

Destructive deletes live in the separate \`dopl_skill_admin\` tool.`;
const SKILL_ADMIN_DESCRIPTION = `DESTRUCTIVE skill operations — separated from \`dopl_skill\` on purpose. Confirm with the user before calling. Set \`op\` to one of:
- "delete" — soft-delete an entire skill. The skill and all its files become invisible. Requires: slug.
- "delete_file" — soft-delete one file from a skill. Cannot delete SKILL.md (every skill must keep its primary file). Requires: slug, file_name.`;
function registerSkillTools(register, client) {
    register("dopl_skill", SKILL_DESCRIPTION, {
        op: zod_1.z
            .enum([
            "list",
            "get",
            "create",
            "update",
            "list_files",
            "read_file",
            "create_file",
            "write_file",
            "rename_file",
            "set_visibility",
            "authoring_guide",
        ])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("Skill slug OR stable id (the uuid from list/get output — survives renames, prefer it for held references). Required for get, update, list_files, read_file, create_file, write_file, rename_file."),
        name: zod_1.z.string().min(1).max(120).optional().describe("op=create (required) / op=update: skill name."),
        description: zod_1.z.string().min(1).max(2000).optional().describe("op=create (required) / op=update: skill description."),
        when_to_use: zod_1.z.string().min(1).max(2000).optional().describe("op=create (required) / op=update: when_to_use trigger."),
        when_not_to_use: zod_1.z.string().max(2000).nullable().optional().describe("op=create / op=update: when_not_to_use trigger."),
        new_slug: zod_1.z.string().min(1).max(80).optional().describe("op=update: rename the skill's slug."),
        status: zod_1.z.enum(["active", "draft"]).optional().describe("op=create / op=update: skill status (create defaults to active)."),
        agent_write_enabled: zod_1.z.boolean().optional().describe("op=create / op=update: agent-write toggle (agents cannot flip this on update)."),
        file_name: zod_1.z.string().optional().describe("File name, e.g. SKILL.md or examples.md. Required for read_file, create_file, write_file, rename_file."),
        new_name: zod_1.z.string().optional().describe("op=rename_file (required): the file's new name."),
        body: zod_1.z.string().max(1_048_576).optional().describe("op=create: initial SKILL.md content. op=create_file: optional initial body. op=write_file (required): the new full body."),
        expected_version: zod_1.z.string().optional().describe("op=write_file: the file's version from a prior read_file, to avoid overwriting a concurrent edit (412 on mismatch). Omit to auto-guard against the current version."),
        force: zod_1.z.boolean().optional().describe("op=write_file: overwrite even if the file changed since you read it. Discards the other edit — use only when intentional."),
        visibility: zod_1.z.enum(["public", "private"]).optional().describe("op=set_visibility: 'public' shares the skill workspace-wide (referenceable in workflows); 'private' makes it owner-only again. Owner or workspace-admin only. Team-scoped sharing is web-UI-managed."),
        detail: zod_1.z.enum(["summary", "full"]).optional().describe("op=get: 'summary' returns metadata + the file list WITHOUT file bodies (cheap orientation); 'full' (default) includes every file body."),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return opList(client);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return opGet(client, args.slug, args.detail);
            }
            case "create": {
                const miss = (0, respond_1.missingParams)("create", args, ["name", "description", "when_to_use"]);
                if (miss)
                    return miss;
                return opCreate(client, args);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["slug"]);
                if (miss)
                    return miss;
                return opUpdate(client, args);
            }
            case "list_files": {
                const miss = (0, respond_1.missingParams)("list_files", args, ["slug"]);
                if (miss)
                    return miss;
                return opListFiles(client, args.slug);
            }
            case "read_file": {
                const miss = (0, respond_1.missingParams)("read_file", args, ["slug", "file_name"]);
                if (miss)
                    return miss;
                return opReadFile(client, args.slug, args.file_name);
            }
            case "create_file": {
                const miss = (0, respond_1.missingParams)("create_file", args, ["slug", "file_name"]);
                if (miss)
                    return miss;
                return opCreateFile(client, args.slug, args.file_name, args.body);
            }
            case "write_file": {
                const miss = (0, respond_1.missingParams)("write_file", args, ["slug", "file_name", "body"]);
                if (miss)
                    return miss;
                return opWriteFile(client, args.slug, args.file_name, args.body, args.expected_version, args.force);
            }
            case "rename_file": {
                const miss = (0, respond_1.missingParams)("rename_file", args, ["slug", "file_name", "new_name"]);
                if (miss)
                    return miss;
                return opRenameFile(client, args.slug, args.file_name, args.new_name);
            }
            case "set_visibility": {
                const miss = (0, respond_1.missingParams)("set_visibility", args, ["slug", "visibility"]);
                if (miss)
                    return miss;
                return opSetVisibility(client, args.slug, args.visibility);
            }
            case "authoring_guide":
                return (0, respond_1.ok)(skill_authoring_guide_js_1.SKILL_AUTHORING_GUIDE);
        }
    });
    register("dopl_skill_admin", SKILL_ADMIN_DESCRIPTION, {
        op: zod_1.z.enum(["delete", "delete_file"]).describe("DESTRUCTIVE operation to perform."),
        slug: zod_1.z.string().optional().describe("Skill slug. Required for delete and delete_file."),
        file_name: zod_1.z.string().optional().describe("op=delete_file (required): file to soft-delete (cannot be SKILL.md)."),
    }, async (args) => {
        switch (args.op) {
            case "delete": {
                const miss = (0, respond_1.missingParams)("delete", args, ["slug"]);
                if (miss)
                    return miss;
                return opDelete(client, args.slug);
            }
            case "delete_file": {
                const miss = (0, respond_1.missingParams)("delete_file", args, ["slug", "file_name"]);
                if (miss)
                    return miss;
                return opDeleteFile(client, args.slug, args.file_name);
            }
        }
    });
}
async function opList(client) {
    const skills = await client.listSkills();
    const active = skills.filter((s) => s.status === "active");
    if (active.length === 0) {
        return (0, respond_1.ok)("No active skills in this workspace yet. Create one with `dopl_skill` op=\"create\" (requires the workspace to allow agent writes).");
    }
    const lines = ["## Skills\n"];
    for (const s of active) {
        // Show sharing scope — that's the access signal that matters.
        // Legacy `agent_write_enabled` is no longer the gate.
        const visBadge = s.visibility === "private"
            ? " _(private)_"
            : s.accessMode === "teams"
                ? " _(team-shared)_"
                : "";
        lines.push(`### \`${s.slug}\` (id: \`${s.id}\`) — ${s.name}${visBadge}`);
        lines.push(s.description);
        lines.push(`**When to use:** ${s.whenToUse}`);
        if (s.whenNotToUse) {
            lines.push(`**When NOT to use:** ${s.whenNotToUse}`);
        }
        lines.push("");
    }
    lines.push("Call `dopl_skill` op=\"get\" with a slug to load the procedure body for the skill that fits the task.");
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, slug, detail) {
    try {
        const { skill, files, references } = await client.getSkill(slug);
        const lines = [];
        lines.push(`# ${skill.name} \`${skill.slug}\``);
        const scope = skill.visibility === "private"
            ? "private"
            : skill.accessMode === "teams"
                ? "team-shared"
                : "workspace-shared";
        lines.push(`id: \`${skill.id}\` · status: ${skill.status} · sharing: ${scope} · agent-write ${skill.agentWriteEnabled ? "on" : "off"}`);
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
                    lines.push(`- KB \`${ref.slug}\` (${ref.label}) ${status}` +
                        (ref.available
                            ? ""
                            : " — broken ref; the skill mentions this KB but it isn't in the workspace."));
                }
                else {
                    const fieldHint = ref.field ? `.${ref.field}` : "";
                    lines.push(`- Connector \`${ref.provider}${fieldHint}\` (${ref.label}) ${status}`);
                }
            }
        }
        if (detail === "summary") {
            // Orientation mode: file inventory without the bodies. read_file /
            // detail="full" fetch the content.
            lines.push("");
            lines.push("## Files");
            for (const file of files) {
                lines.push(`- \`${file.name}\` (${file.body.length.toLocaleString()} chars)`);
            }
            lines.push("");
            lines.push(`_Summary view — pass detail="full" or op="read_file" for file bodies._`);
        }
        else {
            for (const file of files) {
                lines.push("");
                lines.push(`## \`${file.name}\``);
                lines.push("");
                lines.push(file.body);
            }
        }
        return (0, respond_1.ok)(lines.join("\n"));
    }
    catch (e) {
        return (0, respond_1.err)(`Skill not found or failed to load: ${slug}. ${errorMessage(e)}`);
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
            body: params.body,
        });
        const visNote = skill.visibility === "private"
            ? "Private to you — only you and your agent can see it."
            : "Visible to the whole workspace.";
        return (0, respond_1.ok)(`Created skill **${skill.name}** (slug: \`${skill.slug}\`). ` +
            `Status: ${skill.status}. ${visNote} ` +
            `SKILL.md (${primaryFile.body.length} chars) is ready to edit with \`dopl_skill\` op="write_file".`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't create skill: ${errorMessage(e)}`);
    }
}
async function opUpdate(client, params) {
    const slug = params.slug;
    try {
        const updated = await client.updateSkill(slug, {
            name: params.name,
            description: params.description,
            whenToUse: params.when_to_use,
            whenNotToUse: params.when_not_to_use,
            slug: params.new_slug,
            status: params.status,
            agentWriteEnabled: params.agent_write_enabled,
        });
        return (0, respond_1.ok)(`Updated skill **${updated.name}** (slug: \`${updated.slug}\`). Status: ${updated.status}.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't update skill \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opSetVisibility(client, slug, visibility) {
    if (visibility !== "public" && visibility !== "private") {
        return (0, respond_1.err)(`set_visibility takes visibility="public" or "private".`);
    }
    try {
        const skill = await client.updateSkill(slug, { visibility });
        return (0, respond_1.ok)(visibility === "public"
            ? `Published skill **${skill.name}** (slug: \`${skill.slug}\`) — now visible workspace-wide and referenceable in workflows.`
            : `Skill **${skill.name}** (slug: \`${skill.slug}\`) is now private — only its owner can see it.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't change sharing on \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opDelete(client, slug) {
    try {
        await client.deleteSkill(slug);
        return (0, respond_1.ok)(`Deleted skill \`${slug}\`.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't delete skill \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opListFiles(client, slug) {
    try {
        const files = await client.listSkillFiles(slug);
        if (files.length === 0)
            return (0, respond_1.ok)(`Skill \`${slug}\` has no files.`);
        const lines = [`## \`${slug}\` files\n`];
        for (const f of files) {
            lines.push(`- **\`${f.name}\`** · ${f.body.length} chars · pos ${f.position}`);
        }
        return (0, respond_1.ok)(lines.join("\n"));
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't list files for \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opReadFile(client, slug, file_name) {
    try {
        const file = await client.readSkillFile(slug, file_name);
        return (0, respond_1.ok)(`# \`${slug}\` / \`${file.name}\`\nVersion: \`${file.updatedAt}\` (pass as expected_version to write_file)\n\n${file.body}`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't read \`${file_name}\` from \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opCreateFile(client, slug, file_name, body) {
    try {
        const file = await client.createSkillFile(slug, {
            name: file_name,
            body,
        });
        return (0, respond_1.ok)(`Created \`${file.name}\` in \`${slug}\` (${file.body.length} chars).`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't create \`${file_name}\` in \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opWriteFile(client, slug, file_name, body, expected_version, force) {
    try {
        const { file, webUrl } = await client.writeSkillFile(slug, file_name, body, force ? null : expected_version);
        return (0, respond_1.ok)(`Wrote \`${file.name}\` in \`${slug}\` (${file.body.length} chars). New version: \`${file.updatedAt}\`.\nView in Dopl: ${webUrl}`);
    }
    catch (e) {
        if ((0, respond_1.isConflict)(e)) {
            return (0, respond_1.err)(`\`${file_name}\` in \`${slug}\` changed since you last read it. Call dopl_skill(op="read_file", slug, file_name) to get the current content + version, reconcile your changes, then retry write_file with that expected_version (or pass force=true to overwrite).`);
        }
        return (0, respond_1.err)(`Couldn't write \`${file_name}\` in \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opRenameFile(client, slug, file_name, new_name) {
    try {
        const file = await client.renameSkillFile(slug, file_name, new_name);
        return (0, respond_1.ok)(`Renamed \`${file_name}\` → \`${file.name}\` in \`${slug}\`.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't rename \`${file_name}\` in \`${slug}\`: ${errorMessage(e)}`);
    }
}
async function opDeleteFile(client, slug, file_name) {
    try {
        await client.deleteSkillFile(slug, file_name);
        return (0, respond_1.ok)(`Deleted \`${file_name}\` from \`${slug}\`.`);
    }
    catch (e) {
        return (0, respond_1.err)(`Couldn't delete \`${file_name}\` from \`${slug}\`: ${errorMessage(e)}`);
    }
}
