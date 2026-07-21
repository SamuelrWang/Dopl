/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */

import type { DoplClient } from "@dopl/client";
import { ok, type ToolResponse } from "./respond";
import {
  renderObject,
  resolveObjectRef,
  resolveResourceHandles,
} from "./ontology-render";

export async function opMap(client: DoplClient): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  if (snapshot.clusters.length === 0) {
    return ok(
      `No ontology clusters yet — the graph is empty. Start one with op="create_cluster".`
    );
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
      lines.push(`- **${column.name}** (${members.length}): ${members.join(", ") || "empty"}`);
    }
    lines.push("");
  }
  lines.push(`Drill in with op="get" (object id or exact name).`);
  return ok(lines.join("\n"));
}

export async function opAnchor(client: DoplClient): Promise<ToolResponse> {
  const [anchor, snapshot] = await Promise.all([
    client.getOntologyAnchor(),
    client.getOntology(),
  ]);
  if (!anchor) {
    return ok(
      `No object is linked to the calling user yet. op="resolve" the user's name, then op="claim_anchor" to link it.`
    );
  }
  return ok(renderObject(anchor, snapshot, "You are anchored to this object."));
}

export async function opResolve(client: DoplClient, query: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const needle = query.toLowerCase();
  const hits = Object.values(snapshot.objects).filter(
    (o) =>
      o.name.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle)
  );
  if (hits.length === 0) {
    return ok(`No objects match "${query}". op="map" shows everything.`);
  }
  const containerOf = (id: string) =>
    Object.values(snapshot.objects).find((o) => o.childIds.includes(id))?.name;
  const lines = hits
    .slice(0, 20)
    .map((o) => {
      const kind = containerOf(o.id) ?? "column";
      return `- **${o.name}** (${kind} · id: \`${o.id}\`)${o.subtitle ? ` — ${o.subtitle}` : ""}`;
    });
  return ok(`Matches for "${query}":\n${lines.join("\n")}\n\nRead one with op="get".`);
}

export async function opGet(client: DoplClient, ref: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const resolved = resolveObjectRef(snapshot, ref);
  if ("fail" in resolved) return resolved.fail;
  const handles = await resolveResourceHandles(client, resolved.hit);
  return ok(renderObject(resolved.hit, snapshot, undefined, handles));
}
