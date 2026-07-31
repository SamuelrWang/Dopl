/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, type ToolResponse } from "./respond";
import {
  renderObject,
  resolveObjectRef,
  resolveResourceHandles,
} from "./ontology-render";

/** Same rule as ontology-render.ts: a graph name is a value. */
const NO_NAME = "`(unnamed)`";

export async function opMap(client: DoplClient): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  if (snapshot.clusters.length === 0) {
    return ok(
      `No ontology clusters yet — the graph is empty. Start one with op="create_cluster".`
    );
  }
  const lines: string[] = [];
  for (const c of snapshot.clusters) {
    const purpose = c.purpose ? ` — ${inlineOr(c.purpose, "")}` : "";
    lines.push(`## ${inlineOr(c.name, NO_NAME)} \`${c.slug}\`${purpose}`);
    for (const columnId of c.columnIds) {
      const column = snapshot.objects[columnId];
      if (!column) continue;
      const members = column.childIds
        .map((id) => snapshot.objects[id]?.name)
        .filter((n): n is string => Boolean(n))
        .map((n) => inlineOr(n, NO_NAME));
      lines.push(`- ${inlineOr(column.name, NO_NAME)} (${members.length}): ${members.join(", ") || "empty"}`);
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
    return ok(`No objects match ${inlineOr(query, "`(unreadable query)`")}. op="map" shows everything.`);
  }
  const containerOf = (id: string) => {
    // The "kind" is the containing OBJECT'S NAME, member-typed like any other.
    const name = Object.values(snapshot.objects).find((o) =>
      o.childIds.includes(id),
    )?.name;
    return name ? inlineOr(name, NO_NAME) : "column";
  };
  const lines = hits
    .slice(0, 20)
    .map((o) => {
      const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
      return `- ${inlineOr(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`;
    });
  return ok(
    `Matches for ${inlineOr(query, "`(unreadable query)`")}:\n${lines.join("\n")}\n\nRead one with op="get".`,
  );
}

export async function opGet(client: DoplClient, ref: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const resolved = resolveObjectRef(snapshot, ref);
  if ("fail" in resolved) return resolved.fail;
  const handles = await resolveResourceHandles(client, resolved.hit);
  return ok(renderObject(resolved.hit, snapshot, undefined, handles));
}
