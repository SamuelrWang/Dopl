"use strict";
/**
 * `dopl_search` — one ranked search across the workspace. Knowledge
 * entries use the backend hybrid (embeddings + full-text) search;
 * skills, workflows, and ontology objects match on their name/trigger
 * metadata. Every hit carries the stable handle for the follow-up read.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerSearchTool = registerSearchTool;
const zod_1 = require("zod");
const respond_1 = require("./respond");
const EMPTY_ONTOLOGY = { clusters: [], objects: {} };
const SEARCH_DESCRIPTION = `Search the whole workspace at once — knowledge entries (semantic + keyword), skills, workflows, and ontology objects. Returns grouped hits with the handle to read each: dopl_kb(op="read_file"), dopl_skill(op="get"), dopl_workflow(op="get"), dopl_ontology(op="get"). Prefer this over per-domain listing when you don't already know where something lives. Params: query (required), limit (max hits per group, default 8).`;
function registerSearchTool(register, client) {
    register("dopl_search", SEARCH_DESCRIPTION, {
        query: zod_1.z.string().min(1).describe("What to find."),
        // coerce: MCP clients sometimes send numbers as strings; strict
        // z.number() rejects them with an opaque -32602.
        limit: zod_1.z.coerce.number().int().min(1).max(25).optional().describe("Max hits per group (default 8)."),
    }, async (args) => {
        const limit = args.limit ?? 8;
        // Tokenize + punctuation-fold both the query and the haystack so
        // "duplicate name" matches "duplicate-name", word order doesn't
        // matter, and every term must appear (AND). A whitespace-only or
        // punctuation-only query yields zero terms → matches nothing,
        // instead of the old whole-query .includes() that missed
        // near-verbatim multi-word queries and dumped everything for a
        // lone space (audit fix F-15). Knowledge entries still use the
        // backend hybrid search; this only governs skills/workflows/objects.
        const fold = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const terms = fold(args.query).split(" ").filter(Boolean);
        const matches = (...fields) => {
            if (terms.length === 0)
                return false;
            const hay = ` ${fields.map((f) => fold(f ?? "")).join(" ")} `;
            return terms.every((t) => hay.includes(t));
        };
        const [entryHits, skills, workflows, ontology] = await Promise.all([
            client.searchKb(args.query, { limit }).catch(() => []),
            client.listSkills().catch(() => []),
            client.listWorkflows().then((r) => r.workflows).catch(() => []),
            client.getOntology().catch(() => EMPTY_ONTOLOGY),
        ]);
        const lines = [`# Search: "${args.query}"`];
        lines.push("", "## Knowledge entries");
        if (entryHits.length === 0)
            lines.push("_No matches._");
        for (const h of entryHits.slice(0, limit)) {
            const snippet = h.snippet.replace(/<\/?b>/g, "**");
            lines.push(`- **${h.title}** (entry id: \`${h.entryId}\`) — ${snippet}`);
        }
        const skillHits = skills
            .filter((s) => s.status === "active" && matches(s.name, s.description, s.whenToUse))
            .slice(0, limit);
        lines.push("", "## Skills");
        if (skillHits.length === 0)
            lines.push("_No matches._");
        for (const s of skillHits) {
            lines.push(`- **${s.name}** \`${s.slug}\` — ${s.whenToUse || s.description}`);
        }
        const workflowHits = workflows
            .filter((w) => matches(w.name, w.description))
            .slice(0, limit);
        lines.push("", "## Workflows");
        if (workflowHits.length === 0)
            lines.push("_No matches._");
        for (const w of workflowHits) {
            lines.push(`- **${w.name}** \`${w.slug}\`${w.description ? ` — ${w.description}` : ""}`);
        }
        const objectHits = Object.values(ontology.objects)
            .filter((o) => matches(o.name, o.subtitle))
            .slice(0, limit);
        lines.push("", "## Ontology objects");
        if (objectHits.length === 0)
            lines.push("_No matches._");
        const containerOf = (id) => Object.values(ontology.objects).find((c) => c.childIds.includes(id))?.name ?? "column";
        for (const o of objectHits) {
            lines.push(`- **${o.name}** (${containerOf(o.id)} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`);
        }
        return (0, respond_1.ok)(lines.join("\n"));
    });
}
