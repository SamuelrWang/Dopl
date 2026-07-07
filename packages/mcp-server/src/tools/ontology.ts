/**
 * `dopl_ontology` — the workspace object graph as a ROUTING layer.
 * Read-only (edited in the web UI). The intended funnel: anchor (who is
 * calling) → map (which cluster) → resolve (which objects) → get (the
 * object's attributes, relationships, and action recipes, with linked
 * knowledge/skills resolved to addressable handles).
 */

import { z } from "zod";
import type {
  DoplClient,
  OntologyObject,
  OntologySnapshot,
} from "@dopl/client";
import { err, missingParams, ok, type RegisterTool, type ToolResponse } from "./respond";

const ONTOLOGY_DESCRIPTION = `The workspace ontology — typed objects (people, teams, clients, policies, documents) organized in clusters, with attributes, relationships, and action recipes. Use it to LOOK UP identity, context, and how work gets done here instead of inferring. Set \`op\` to one of:
- "map" — clusters and their columns (compact). Call first to route.
- "anchor" — the object representing the CALLER (the authenticated user), with its relationships. Start here for any "my/me" request; if no anchor exists, fall back to op=resolve on the user's name.
- "resolve" — find objects by name/description match. Returns ids for op=get.
- "get" — one object in full: attributes (linked knowledge bases / skills resolved to slugs you can open with dopl_kb / dopl_skill), relationships with target names, nested objects, and its ACTIONS — each action lists exactly what to pull before executing. Requires: object (id, or exact name).
Read-only; the graph is edited in the Dopl web UI.`;

export function registerOntologyTool(register: RegisterTool, client: DoplClient): void {
  register(
    "dopl_ontology",
    ONTOLOGY_DESCRIPTION,
    {
      op: z.enum(["map", "anchor", "resolve", "get"]).describe("Operation to perform."),
      query: z.string().optional().describe("op=resolve: name/description text to match."),
      object: z.string().optional().describe("op=get: object id (preferred) or exact name."),
    },
    async (args): Promise<ToolResponse> => {
      switch (args.op) {
        case "map":
          return opMap(client);
        case "anchor":
          return opAnchor(client);
        case "resolve": {
          const miss = missingParams("resolve", args, ["query"]);
          if (miss) return miss;
          return opResolve(client, args.query as string);
        }
        case "get": {
          const miss = missingParams("get", args, ["object"]);
          if (miss) return miss;
          return opGet(client, args.object as string);
        }
      }
    }
  );
}

async function opMap(client: DoplClient): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  if (snapshot.clusters.length === 0) {
    return ok("No ontology clusters yet — the graph is empty.");
  }
  const lines: string[] = [];
  for (const c of snapshot.clusters) {
    lines.push(`## ${c.name} \`${c.slug}\`${c.purpose ? ` — ${c.purpose}` : ""}`);
    for (const columnId of c.columnIds) {
      const column = snapshot.objects[columnId];
      if (!column) continue;
      const members = column.childIds
        .map((id) => snapshot.objects[id]?.name)
        .filter(Boolean);
      lines.push(
        `- **${column.name}** (${members.length}): ${members.join(", ") || "empty"}`
      );
    }
    lines.push("");
  }
  lines.push(`Drill in with op="get" (object id or exact name).`);
  return ok(lines.join("\n"));
}

async function opAnchor(client: DoplClient): Promise<ToolResponse> {
  const [anchor, snapshot] = await Promise.all([
    client.getOntologyAnchor(),
    client.getOntology(),
  ]);
  if (!anchor) {
    return ok(
      "No object is linked to the calling user yet. Ask the user who they are in this ontology, then op=resolve their name — or have them link their object in the Dopl web UI."
    );
  }
  return ok(renderObject(anchor, snapshot, "You are anchored to this object."));
}

async function opResolve(client: DoplClient, query: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const needle = query.toLowerCase();
  const hits = Object.values(snapshot.objects).filter(
    (o) =>
      o.name.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle)
  );
  if (hits.length === 0) {
    return ok(`No objects match "${query}". op="map" shows everything.`);
  }
  const lines = hits
    .slice(0, 20)
    .map(
      (o) =>
        `- **${o.name}** (${o.type} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`
    );
  return ok(`Matches for "${query}":\n${lines.join("\n")}\n\nRead one with op="get".`);
}

async function opGet(client: DoplClient, ref: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const object =
    snapshot.objects[ref] ??
    Object.values(snapshot.objects).find(
      (o) => o.name.toLowerCase() === ref.toLowerCase()
    );
  if (!object) {
    return err(`No object \`${ref}\`. Find ids with op="resolve" or op="map".`);
  }
  const resolved = await resolveResourceHandles(client, object);
  return ok(renderObject(object, snapshot, undefined, resolved));
}

type ResourceHandles = Map<string, { name: string; slug: string; kind: "kb" | "skill" }>;

async function resolveResourceHandles(
  client: DoplClient,
  object: OntologyObject
): Promise<ResourceHandles> {
  const wanted = new Set(
    object.attributes.flatMap((a) =>
      a.value.kind === "knowledge" || a.value.kind === "skill" ? a.value.value : []
    )
  );
  const handles: ResourceHandles = new Map();
  if (wanted.size === 0) return handles;
  const [bases, skills] = await Promise.all([
    client.listKbBases().catch(() => []),
    client.listSkills().catch(() => []),
  ]);
  for (const b of bases) {
    if (wanted.has(b.id)) handles.set(b.id, { name: b.name, slug: b.slug, kind: "kb" });
  }
  for (const s of skills) {
    if (wanted.has(s.id)) handles.set(s.id, { name: s.name, slug: s.slug, kind: "skill" });
  }
  return handles;
}

function renderObject(
  object: OntologyObject,
  snapshot: OntologySnapshot,
  headline?: string,
  handles: ResourceHandles = new Map()
): string {
  const nameOf = (id: string) => snapshot.objects[id]?.name ?? id;
  const lines: string[] = [];
  if (headline) lines.push(headline, "");
  lines.push(`# ${object.name} (${object.type} · id: \`${object.id}\`)`);
  if (object.subtitle) lines.push(object.subtitle);

  if (object.attributes.length > 0) {
    lines.push("", "## Attributes");
    for (const attr of object.attributes) {
      lines.push(`- ${attr.label}: ${renderValue(attr.value, nameOf, handles)}`);
    }
  }

  if (object.relationships.length > 0) {
    lines.push("", "## Relationships");
    for (const rel of object.relationships) {
      lines.push(`- ${rel.label}: ${rel.targetIds.map(nameOf).join(", ")}`);
    }
  }

  if (object.childIds.length > 0) {
    lines.push("", "## Objects inside");
    for (const id of object.childIds) {
      const child = snapshot.objects[id];
      if (child) lines.push(`- **${child.name}** (${child.type} · id: \`${id}\`)`);
    }
  }

  if (object.methods.length > 0) {
    lines.push("", "## Actions");
    for (const m of object.methods) {
      lines.push(`### ${m.name}`);
      if (m.description) lines.push(m.description);
      if (m.requires.length > 0) {
        lines.push(`Pulls: ${m.requires.map((r) => `\`${r}\``).join(" · ")}`);
      }
    }
  }

  return lines.join("\n");
}

function renderValue(
  value: OntologyObject["attributes"][number]["value"],
  nameOf: (id: string) => string,
  handles: ResourceHandles
): string {
  switch (value.kind) {
    case "text":
    case "pill":
      return value.value || "—";
    case "ref":
      return value.value.map(nameOf).join(", ") || "—";
    case "knowledge":
    case "skill":
      return (
        value.value
          .map((id) => {
            const h = handles.get(id);
            if (!h) return id;
            const opener =
              h.kind === "kb"
                ? `dopl_kb op="get_tree" base="${h.slug}"`
                : `dopl_skill op="get" slug="${h.slug}"`;
            return `**${h.name}** (${opener})`;
          })
          .join(", ") || "—"
      );
  }
}
