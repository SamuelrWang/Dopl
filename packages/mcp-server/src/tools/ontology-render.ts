/**
 * Shared resolvers + renderers for the `dopl_ontology` tool. Refs are
 * agent-friendly: ids preferred, exact names accepted (ambiguity is an
 * error listing candidates, never a guess).
 */

import type {
  DoplClient,
  OntologyCluster,
  OntologyObject,
  OntologySnapshot,
} from "@dopl/client";
import { err, type ToolResponse } from "./respond";

export type Resolved<T> = { hit: T } | { fail: ToolResponse };

export function resolveObjectRef(
  snapshot: OntologySnapshot,
  ref: string
): Resolved<OntologyObject> {
  const byId = snapshot.objects[ref];
  if (byId) return { hit: byId };
  const needle = ref.toLowerCase();
  const matches = Object.values(snapshot.objects).filter(
    (o) => o.name.toLowerCase() === needle
  );
  if (matches.length === 1) return { hit: matches[0] };
  if (matches.length > 1) {
    const list = matches.map((o) => `\`${o.id}\` (${o.type})`).join(", ");
    return { fail: err(`Multiple objects named "${ref}" — use an id: ${list}`) };
  }
  return {
    fail: err(`No object \`${ref}\`. Find ids with op="resolve" or op="map".`),
  };
}

export function resolveClusterRef(
  snapshot: OntologySnapshot,
  ref: string
): Resolved<OntologyCluster> {
  const needle = ref.toLowerCase();
  const hit = snapshot.clusters.find(
    (c) => c.id === ref || c.slug === ref || c.name.toLowerCase() === needle
  );
  if (hit) return { hit };
  const known = snapshot.clusters.map((c) => `\`${c.slug}\``).join(", ") || "none";
  return { fail: err(`No cluster \`${ref}\`. Known clusters: ${known}.`) };
}

export type ResourceHandles = Map<
  string,
  { name: string; slug: string; kind: "kb" | "skill" }
>;

export async function resolveResourceHandles(
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

export function renderObject(
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

  if ((object.template ?? []).length > 0) {
    lines.push(
      "",
      "## Default fields (template)",
      "_New objects created inside this one are born with these fields, empty:_"
    );
    for (const f of object.template) {
      lines.push(`- ${f.label} (${f.kind})`);
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
