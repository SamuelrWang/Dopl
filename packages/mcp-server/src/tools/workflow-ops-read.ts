/**
 * `dopl_workflow` READ op handlers: list, get (metadata + topo-ordered
 * steps + attachments, summary|full), step (one step's walk detail), and
 * list_trash (the recovery surface). Non-mutating. Routed from the
 * registrar in workflow.ts.
 */

import type { DoplClient, WorkflowDetail } from "@dopl/client";
import { err, ok, type ToolResponse } from "./respond";
import {
  plural,
  renderActions,
  renderReads,
  type GraphEdge,
} from "./workflow-render";

export async function opList(client: DoplClient): Promise<ToolResponse> {
  const { workflows } = await client.listWorkflows();
  if (workflows.length === 0) return ok("No workflows found.");
  const lines = workflows.map((w) => {
    const steps = w.step_count ?? 0;
    const kbs = w.knowledge_base_count ?? 0;
    const skills = w.skill_count ?? 0;
    const parts = [
      steps > 0 ? plural(steps, "step") : null,
      kbs > 0 ? plural(kbs, "knowledge base") : null,
      skills > 0 ? plural(skills, "skill") : null,
    ].filter(Boolean);
    const summary = parts.length === 0 ? "empty" : parts.join(" · ");
    return `- **${w.name}** (slug: \`${w.slug}\`) — ${summary}`;
  });
  return ok(lines.join("\n"));
}

export async function opGet(
  client: DoplClient,
  slug: string,
  detail?: "summary" | "full"
): Promise<ToolResponse> {
  const wf: WorkflowDetail = await client.getWorkflow(slug);
  const summaryOnly = detail === "summary";
  const lines: string[] = [];
  lines.push(`# Workflow: ${wf.name}`);
  lines.push(
    `Slug: \`${wf.slug}\` · id: \`${wf.id}\`${wf.cluster_id ? ` · cluster id: \`${wf.cluster_id}\`` : " · no cluster"} · updated ${wf.updated_at}`,
  );
  if (wf.description) lines.push(wf.description);
  lines.push("");

  const steps = wf.graph?.nodes ?? [];
  if (steps.length > 0) {
    const graphEdges = wf.graph?.edges ?? [];
    // ── Hierarchy: stages + per-step dependencies ────────────────────
    // Stage = longest-path depth from the entry steps (steps arrive
    // topologically sorted, so one forward relaxation pass suffices;
    // a cycle degrades gracefully to flat stages). Steps sharing a
    // stage have no dependency between them → parallel branches.
    const stage = new Map<string, number>(steps.map((n) => [n.id, 0]));
    for (const n of steps) {
      for (const e of graphEdges) {
        if (e.from !== n.id) continue;
        stage.set(
          e.to,
          Math.max(stage.get(e.to) ?? 0, (stage.get(n.id) ?? 0) + 1)
        );
      }
    }
    const stepNo = new Map(steps.map((n, i) => [n.id, i + 1]));
    const label = (id: string) => `Step ${stepNo.get(id)} (\`${id}\`)`;
    const prevOf = (id: string) =>
      graphEdges.filter((e) => e.to === id).map((e) => e.from);
    const nextEdgesOf = (id: string) => graphEdges.filter((e) => e.from === id);
    const stageCount = Math.max(...[...stage.values()]) + 1;

    if (summaryOnly) {
      lines.push(`## Steps (${steps.length}) — ${plural(stageCount, "stage")}`);
      for (let i = 0; i < steps.length; i++) {
        const n = steps[i];
        lines.push(
          `- Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\` — stage ${(stage.get(n.id) ?? 0) + 1}`
        );
      }
      lines.push("");
    } else {
    lines.push(`## Steps (${steps.length}) — execution order`);
    lines.push(
      `Topologically ordered into ${plural(stageCount, "stage")}. Stages run IN SEQUENCE; steps in the SAME stage have no dependency between them and are parallel branches — do them in any order (or concurrently) before moving to the next stage. Each step's "Depends on" / "Leads to" lines give the exact edges (with branch conditions). Per step: READ (knowledge), ACTIONS (skills), expected user input, the output to produce, and when to advance.`
    );
    lines.push("");
    for (let i = 0; i < steps.length; i++) {
      const n = steps[i];
      lines.push(
        `### Step ${i + 1}: ${n.title || "(untitled)"} \`${n.id}\` (ref: \`${n.ref}\`) — stage ${(stage.get(n.id) ?? 0) + 1} of ${stageCount}`
      );
      if (n.description) lines.push(n.description);
      const prev = prevOf(n.id);
      const next = nextEdgesOf(n.id);
      lines.push(
        prev.length === 0
          ? `- Depends on: nothing — entry step`
          : `- Depends on: ${prev.map(label).join(", ")}${prev.length > 1 ? " (all must be done first)" : ""}`
      );
      lines.push(
        next.length === 0
          ? `- Leads to: nothing — terminal step`
          : `- Leads to: ${next.map((e) => `${label(e.to)}${e.condition ? ` when ${e.condition}` : ""}`).join(", ")}${next.length > 1 ? " (branches)" : ""}`
      );
      if (n.reads.length > 0) lines.push(`- Read: ${renderReads(n.reads)}`);
      if (n.actions.length > 0) lines.push(`- Action: ${renderActions(n.actions)}`);
      if (n.userInput) lines.push(`- User input: ${n.userInput}`);
      if (n.agentOutput) lines.push(`- Agent output: ${n.agentOutput}`);
      if (n.nextInstructions) lines.push(`- Next: ${n.nextInstructions}`);
      lines.push("");
    }
    if (graphEdges.length > 0) {
      lines.push(
        `Connections: ${graphEdges.map((e) => `\`${e.from}\` → \`${e.to}\`${e.condition ? ` [${e.condition}]` : ""}`).join(", ")}`
      );
      lines.push("");
    }
    }
  } else {
    lines.push("_No steps authored into this workflow yet._");
    lines.push("");
  }

  if (wf.knowledge_bases.length > 0) {
    if (summaryOnly) {
      lines.push(
        `## Knowledge Bases: ${wf.knowledge_bases
          .map((kb) => `${kb.name} (\`${kb.slug}\`, ${kb.entries_index.length} entries)`)
          .join(", ")}`
      );
      lines.push("");
    } else {
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
  }

  if (wf.skills.length > 0) {
    if (summaryOnly) {
      lines.push(
        `## Skills: ${wf.skills
          .map((sk) => `${sk.name} (\`${sk.slug}\`, ${sk.status})`)
          .join(", ")}`
      );
      lines.push("");
    } else {
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
  }

  if (summaryOnly) {
    lines.push(
      `_Summary view — pass detail="full" for step details, entry indexes, and skill procedures._`
    );
  }

  return ok(lines.join("\n"));
}

export async function opStep(
  client: DoplClient,
  slug: string,
  stepRef: string,
): Promise<ToolResponse> {
  const wf: WorkflowDetail = await client.getWorkflow(slug);
  const steps = wf.graph?.nodes ?? [];
  const edges: GraphEdge[] = wf.graph?.edges ?? [];
  const step = steps.find((s) => s.id === stepRef || s.ref === stepRef);
  if (!step) {
    return err(
      `Step \`${stepRef}\` not found in workflow \`${slug}\`. Run op="get" to list step ids/refs.`,
    );
  }
  const byId = new Map(steps.map((s) => [s.id, s]));
  const nameOf = (id: string) => {
    const s = byId.get(id);
    return s ? `\`${s.ref}\`${s.title ? ` (${s.title})` : ""}` : `\`${id}\``;
  };
  const outgoing = edges.filter((e) => e.from === step.id);
  const incoming = edges.filter((e) => e.to === step.id).length;

  const lines: string[] = [];
  lines.push(`# Step: ${step.title || "(untitled)"}`);
  lines.push(`Workflow: \`${wf.slug}\` · step id: \`${step.id}\` · ref: \`${step.ref}\``);
  if (step.description) lines.push("", step.description);
  lines.push("");
  lines.push(
    incoming === 0
      ? `- Entry step — no incoming edges.`
      : `- Incoming edges: ${incoming}.`
  );
  if (step.reads.length > 0) lines.push(`- Read: ${renderReads(step.reads)}`);
  if (step.actions.length > 0) lines.push(`- Action: ${renderActions(step.actions)}`);
  if (step.userInput) lines.push(`- User input: ${step.userInput}`);
  if (step.agentOutput) lines.push(`- Agent output: ${step.agentOutput}`);
  if (step.nextInstructions) lines.push(`- Next: ${step.nextInstructions}`);
  lines.push("");
  if (outgoing.length === 0) {
    lines.push(`- Leads to: nothing — terminal step.`);
  } else {
    lines.push(`- Leads to:`);
    for (const e of outgoing) {
      lines.push(`  → ${nameOf(e.to)}${e.condition ? ` when ${e.condition}` : ""}`);
    }
  }
  return ok(lines.join("\n"));
}

export async function opListTrash(client: DoplClient): Promise<ToolResponse> {
  const { workflows } = await client.listWorkflowTrash();
  if (workflows.length === 0) return ok("Workflow trash is empty.");
  const lines: string[] = [
    `## Workflow trash (${plural(workflows.length, "workflow")})\n`,
  ];
  for (const w of workflows) {
    lines.push(`- **${w.name}** (slug: \`${w.slug}\`) — deleted ${w.deleted_at}`);
  }
  lines.push("");
  lines.push(
    `Restore one with \`dopl_workflow(op='restore_workflow', slug='<slug or id>')\`.`,
  );
  return ok(lines.join("\n"));
}
