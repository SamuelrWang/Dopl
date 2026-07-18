"use strict";
/**
 * `dopl_cluster` + `dopl_cluster_admin` — clusters are non-spatial
 * CONTAINERS that group workflows. KB/skill attachments + the step graph
 * live on the workflows themselves (see dopl_workflow); a cluster only
 * carries a name/description and the list of workflows assigned to it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerClusterTools = registerClusterTools;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const CLUSTER_DESCRIPTION = `Read and non-destructively modify Dopl clusters (containers that group related workflows). Set \`op\` to one of:
- "list" — discover all clusters and how many workflows each holds. Cheap metadata call; run it proactively to show the user their workspace.
- "get" — retrieve a cluster's metadata plus the workflows assigned to it. Inspect a workflow's steps + knowledge/skills with dopl_workflow(op="get", slug).
- "create" — create a new, empty cluster by name. Assign workflows to it with dopl_workflow(op="set_cluster").
- "update" — rename a cluster (\`name\`) and/or set its \`description\`.

Note on names: a cluster's display name is canonicalized to UPPER_SNAKE_CASE (spaces become underscores, e.g. "my analysis" → "MY_ANALYSIS") so the stored name, the canvas tab, and this tool's output all agree. The URL slug stays lowercase-hyphen. Match clusters by slug or stable id (not by the name you passed).`;
const CLUSTER_ADMIN_DESCRIPTION = `DESTRUCTIVE cluster operations — permanent and irreversible. Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_cluster" — permanently delete a cluster container. Its workflows survive (they just lose their cluster grouping).`;
function registerClusterTools(register, client) {
    register("dopl_cluster", CLUSTER_DESCRIPTION, {
        op: zod_1.z
            .enum(["list", "get", "create", "update"])
            .describe("Operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=get/update: cluster slug OR stable id (the uuid from op=list — survives renames, prefer it for held references)."),
        name: zod_1.z
            .string()
            .optional()
            .describe("op=create: cluster name. op=update: new cluster name."),
        description: zod_1.z
            .string()
            .max(300, "description is capped at 300 chars")
            .optional()
            .describe("op=update: cluster description (max 300 chars)."),
    }, async (args) => {
        switch (args.op) {
            case "list":
                return opList(client);
            case "get": {
                const miss = (0, respond_1.missingParams)("get", args, ["slug"]);
                if (miss)
                    return miss;
                return opGet(client, args.slug);
            }
            case "create": {
                const miss = (0, respond_1.missingParams)("create", args, ["name"]);
                if (miss)
                    return miss;
                return opCreate(client, args.name);
            }
            case "update": {
                const miss = (0, respond_1.missingParams)("update", args, ["slug"]);
                if (miss)
                    return miss;
                if (args.name === undefined && args.description === undefined) {
                    return (0, respond_1.err)("update needs `name` and/or `description`.");
                }
                return opUpdate(client, args.slug, args.name, args.description);
            }
        }
    });
    register("dopl_cluster_admin", CLUSTER_ADMIN_DESCRIPTION, {
        op: zod_1.z
            .enum(["delete_cluster"])
            .describe("Destructive operation to perform."),
        slug: zod_1.z
            .string()
            .optional()
            .describe("op=delete_cluster: cluster slug or stable id."),
    }, async (args) => {
        switch (args.op) {
            case "delete_cluster": {
                const miss = (0, respond_1.missingParams)("delete_cluster", args, ["slug"]);
                if (miss)
                    return miss;
                return opDeleteCluster(client, args.slug);
            }
        }
    });
}
// ── dopl_cluster ops ─────────────────────────────────────────────────
function plural(n, noun) {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
async function opList(client) {
    const { clusters } = await client.listClusters();
    if (clusters.length === 0)
        return (0, respond_1.ok)("No clusters found.");
    const lines = clusters.map((c) => {
        const count = c.workflow_count ?? 0;
        const names = c.workflow_names?.length
            ? ` (${c.workflow_names.join(", ")})`
            : "";
        const summary = count === 0 ? "empty" : `${plural(count, "workflow")}${names}`;
        return `- **${c.name}** (slug: \`${c.slug}\` · id: \`${c.id}\`) — ${summary}`;
    });
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGet(client, slug) {
    let cluster;
    try {
        cluster = await client.getCluster(slug);
    }
    catch (e) {
        // Turn a backend 404 into clear, recoverable guidance instead of
        // leaking the raw "HTTP 404: {json}" transport error (audit F-18).
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No cluster \`${slug}\` in this workspace. Run dopl_cluster(op="list") to see valid slugs/ids.`);
        }
        throw e;
    }
    const lines = [];
    lines.push(`# Cluster: ${cluster.name}`);
    lines.push(`Slug: \`${cluster.slug}\` · id: \`${cluster.id}\` · updated ${cluster.updated_at}`);
    if (cluster.description)
        lines.push(cluster.description);
    lines.push("");
    const workflows = cluster.workflows ?? [];
    if (workflows.length === 0) {
        lines.push("_No workflows in this cluster yet._");
    }
    else {
        lines.push(`## Workflows (${workflows.length})`);
        for (const w of workflows) {
            lines.push(`- **${w.name}** (slug: \`${w.slug}\`)${w.description ? ` — ${w.description}` : ""}`);
        }
        lines.push("");
        lines.push(`Read a workflow's steps + knowledge/skills with \`dopl_workflow({ op: "get", slug: "<workflow-slug>" })\`.`);
    }
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opCreate(client, name) {
    // missingParams catches "" but not a whitespace-only name, which would
    // slugify to the generic "cluster" and land a blank-named junk row.
    if (!name.trim())
        return (0, respond_1.err)("`name` can't be blank.");
    const result = await client.createCluster(name);
    return (0, respond_1.ok)(`Created cluster **${result.name}** (slug: \`${result.slug}\`). Assign workflows to it from the canvas.`);
}
async function opUpdate(client, slug, name, description) {
    if (name !== undefined && !name.trim()) {
        return (0, respond_1.err)("`name` can't be blank.");
    }
    let result;
    try {
        result = await client.updateCluster(slug, { name, description });
    }
    catch (e) {
        // Friendly not-found instead of a raw "HTTP 404: {json}" (audit F-18).
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No cluster \`${slug}\` in this workspace. Run dopl_cluster(op="list") to see valid slugs/ids.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Updated cluster **${result.name}** (slug: \`${result.slug}\`).`);
}
// ── dopl_cluster_admin ops ───────────────────────────────────────────
async function opDeleteCluster(client, slug) {
    try {
        await client.deleteCluster(slug);
    }
    catch (e) {
        // The backend now 404s when the slug matched no cluster in this
        // workspace; turn that into a clear "nothing deleted" instead of a
        // false success (or an opaque throw the framework would expose).
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No cluster \`${slug}\` in this workspace — nothing deleted. Run dopl_cluster(op="list") to see valid slugs.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Deleted cluster \`${slug}\`. Its workflows survive (ungrouped).`);
}
