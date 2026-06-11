/**
 * `dopl_workflow` + `dopl_workflow_admin` — read/non-destructive writes and
 * the separately permission-gated destructive workflow operations.
 *
 * A workflow is a header panel plus the node graph wired to it by connectors
 * on the canvas. It owns the knowledge bases + skills its nodes reference and
 * is the unit agents follow step-by-step. Clusters group workflows.
 */

import { z } from "zod";
import type { DoplClient, WorkflowDetail } from "@dopl/client";
import { err, ok, missingParams, type RegisterTool, type ToolResponse } from "./respond";

const WORKFLOW_DESCRIPTION = `Read and AUTHOR Dopl workflows (a header + its connected node graph; the agent-followable unit). Changes appear live on an open canvas. Set \`op\` to one of:
- "list" — discover all workflows. Cheap metadata call; run it proactively to resolve a slug another op needs.
- "get" — retrieve a workflow's metadata, its topologically-ordered steps (each node's id, READ knowledge, ACTION skills, user input, agent output, next), and attached knowledge bases + skills. Node ids returned here are what update_node/remove_node/connect take.
- "create" — create a new workflow by name; spawns its header panel on the canvas and returns header_panel_id.
- "update" — rename (\`name\`) and/or set \`description\`.
- "set_graph" — DECLARATIVE authoring (preferred): pass \`graph\` = { nodes, edges } and the server makes the workflow match exactly (create/update/delete to fit). Each node has a stable \`ref\`; edges connect node \`ref\`s (or the literal "header"). Re-send to edit. Knowledge/skill ids in reads/actions auto-attach.
- "add_node" — add one node (\`node\`, incl. \`ref\`); \`connect_from\` ("header" or a node id, default "header") wires it in. Returns the new node id.
- "update_node" — patch a node's fields (\`node_id\` + \`node\`).
- "remove_node" — delete a node (\`node_id\`); its edges go with it.
- "connect" / "disconnect" — add/remove an edge (\`from\`,\`to\` = node id or "header").

Typical authoring flow: create → set_graph (or add_node + connect) → get to verify. Node reads = [{kbId} | {kbId,entryId}]; actions = [{skillId}] (ids from dopl_kb / dopl_skill). KBs/skills must be public.`;

const WORKFLOW_ADMIN_DESCRIPTION = `DESTRUCTIVE workflow operations — permanent and irreversible. Confirm intent if the user's phrasing is at all ambiguous. Set \`op\` to one of:
- "delete_workflow" — permanently delete a workflow. Its nodes stay on the canvas; attached knowledge bases + skills are detached (not deleted).`;

const zNode = z.object({
  ref: z.string().optional().describe("stable handle for this node (required for set_graph + add_node)"),
  title: z.string().optional(),
  description: z.string().optional(),
  reads: z
    .array(z.object({ kbId: z.string(), entryId: z.string().optional() }))
    .optional()
    .describe("knowledge to READ: [{kbId} | {kbId, entryId}]"),
  actions: z
    .array(z.object({ skillId: z.string() }))
    .optional()
    .describe("skills to APPLY: [{skillId}]"),
  userInput: z.string().optional(),
  agentOutput: z.string().optional(),
  nextInstructions: z.string().optional(),
});

const zGraph = z.object({
  nodes: z.array(zNode),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});

export function registerWorkflowTools(
  register: RegisterTool,
  client: DoplClient,
): void {
  register(
    "dopl_workflow",
    WORKFLOW_DESCRIPTION,
    {
      op: z
        .enum([
          "list",
          "get",
          "create",
          "update",
          "set_graph",
          "add_node",
          "update_node",
          "remove_node",
          "connect",
          "disconnect",
        ])
        .describe("Operation to perform."),
      slug: z
        .string()
        .optional()
        .describe("Workflow slug (from op=list) — required for every op except list/create."),
      name: z
        .string()
        .optional()
        .describe("op=create: workflow name. op=update: new name."),
      description: z
        .string()
        .max(300, "description is capped at 300 chars")
        .optional()
        .describe("op=update: workflow description (max 300 chars)."),
      graph: zGraph.optional().describe("op=set_graph: the full { nodes, edges } the workflow should match."),
      node: zNode.optional().describe("op=add_node/update_node: the node's fields."),
      connect_from: z
        .string()
        .optional()
        .describe("op=add_node: 'header' or a node id to connect the new node from (default 'header')."),
      node_id: z.string().optional().describe("op=update_node/remove_node: target node id (from op=get)."),
      from: z.string().optional().describe("op=connect/disconnect: source node id or 'header'."),
      to: z.string().optional().describe("op=connect/disconnect: target node id or 'header'."),
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
        case "set_graph": {
          const miss = missingParams("set_graph", args, ["slug", "graph"]);
          if (miss) return miss;
          return opSetGraph(client, args.slug as string, args.graph as z.infer<typeof zGraph>);
        }
        case "add_node": {
          const miss = missingParams("add_node", args, ["slug", "node"]);
          if (miss) return miss;
          const node = args.node as z.infer<typeof zNode>;
          if (!node.ref) return err("add_node needs `node.ref` (a stable handle).");
          return opAddNode(client, args.slug as string, node, args.connect_from as string | undefined);
        }
        case "update_node": {
          const miss = missingParams("update_node", args, ["slug", "node_id", "node"]);
          if (miss) return miss;
          return opUpdateNode(client, args.slug as string, args.node_id as string, args.node as z.infer<typeof zNode>);
        }
        case "remove_node": {
          const miss = missingParams("remove_node", args, ["slug", "node_id"]);
          if (miss) return miss;
          return opRemoveNode(client, args.slug as string, args.node_id as string);
        }
        case "connect": {
          const miss = missingParams("connect", args, ["slug", "from", "to"]);
          if (miss) return miss;
          return opConnect(client, args.slug as string, args.from as string, args.to as string);
        }
        case "disconnect": {
          const miss = missingParams("disconnect", args, ["slug", "from", "to"]);
          if (miss) return miss;
          return opDisconnect(client, args.slug as string, args.from as string, args.to as string);
        }
      }
    },
  );

  register(
    "dopl_workflow_admin",
    WORKFLOW_ADMIN_DESCRIPTION,
    {
      op: z.enum(["delete_workflow"]).describe("Destructive operation."),
      slug: z.string().optional().describe("op=delete_workflow: workflow slug."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "delete_workflow": {
          const miss = missingParams("delete_workflow", args, ["slug"]);
          if (miss) return miss;
          await client.deleteWorkflow(args.slug as string);
          return ok(
            `Deleted workflow \`${args.slug}\`. Nodes stay on the canvas; attached knowledge bases + skills remain.`
          );
        }
      }
    },
  );
}

// ── ops ──────────────────────────────────────────────────────────────

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

async function opList(client: DoplClient): Promise<ToolResponse> {
  const { workflows } = await client.listWorkflows();
  if (workflows.length === 0) return ok("No workflows found.");
  const lines = workflows.map((w) => {
    const kbs = w.knowledge_base_count ?? 0;
    const skills = w.skill_count ?? 0;
    const summary =
      kbs === 0 && skills === 0
        ? "empty"
        : [
            kbs > 0 ? plural(kbs, "knowledge base") : null,
            skills > 0 ? plural(skills, "skill") : null,
          ]
            .filter(Boolean)
            .join(" · ");
    return `- **${w.name}** (slug: \`${w.slug}\`) — ${summary}`;
  });
  return ok(lines.join("\n"));
}

async function opGet(client: DoplClient, slug: string): Promise<ToolResponse> {
  const wf: WorkflowDetail = await client.getWorkflow(slug);
  const lines: string[] = [];
  lines.push(`# Workflow: ${wf.name}`);
  lines.push(`Slug: \`${wf.slug}\``);
  if (wf.description) lines.push(wf.description);
  lines.push("");

  const steps = wf.graph?.nodes ?? [];
  if (steps.length > 0) {
    lines.push(`## Steps (${steps.length})`);
    lines.push(
      `Topologically ordered. Follow them in order; each step lists what to READ (knowledge), which ACTIONS (skills) to apply, expected user input, the output to produce, and when to advance.`
    );
    lines.push("");
    for (let i = 0; i < steps.length; i++) {
      const n = steps[i];
      lines.push(`### Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\``);
      if (n.description) lines.push(n.description);
      if (n.reads.length > 0) {
        lines.push(
          `- Read: ${n.reads
            .map((r) =>
              r.kind === "file"
                ? `${r.name} (file, kb_id: ${r.kbId}, entry_id: ${r.entryId})`
                : `${r.name} (knowledge base, kb_id: ${r.kbId})`
            )
            .join("; ")}`
        );
      }
      if (n.actions.length > 0) {
        lines.push(
          `- Action: ${n.actions
            .map((a) => `${a.name} (skill, skill_id: ${a.skillId})`)
            .join("; ")}`
        );
      }
      if (n.userInput) lines.push(`- User input: ${n.userInput}`);
      if (n.agentOutput) lines.push(`- Agent output: ${n.agentOutput}`);
      if (n.nextInstructions) lines.push(`- Next: ${n.nextInstructions}`);
      lines.push("");
    }
    const edges = wf.graph?.edges ?? [];
    if (edges.length > 0) {
      lines.push(
        `Connections: ${edges.map((e) => `\`${e.from}\` → \`${e.to}\``).join(", ")}`
      );
      lines.push("");
    }
  } else {
    lines.push("_No nodes wired into this workflow yet._");
    lines.push("");
  }

  if (wf.knowledge_bases.length > 0) {
    lines.push(`## Knowledge Bases\n`);
    for (const kb of wf.knowledge_bases) {
      lines.push(`### ${kb.name}`);
      lines.push(`slug: \`${kb.slug}\` · id: \`${kb.knowledge_base_id}\``);
      if (kb.description) lines.push(kb.description);
      if (kb.entries_index.length > 0) {
        lines.push(`\nEntries (${kb.entries_index.length}):`);
        for (const e of kb.entries_index.slice(0, 50)) {
          const path = e.folder_path ? `${e.folder_path}/${e.title}` : e.title;
          lines.push(`- ${path}  \`(entry_id: ${e.entry_id})\``);
        }
      }
      lines.push("");
    }
  }

  if (wf.skills.length > 0) {
    lines.push(`## Skills\n`);
    for (const sk of wf.skills) {
      lines.push(`### ${sk.name}`);
      lines.push(`slug: \`${sk.slug}\` · id: \`${sk.skill_id}\` · status: ${sk.status}`);
      if (sk.description) lines.push(sk.description);
      if (sk.when_to_use) lines.push(`\n**When to use:** ${sk.when_to_use}`);
      if (sk.body) lines.push(`\nProcedure (truncated):\n${sk.body}`);
      lines.push("");
    }
  }

  return ok(lines.join("\n"));
}

async function opCreate(client: DoplClient, name: string): Promise<ToolResponse> {
  const wf = await client.createWorkflow(name);
  return ok(
    `Created workflow **${wf.name}** (slug: \`${wf.slug}\`)${wf.header_panel_id ? `, header panel \`${wf.header_panel_id}\`` : ""}. Now author its graph with op="set_graph" (or add_node + connect), then op="get" to verify.`
  );
}

async function opUpdate(
  client: DoplClient,
  slug: string,
  name: string | undefined,
  description: string | undefined,
): Promise<ToolResponse> {
  const wf = await client.updateWorkflow(slug, { name, description });
  return ok(`Updated workflow **${wf.name}** (slug: \`${wf.slug}\`).`);
}

async function opSetGraph(
  client: DoplClient,
  slug: string,
  graph: { nodes: Array<{ ref?: string }>; edges: Array<{ from: string; to: string }> },
): Promise<ToolResponse> {
  // ref is required for every node in set_graph.
  for (const n of graph.nodes) {
    if (!n.ref) return err("Every node in `graph.nodes` needs a `ref`.");
  }
  await client.setWorkflowGraph(slug, graph as Parameters<DoplClient["setWorkflowGraph"]>[1]);
  return ok(
    `Set workflow \`${slug}\` graph: ${graph.nodes.length} node(s), ${graph.edges.length} edge(s). Run op="get" to see the ordered steps.`
  );
}

async function opAddNode(
  client: DoplClient,
  slug: string,
  node: Record<string, unknown>,
  connectFrom: string | undefined,
): Promise<ToolResponse> {
  const payload = { ...node, connect_from: connectFrom } as unknown as Parameters<
    DoplClient["addWorkflowNode"]
  >[1];
  const { node_id } = await client.addWorkflowNode(slug, payload);
  return ok(`Added node \`${node_id}\` to workflow \`${slug}\` (connected from ${connectFrom ?? "header"}).`);
}

async function opUpdateNode(
  client: DoplClient,
  slug: string,
  nodeId: string,
  node: Record<string, unknown>,
): Promise<ToolResponse> {
  await client.updateWorkflowNode(
    slug,
    nodeId,
    node as unknown as Parameters<DoplClient["updateWorkflowNode"]>[2]
  );
  return ok(`Updated node \`${nodeId}\` in workflow \`${slug}\`.`);
}

async function opRemoveNode(
  client: DoplClient,
  slug: string,
  nodeId: string,
): Promise<ToolResponse> {
  await client.removeWorkflowNode(slug, nodeId);
  return ok(`Removed node \`${nodeId}\` from workflow \`${slug}\`.`);
}

async function opConnect(
  client: DoplClient,
  slug: string,
  from: string,
  to: string,
): Promise<ToolResponse> {
  await client.connectWorkflow(slug, from, to);
  return ok(`Connected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}

async function opDisconnect(
  client: DoplClient,
  slug: string,
  from: string,
  to: string,
): Promise<ToolResponse> {
  await client.disconnectWorkflow(slug, from, to);
  return ok(`Disconnected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}
