/**
 * `dopl_cluster` + `dopl_cluster_admin` — clusters are non-spatial
 * CONTAINERS that group workflows. KB/skill attachments + the node graph
 * live on the workflows themselves (see dopl_workflow); a cluster only
 * carries a name/description and the list of workflows assigned to it.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { err, ok, isNotFound, missingParams, type RegisterTool, type ToolResponse } from "./respond";

const CLUSTER_DESCRIPTION = `Read and non-destructively modify Dopl clusters (containers that group related workflows). Set \`op\` to one of:
- "list" — discover all clusters and how many workflows each holds. Cheap metadata call; run it proactively to show the user their workspace.
- "get" — retrieve a cluster's metadata plus the workflows assigned to it. Inspect a workflow's steps + knowledge/skills with dopl_workflow(op="get", slug).
- "create" — create a new, empty cluster by name. Assign workflows to it from the canvas.
- "update" — rename a cluster (\`name\`) and/or set its \`description\`.`;

const CLUSTER_ADMIN_DESCRIPTION = `DESTRUCTIVE cluster operations — permanent and irreversible. Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_cluster" — permanently delete a cluster container. Its workflows survive (they just lose their cluster grouping).`;

export function registerClusterTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_cluster",
    CLUSTER_DESCRIPTION,
    {
      op: z
        .enum(["list", "get", "create", "update"])
        .describe("Operation to perform."),
      slug: z
        .string()
        .optional()
        .describe("op=get/update: cluster slug OR stable id (the uuid from op=list — survives renames, prefer it for held references)."),
      name: z
        .string()
        .optional()
        .describe("op=create: cluster name. op=update: new cluster name."),
      description: z
        .string()
        .max(300, "description is capped at 300 chars")
        .optional()
        .describe("op=update: cluster description (max 300 chars)."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "list":
          return opList(client);
        case "get": {
          const miss = missingParams("get", args, ["slug"]);
          if (miss) return miss;
          return opGet(client, args.slug as string);
        }
        case "create": {
          const miss = missingParams("create", args, ["name"]);
          if (miss) return miss;
          return opCreate(client, args.name as string);
        }
        case "update": {
          const miss = missingParams("update", args, ["slug"]);
          if (miss) return miss;
          if (args.name === undefined && args.description === undefined) {
            return err("update needs `name` and/or `description`.");
          }
          return opUpdate(
            client,
            args.slug as string,
            args.name as string | undefined,
            args.description as string | undefined
          );
        }
      }
    },
  );

  register(
    "dopl_cluster_admin",
    CLUSTER_ADMIN_DESCRIPTION,
    {
      op: z
        .enum(["delete_cluster"])
        .describe("Destructive operation to perform."),
      slug: z
        .string()
        .optional()
        .describe("op=delete_cluster: cluster slug or stable id."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "delete_cluster": {
          const miss = missingParams("delete_cluster", args, ["slug"]);
          if (miss) return miss;
          return opDeleteCluster(client, args.slug as string);
        }
      }
    },
  );
}

// ── dopl_cluster ops ─────────────────────────────────────────────────

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

async function opList(client: DoplClient): Promise<ToolResponse> {
  const { clusters } = await client.listClusters();
  if (clusters.length === 0) return ok("No clusters found.");
  const lines = clusters.map((c) => {
    const count = c.workflow_count ?? 0;
    const names = c.workflow_names?.length
      ? ` (${c.workflow_names.join(", ")})`
      : "";
    const summary = count === 0 ? "empty" : `${plural(count, "workflow")}${names}`;
    return `- **${c.name}** (slug: \`${c.slug}\` · id: \`${c.id}\`) — ${summary}`;
  });
  return ok(lines.join("\n"));
}

async function opGet(client: DoplClient, slug: string): Promise<ToolResponse> {
  const cluster = await client.getCluster(slug);
  const lines: string[] = [];
  lines.push(`# Cluster: ${cluster.name}`);
  lines.push(`Slug: \`${cluster.slug}\` · id: \`${cluster.id}\` · updated ${cluster.updated_at}`);
  if (cluster.description) lines.push(cluster.description);
  lines.push("");

  const workflows = cluster.workflows ?? [];
  if (workflows.length === 0) {
    lines.push("_No workflows in this cluster yet._");
  } else {
    lines.push(`## Workflows (${workflows.length})`);
    for (const w of workflows) {
      lines.push(`- **${w.name}** (slug: \`${w.slug}\`)${w.description ? ` — ${w.description}` : ""}`);
    }
    lines.push("");
    lines.push(
      `Read a workflow's steps + knowledge/skills with \`dopl_workflow({ op: "get", slug: "<workflow-slug>" })\`.`
    );
  }

  return ok(lines.join("\n"));
}

async function opCreate(
  client: DoplClient,
  name: string,
): Promise<ToolResponse> {
  // missingParams catches "" but not a whitespace-only name, which would
  // slugify to the generic "cluster" and land a blank-named junk row.
  if (!name.trim()) return err("`name` can't be blank.");
  const result = await client.createCluster(name);
  return ok(
    `Created cluster **${result.name}** (slug: \`${result.slug}\`). Assign workflows to it from the canvas.`
  );
}

async function opUpdate(
  client: DoplClient,
  slug: string,
  name: string | undefined,
  description: string | undefined,
): Promise<ToolResponse> {
  if (name !== undefined && !name.trim()) {
    return err("`name` can't be blank.");
  }
  const result = await client.updateCluster(slug, { name, description });
  return ok(`Updated cluster **${result.name}** (slug: \`${result.slug}\`).`);
}

// ── dopl_cluster_admin ops ───────────────────────────────────────────

async function opDeleteCluster(
  client: DoplClient,
  slug: string,
): Promise<ToolResponse> {
  try {
    await client.deleteCluster(slug);
  } catch (e) {
    // The backend now 404s when the slug matched no cluster in this
    // workspace; turn that into a clear "nothing deleted" instead of a
    // false success (or an opaque throw the framework would expose).
    if (isNotFound(e)) {
      return err(
        `No cluster \`${slug}\` in this workspace — nothing deleted. Run dopl_cluster(op="list") to see valid slugs.`,
      );
    }
    throw e;
  }
  return ok(`Deleted cluster \`${slug}\`. Its workflows survive (ungrouped).`);
}
