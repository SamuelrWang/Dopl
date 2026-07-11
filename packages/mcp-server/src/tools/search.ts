/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills, workflows, and ontology objects match on their name/trigger
 * metadata. Every hit carries the stable handle for the follow-up read.
 */

import { z } from "zod";
import type { DoplClient, OntologySnapshot } from "@dopl/client";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

const EMPTY_ONTOLOGY: OntologySnapshot = { clusters: [], objects: {} };

const SEARCH_DESCRIPTION = `Search the whole workspace at once — knowledge entries (semantic + keyword), skills, workflows, and ontology objects. Returns grouped hits with the handle to read each: dopl_kb(op="read_file"), dopl_skill(op="get"), dopl_workflow(op="get"), dopl_ontology(op="get"). Prefer this over per-domain listing when you don't already know where something lives. Params: query (required), limit (max hits per group, default 8).`;

export function registerSearchTool(register: RegisterTool, client: DoplClient): void {
  register(
    "dopl_search",
    SEARCH_DESCRIPTION,
    {
      query: z.string().min(1).describe("What to find."),
      // coerce: MCP clients sometimes send numbers as strings; strict
      // z.number() rejects them with an opaque -32602.
      limit: z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
    },
    async (args): Promise<ToolResponse> => {
      const limit = args.limit ?? 8;
      const needle = args.query.toLowerCase();
      const matches = (...fields: Array<string | null | undefined>) =>
        fields.some((f) => f?.toLowerCase().includes(needle));

      const [entryHits, skills, workflows, ontology] = await Promise.all([
        client.searchKb(args.query, { limit }).catch(() => []),
        client.listSkills().catch(() => []),
        client.listWorkflows().then((r) => r.workflows).catch(() => []),
        client.getOntology().catch(() => EMPTY_ONTOLOGY),
      ]);

      const lines: string[] = [`# Search: "${args.query}"`];

      lines.push("", "## Knowledge entries");
      if (entryHits.length === 0) lines.push("_No matches._");
      for (const h of entryHits.slice(0, limit)) {
        const snippet = h.snippet.replace(/<\/?b>/g, "**");
        lines.push(`- **${h.title}** (entry id: \`${h.entryId}\`) — ${snippet}`);
      }

      const skillHits = skills
        .filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse))
        .slice(0, limit);
      lines.push("", "## Skills");
      if (skillHits.length === 0) lines.push("_No matches._");
      for (const s of skillHits) {
        lines.push(`- **${s.name}** \`${s.slug}\` — ${s.whenToUse || s.description}`);
      }

      const workflowHits = workflows
        .filter((w) => matches(w.name, w.description))
        .slice(0, limit);
      lines.push("", "## Workflows");
      if (workflowHits.length === 0) lines.push("_No matches._");
      for (const w of workflowHits) {
        lines.push(`- **${w.name}** \`${w.slug}\`${w.description ? ` — ${w.description}` : ""}`);
      }

      const objectHits = Object.values(ontology.objects)
        .filter((o) => matches(o.name, o.subtitle))
        .slice(0, limit);
      lines.push("", "## Ontology objects");
      if (objectHits.length === 0) lines.push("_No matches._");
      const containerOf = (id: string) =>
        Object.values(ontology.objects).find((c) => c.childIds.includes(id))?.name ?? "column";
      for (const o of objectHits) {
        lines.push(
          `- **${o.name}** (${containerOf(o.id)} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`
        );
      }

      return ok(lines.join("\n"));
    }
  );
}
