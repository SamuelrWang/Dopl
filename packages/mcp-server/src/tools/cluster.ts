/**
 * `dopl_cluster` + `dopl_cluster_admin` — clusters are non-spatial
 * CONTAINERS that group workflows. KB/skill attachments + the step graph
 * live on the workflows themselves (see dopl_workflow); a cluster only
 * carries a name/description and the list of workflows assigned to it.
 */

import { z } from "zod";
import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { err, ok, isNotFound, missingParams, type RegisterTool, type ToolResponse } from "./respond";

/**
 * Clusters, and the workflows inside them, are WORKSPACE-scoped: any member can
 * create or rename one, and every member reads the result. `clusters.name` /
 * `.description` are `max(120)` / `max(300)` with no charset rule, so
 * `# Cluster: ${cluster.name}` was a real markdown heading a member could put a
 * newline in. Names and descriptions are labels here — the cluster carries no
 * prose the agent is meant to follow — so all of them are values.
 */
const NO_NAME = "`(unnamed)`";

/**
 * THE ONE PLACE IN THIS SWEEP WHERE THE LISTING SHOWED TOO MUCH, NOT TOO LITTLE
 * — and it was a real disclosure, not a wording problem.
 *
 * `clusters` carries no `access_mode` and no `deleted_at`, so the cluster rows
 * really are all of them. But the workflow rollup underneath
 * (features/clusters/server/service.ts) applied NO effective-access filter
 * while `dopl_workflow(op="list")` applied one, so a cluster's
 * `workflow_count` / `workflow_names` included team-scoped workflows the
 * caller could not open and op="get" handed back their names, slugs and
 * descriptions. The count leaked on its own: it said how many existed.
 *
 * FIXED SERVER-SIDE. Both tools now run the SAME rule
 * (`filterTeamVisibleWorkflows`, workflows/server/service-shared.ts), so this
 * note no longer warns of an overcount — it states the filter, which is what
 * every other listing in this surface does, and it says the two tools agree so
 * an agent that spots a difference treats it as news rather than as noise.
 */
const WORKFLOW_SCOPE_NOTE = `_Workflow names and counts here are filtered to what YOU CAN READ, by the same rule as dopl_workflow(op="list") — the two agree — and trashed workflows are excluded. Team-scoped workflows you hold no grant on are absent and are not counted, so this is not the cluster's total._`;

const CLUSTER_DESCRIPTION = `Read and non-destructively modify Dopl clusters (containers that group related workflows). Set \`op\` to one of:
- "list" — every cluster in the workspace (clusters carry no visibility of their own) and how many workflows each holds THAT YOU CAN READ. The workflow COUNTS and NAMES are filtered by the same rule as dopl_workflow(op="list"), and exclude trashed workflows: team-scoped workflows you hold no grant on are neither named nor counted, so a cluster's count is not its total. Cheap metadata call; run it proactively to show the user their workspace.
- "get" — a cluster's metadata plus the workflows assigned to it that YOU CAN READ. Same filter as op="list", so a cluster whose workflows are all team-scoped away from you comes back with an empty list rather than as not-found — the cluster itself is visible to every member. Inspect a workflow's steps + knowledge/skills with dopl_workflow(op="get", slug).
- "create" — create a new, empty cluster by name. Assign workflows to it with dopl_workflow(op="set_cluster").
- "update" — rename a cluster (\`name\`) and/or set its \`description\`.

Note on names: a cluster's display name is canonicalized to UPPER_SNAKE_CASE (spaces become underscores, e.g. "my analysis" → "MY_ANALYSIS") so the stored name, the canvas tab, and this tool's output all agree. The URL slug stays lowercase-hyphen. Match clusters by slug or stable id (not by the name you passed).`;

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
      ? ` (${c.workflow_names.map((n) => inlineOr(n, NO_NAME)).join(", ")})`
      : "";
    // "empty" was safe while the rollup was unfiltered. Now that a cluster's
    // team-scoped workflows are correctly withheld, a bare "empty" would be the
    // same lie one layer down: zero VISIBLE is not zero.
    const summary =
      count === 0
        ? "no workflows visible to you"
        : `${plural(count, "workflow")}${names}`;
    return `- ${inlineOr(c.name, NO_NAME)} (slug: \`${c.slug}\` · id: \`${c.id}\`) — ${summary}`;
  });
  // Only worth saying when a workflow was actually named or counted.
  const anyWorkflows = clusters.some((c) => (c.workflow_count ?? 0) > 0);
  return ok(
    anyWorkflows ? [...lines, "", WORKFLOW_SCOPE_NOTE].join("\n") : lines.join("\n"),
  );
}

async function opGet(client: DoplClient, slug: string): Promise<ToolResponse> {
  let cluster;
  try {
    cluster = await client.getCluster(slug);
  } catch (e) {
    // Turn a backend 404 into clear, recoverable guidance instead of
    // leaking the raw "HTTP 404: {json}" transport error (audit F-18).
    if (isNotFound(e)) {
      return err(
        `No cluster \`${slug}\` in this workspace. Run dopl_cluster(op="list") to see valid slugs/ids.`,
      );
    }
    throw e;
  }
  const lines: string[] = [];
  lines.push(`# Cluster ${inlineOr(cluster.name, NO_NAME)}`);
  lines.push(`Slug: \`${cluster.slug}\` · id: \`${cluster.id}\` · updated ${cluster.updated_at}`);
  if (cluster.description) lines.push(inlineOr(cluster.description, ""));
  lines.push("");

  const workflows = cluster.workflows ?? [];
  if (workflows.length === 0) {
    // Same reason as op="list": with the rollup filtered, an empty list means
    // "none you can read", which is not the same claim as "none exist".
    lines.push(
      "_No workflows in this cluster that you can read. Team-scoped workflows you hold no grant on, and trashed ones, are not listed._"
    );
  } else {
    lines.push(`## Workflows (${workflows.length})`);
    for (const w of workflows) {
      const desc = w.description ? ` — ${inlineOr(w.description, "")}` : "";
      lines.push(`- ${inlineOr(w.name, NO_NAME)} (slug: \`${w.slug}\`)${desc}`);
    }
    lines.push("");
    lines.push(
      `Read a workflow's steps + knowledge/skills with \`dopl_workflow({ op: "get", slug: "<workflow-slug>" })\`.`
    );
    lines.push("", WORKFLOW_SCOPE_NOTE);
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
    `Created cluster ${inlineOr(result.name, NO_NAME)} (slug: \`${result.slug}\`). Assign workflows to it from the canvas.`
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
  let result;
  try {
    result = await client.updateCluster(slug, { name, description });
  } catch (e) {
    // Friendly not-found instead of a raw "HTTP 404: {json}" (audit F-18).
    if (isNotFound(e)) {
      return err(
        `No cluster \`${slug}\` in this workspace. Run dopl_cluster(op="list") to see valid slugs/ids.`,
      );
    }
    throw e;
  }
  return ok(`Updated cluster ${inlineOr(result.name, NO_NAME)} (slug: \`${result.slug}\`).`);
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
