/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills, workflows, and ontology objects match on their name/trigger
 * metadata. Every hit carries the stable handle for the follow-up read.
 */

import { z } from "zod";
import type { DoplClient, OntologySnapshot } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, type RegisterTool, type ToolResponse } from "./respond";

const EMPTY_ONTOLOGY: OntologySnapshot = { clusters: [], objects: {} };

/** A result with nothing nameable left after neutralization. */
const NO_NAME = "`(unnamed)`";

/**
 * A knowledge-entry search snippet, as a value.
 *
 * The `<b>` highlight tags the backend wraps matched terms in used to become
 * `**` — our own markdown, added to text we do not control, on a bullet line
 * with no framing. The tags are dropped instead and the snippet neutralized:
 * losing the bold costs a nicety, and a snippet is an EXCERPT OF A BODY spliced
 * into narration, which is exactly the shape this sweep exists to close. The
 * words survive, which is the half that makes a hit pickable.
 */
function snippet(raw: string): string {
  return inlineOr(raw.replace(/<\/?b>/g, ""), "`(no snippet)`");
}

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
      // Tokenize + punctuation-fold both the query and the haystack so
      // "duplicate name" matches "duplicate-name", word order doesn't
      // matter, and every term must appear (AND). A whitespace-only or
      // punctuation-only query yields zero terms → matches nothing,
      // instead of the old whole-query .includes() that missed
      // near-verbatim multi-word queries and dumped everything for a
      // lone space (audit fix F-15). Knowledge entries still use the
      // backend hybrid search; this only governs skills/workflows/objects.
      const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const terms = fold(args.query).split(" ").filter(Boolean);
      const matches = (...fields: Array<string | null | undefined>) => {
        if (terms.length === 0) return false;
        const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
        return terms.every((t) => hay.includes(t));
      };

      const [entryHits, skills, workflows, ontology] = await Promise.all([
        client.searchKb(args.query, { limit }).catch(() => []),
        client.listSkills().catch(() => []),
        client.listWorkflows().then((r) => r.workflows).catch(() => []),
        client.getOntology().catch(() => EMPTY_ONTOLOGY),
      ]);

      // The query echo is the caller's own argument, but a backtick in it would
      // still escape this span and put the tail back into the heading.
      const lines: string[] = [`# Search: ${inlineOr(args.query, "`(unreadable query)`")}`];

      lines.push("", "## Knowledge entries");
      if (entryHits.length === 0) lines.push("_No matches._");
      for (const h of entryHits.slice(0, limit)) {
        lines.push(
          `- ${inlineOr(h.title, NO_NAME)} (entry id: \`${h.entryId}\`) — ${snippet(h.snippet)}`,
        );
      }

      const skillHits = skills
        .filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse))
        .slice(0, limit);
      lines.push("", "## Skills");
      if (skillHits.length === 0) lines.push("_No matches._");
      for (const s of skillHits) {
        const trigger = inlineOr(s.whenToUse || s.description, "`(no trigger described)`");
        lines.push(`- ${inlineOr(s.name, NO_NAME)} \`${s.slug}\` — ${trigger}`);
      }

      const workflowHits = workflows
        .filter((w) => matches(w.name, w.description))
        .slice(0, limit);
      lines.push("", "## Workflows");
      if (workflowHits.length === 0) lines.push("_No matches._");
      for (const w of workflowHits) {
        const desc = w.description ? ` — ${inlineOr(w.description, "")}` : "";
        lines.push(`- ${inlineOr(w.name, NO_NAME)} \`${w.slug}\`${desc}`);
      }

      const objectHits = Object.values(ontology.objects)
        .filter((o) => matches(o.name, o.subtitle))
        .slice(0, limit);
      lines.push("", "## Ontology objects");
      if (objectHits.length === 0) lines.push("_No matches._");
      const containerOf = (id: string) => {
        const name = Object.values(ontology.objects).find((c) =>
          c.childIds.includes(id),
        )?.name;
        // The container's name is another object's member-typed name, not a
        // kind the server assigned — only the "column" fallback is ours.
        return name ? inlineOr(name, NO_NAME) : "column";
      };
      for (const o of objectHits) {
        const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
        lines.push(
          `- ${inlineOr(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`
        );
      }

      return ok(lines.join("\n"));
    }
  );
}
