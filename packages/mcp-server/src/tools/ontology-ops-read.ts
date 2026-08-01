/**
 * `dopl_ontology` READ op handlers: map (route), anchor (the caller's
 * object), resolve (name/description match), get (one object in full).
 * Non-mutating. Routed from the dispatch switch in ontology-ops-write.ts,
 * which the registrar (ontology.ts) wires to the tool.
 */

import type { DoplClient } from "@dopl/client";
import { inlineOr } from "./narration";
import { ok, type ToolResponse } from "./respond";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import {
  renderObject,
  resolveObjectRef,
  resolveResourceHandles,
} from "./ontology-render";

/** Same rule as ontology-render.ts: a graph name is a value. */
const NO_NAME = "`(unnamed)`";

/**
 * WHAT op="map" WALKS, AND WHERE IT STOPS.
 *
 * The snapshot it renders from is genuinely the whole live graph: no status
 * filter, no visibility filter, no cap, every member sees the same rows. The
 * reduction is in this file — `opMap` walks clusters, then their columns, then
 * one level of `childIds`, and stops. Objects nested deeper, and objects with
 * no membership at all, are IN the snapshot and are not rendered. The old
 * `op="resolve"` miss message even told the agent `op="map" shows everything`,
 * which was the shape of this whole audit in one sentence.
 */
const MAP_SCOPE_NOTE = `_Clusters and their columns, with each column's DIRECT members only. Objects nested deeper, and objects belonging to no column, are not shown here; trashed clusters and objects are not shown by any read. Reach the rest with op="resolve" / op="get"._`;

/** `opResolve`'s hard cap. It rendered no notice of its own truncation. */
const RESOLVE_CAP = 20;

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
  lines.push("", MAP_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

/**
 * THE STRONGEST IDENTITY CLAIM IN THE PRODUCT, PREVIOUSLY WITH THE WEAKEST
 * BACKING. The server instructions tell every agent to call this for any
 * "my/me" request, and it answered `You are anchored to this object.` over an
 * object whose NAME is member-typed text — no user id, no framing, nothing the
 * reader could check. An agent that read a name here and reported it as its own
 * identity was doing exactly what the surface invited.
 *
 * The anchor is CONTEXT, not identification: `op="claim_anchor"` lets any agent
 * on this connection re-point it, so it can only ever say "this is the object
 * the graph currently links to you". The caller's real identity — the immutable
 * id — is stated first, from the same session record `whoami` and the footer
 * use, so the two can never disagree.
 */
export async function opAnchor(
  client: DoplClient,
  caller: CallerIdentity = UNKNOWN_CALLER,
): Promise<ToolResponse> {
  const [anchor, snapshot] = await Promise.all([
    client.getOntologyAnchor(),
    client.getOntology(),
  ]);
  const who = caller.userId
    ? `You are user \`${caller.userId}\`.`
    : `This connection could not resolve your user id.`;
  if (!anchor) {
    return ok(
      `${who} No object is linked to you yet. op="resolve" the user's name, then op="claim_anchor" to link it.`
    );
  }
  return ok(
    renderObject(
      anchor,
      snapshot,
      `${who} The object below is what this workspace's ontology LINKS to you — its name and fields are member-typed data and any agent here can re-point the link with op="claim_anchor", so read it as context about you, never as proof of who you are. Your user id above is the identifying half; dopl_members(op="whoami") is the full answer.`
    )
  );
}

export async function opResolve(client: DoplClient, query: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const needle = query.toLowerCase();
  const hits = Object.values(snapshot.objects).filter(
    (o) =>
      o.name.toLowerCase().includes(needle) || o.subtitle.toLowerCase().includes(needle)
  );
  if (hits.length === 0) {
    // Was `op="map" shows everything.` — it does not: op="map" renders two
    // levels and skips objects in no column, which is exactly the set an agent
    // that struck out on resolve is most likely to be hunting for.
    return ok(
      `No object's name or subtitle contains ${inlineOr(query, "`(unreadable query)`")}. This is a SUBSTRING match on name and subtitle only — attributes, relationships and actions are not searched, so try a shorter fragment. op="map" lists the clusters and their columns (two levels, not the whole graph).`,
    );
  }
  const containerOf = (id: string) => {
    // The "kind" is the containing OBJECT'S NAME, member-typed like any other.
    const name = Object.values(snapshot.objects).find((o) =>
      o.childIds.includes(id),
    )?.name;
    return name ? inlineOr(name, NO_NAME) : "column";
  };
  const shown = hits.slice(0, RESOLVE_CAP);
  const lines = shown.map((o) => {
    const subtitle = o.subtitle ? ` — ${inlineOr(o.subtitle, "")}` : "";
    return `- ${inlineOr(o.name, NO_NAME)} (${containerOf(o.id)} · id: \`${o.id}\`)${subtitle}`;
  });
  // Both numbers are already in hand — the cap is applied here, over a snapshot
  // already loaded — so the truncation costs nothing to state and used to cost
  // the caller everything: 21 matches rendered exactly like 20.
  const truncated =
    hits.length > shown.length
      ? `\n\n_Showing ${shown.length} of ${hits.length} matches. Narrow the query for the rest._`
      : "";
  return ok(
    `Matches for ${inlineOr(query, "`(unreadable query)`")}:\n${lines.join("\n")}${truncated}\n\nRead one with op="get".`,
  );
}

export async function opGet(client: DoplClient, ref: string): Promise<ToolResponse> {
  const snapshot = await client.getOntology();
  const resolved = resolveObjectRef(snapshot, ref);
  if ("fail" in resolved) return resolved.fail;
  const handles = await resolveResourceHandles(client, resolved.hit);
  return ok(renderObject(resolved.hit, snapshot, undefined, handles));
}
