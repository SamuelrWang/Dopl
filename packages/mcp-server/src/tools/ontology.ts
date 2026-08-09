/**
 * `dopl_ontology` + `dopl_ontology_admin` — the workspace object graph
 * as a ROUTING layer, fully agent-authorable (like dopl_kb for bases).
 * Read funnel: anchor → map → resolve → get. Write ops edit one thing
 * at a time (attribute / relationship / action upserts) so agents never
 * have to round-trip whole objects.
 *
 * This file is the thin registrar: it owns the two tool schemas + wires
 * them to the handlers in sibling modules —
 *   - `ontology-render.ts`     — shared ref resolvers + object renderer
 *   - `ontology-ops-read.ts`   — map/anchor/resolve/get
 *   - `ontology-ops-write.ts`  — the op dispatch switch + every mutating handler
 * The admin tool (the refused cascade deletes) stays inline here.
 */

import { z } from "zod";
import { deleteAdminDescription } from "../delete-policy.js";
import { inlineOr } from "./narration";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import type { DoplClient } from "@dopl/client";
import { missingParams, ok, type RegisterTool, type ToolResponse } from "./respond";
import { resolveClusterRef, resolveObjectRef } from "./ontology-render";
import { dispatch } from "./ontology-ops-write";

const ONTOLOGY_DESCRIPTION = `The workspace ontology — objects organized in clusters of columns, with attributes, relationships, and actions. An object IS whatever its column is named (a "Sales Rep" column holds sales reps). LOOK UP identity, context, and how work gets done here instead of inferring; AUTHOR it the same way (no web UI needed). Objects are referenced by id (preferred) or exact name; clusters by slug/id/name.

READ — set \`op\` to:
- "map" — the clusters and their COLUMNS, with each column's direct members named. TWO LEVELS ONLY: objects nested below a column's own children, and objects that belong to no column at all, never appear here, and trashed clusters/objects are never listed by any read. So it routes, it does not inventory — op="resolve" and op="get" reach what it does not show. Call first to route.
- "anchor" — the object representing the CALLER. Start here for any "my/me" request. At most one object is returned even if the data holds several anchored to you.
- "resolve" — find objects whose NAME or SUBTITLE contains the query (substring, case-insensitive; attributes, relationships and actions are not matched). Returns ids, capped at 20 matches, and the result says when it truncated.
- "get" — one object in full: attributes (linked knowledge/skills resolved to openable handles), OUTBOUND relationships plus an inbound "Referenced by" backlink list, nested objects, action recipes. Also returns a Version token — pass it back as \`expected_version\` on a later write so a concurrent edit can't silently clobber yours. Requires: object.

WRITE — set \`op\` to:
- "create_cluster" — new ontology board. Requires: name. Optional: purpose (agents read it to route — write a good one).
- "update_cluster" — rename / repurpose. Requires: cluster. Optional: name, purpose.
- "create_column" — new column (container object) in a cluster; its name says what its objects ARE (e.g. "Sales Rep"). Requires: cluster, name.
- "create_object" — new object inside a column (or nested in any object). Inherits from the parent: its template as empty fields, and a copy of its relationships and actions. Requires: parent, name.
- "update_object" — rename / redescribe. Requires: object. Optional: name, subtitle.
- "set_template_field" — upsert one DEFAULT field on a column (or any container): new objects created inside it are born with these fields, empty. Requires: object, label. Optional: kind (default text).
- "remove_template_field" — Requires: object, label.
- "set_attribute" — upsert one attribute by label. Requires: object, label. kind="text"|"pill" need \`value\`; kind="ref" needs \`values\` (object ids/names); kind="knowledge"|"skill" need \`values\` — KB/skill slugs or ids, and for kind="knowledge" also specific ENTRIES as \`<base>/<entry path>\` (e.g. "ai-ops-leads/Track 1 leads") or an entry uuid. Default kind: text.
- "remove_attribute" — Requires: object, label.
- "set_relationship" — replace one labeled edge. Requires: object, label, targets (object ids/names — at least one, and never the object itself). To clear an edge use "remove_relationship".
- "remove_relationship" — Requires: object, label.
- "set_action" — upsert an action by name: something the OBJECT can do day to day, performed by an agent on its behalf (e.g. "Send email", "Search LinkedIn"). Requires: object, name. Optional: description (how/when to do it), outcome (what the result should be, e.g. "Follow-up email sent and logged"), tools (what to use, e.g. "Gmail").
- "remove_action" — Requires: object, name.
- "claim_anchor" — link the CALLING user to an object as their identity anchor. Requires: object.

Object-mutating ops (update_object, set/remove_attribute, set/remove_template_field, set/remove_action, set/remove_relationship) accept an optional \`expected_version\` (the Version from a prior op="get"). When supplied, the write is rejected if the object changed since — re-get, reconcile, and retry. Destructive deletes live in dopl_ontology_admin.`;

const ONTOLOGY_ADMIN_DESCRIPTION = deleteAdminDescription(
  [
    { op: "delete_object", effect: "would have deleted one object" },
    { op: "delete_cluster", effect: "would have deleted a cluster and, in cascade, every object it owns" },
  ],
  `Reach for instead: \`dopl_ontology\` op="update_object" to rewrite an object, op="remove_attribute" / op="remove_relationship" to strip fields FROM one (those edit an object; they do not delete it). If a board or a card genuinely has to go, ask the user to delete it in the Dopl app.`,
);

export function registerOntologyTool(
  register: RegisterTool,
  client: DoplClient,
  /** The session identity record — `op="anchor"` states it before the object. */
  caller: CallerIdentity = UNKNOWN_CALLER,
): void {
  register(
    "dopl_ontology",
    ONTOLOGY_DESCRIPTION,
    {
      op: z
        .enum([
          "map",
          "anchor",
          "resolve",
          "get",
          "create_cluster",
          "update_cluster",
          "create_column",
          "create_object",
          "update_object",
          "set_template_field",
          "remove_template_field",
          "set_attribute",
          "remove_attribute",
          "set_relationship",
          "remove_relationship",
          "set_action",
          "remove_action",
          "claim_anchor",
        ])
        .describe("Operation to perform."),
      query: z.string().optional().describe("resolve: name/description text to match."),
      object: z.string().optional().describe("Object id (preferred) or exact name."),
      cluster: z.string().optional().describe("Cluster slug, id, or exact name."),
      parent: z
        .string()
        .optional()
        .describe("create_object: the column/object to nest under (id or exact name)."),
      name: z.string().max(200).optional().describe("A name (cluster/column/object/action)."),
      purpose: z.string().max(2000).optional().describe("create_cluster/update_cluster: routing one-liner."),
      subtitle: z.string().optional().describe("update_object: short description agents browse."),
      label: z.string().max(200).optional().describe("Attribute, relationship, or template-field label."),
      kind: z
        .enum(["text", "pill", "ref", "knowledge", "skill"])
        .optional()
        .describe("set_attribute / set_template_field: value kind (default text)."),
      value: z.string().max(4000).optional().describe("set_attribute (text/pill): the value."),
      values: z
        .array(z.string())
        .max(100)
        .optional()
        .describe("set_attribute (ref/knowledge/skill): ids, slugs, or exact names. kind=knowledge also accepts entry refs: `<base>/<entry path>` or an entry uuid."),
      targets: z
        .array(z.string())
        .max(100)
        .optional()
        .describe("set_relationship: target objects (ids or exact names)."),
      description: z.string().max(4000).optional().describe("set_action: what the action does."),
      outcome: z
        .string()
        .max(4000)
        .optional()
        .describe("set_action: what the outcome of the action should be."),
      tools: z
        .string()
        .max(2000)
        .optional()
        .describe("set_action: tools the agent should use to perform it."),
      expected_version: z
        .string()
        .optional()
        .describe(
          "Optional optimistic-concurrency token for object-mutating ops: the object's Version from a prior op=\"get\". If the object changed since, the write is rejected so you can re-get, reconcile, and retry. Omit to overwrite blindly (last-writer-wins)."
        ),
    },
    (args): Promise<ToolResponse> => dispatch(client, args, caller)
  );

  register(
    "dopl_ontology_admin",
    ONTOLOGY_ADMIN_DESCRIPTION,
    {
      op: z.enum(["delete_object", "delete_cluster"]).describe("Destructive operation."),
      object: z.string().optional().describe("delete_object: id or exact name."),
      cluster: z.string().optional().describe("delete_cluster: slug, id, or exact name."),
    },
    async (args): Promise<ToolResponse> => {
      // THE SUMMARY PROJECTION, NOT THE GRAPH (P0-3). This handler resolves a
      // ref by id/slug/name and counts a cascade over `columnIds`/`childIds` —
      // containment only, no JSONB. (§2b means it is also unreachable: the
      // refusal fires in server.ts's registration wrapper before any client
      // call, so the saving here is theoretical and the point is that the
      // resolvers stay honest about what they read.)
      const snapshot = await client.getOntology({ view: "summary" });
      if (args.op === "delete_object") {
        const miss = missingParams("delete_object", args, ["object"]);
        if (miss) return miss;
        const resolved = resolveObjectRef(snapshot, args.object as string);
        if ("fail" in resolved) return resolved.fail;
        await client.deleteOntologyObject(resolved.hit.id);
        return ok(
          `Deleted object ${inlineOr(resolved.hit.name, "`(unnamed)`")} (\`${resolved.hit.id}\`).`,
        );
      }
      const miss = missingParams("delete_cluster", args, ["cluster"]);
      if (miss) return miss;
      const resolved = resolveClusterRef(snapshot, args.cluster as string);
      if ("fail" in resolved) return resolved.fail;
      const count = countClusterObjects(snapshot, resolved.hit);
      // A clipped read under-counts the cascade: the rows past the ceiling are
      // still deleted, they were just never in hand to count. A number stated
      // flat would be the one thing worse than no number.
      const floor = snapshot.truncated
        ? ` The ontology read was CLIPPED by a server row ceiling, so that count is a floor, not the cascade.`
        : "";
      await client.deleteOntologyCluster(resolved.hit.id);
      return ok(
        `Deleted cluster ${inlineOr(resolved.hit.name, "`(unnamed)`")} (\`${resolved.hit.slug}\`, id: \`${resolved.hit.id}\`) and, in cascade, its ${count} object${count === 1 ? "" : "s"}.${floor} Permanent — there is nothing to restore it from.`
      );
    }
  );
}

/**
 * Size of a cluster's cascade set: its columns plus every nested descendant
 * (the objects delete_cluster would take with it). Visited-set guards
 * against cycles from objects shared across parents.
 *
 * Typed to the containment fields it actually walks, so it accepts either
 * projection: the full snapshot and the `view: "summary"` one both carry
 * `columnIds` and `childIds`, and nothing here reads anything else.
 */
function countClusterObjects(
  snapshot: { objects: Record<string, { childIds: string[] }> },
  cluster: { columnIds: string[] }
): number {
  const collected = new Set<string>();
  const stack = [...cluster.columnIds];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || collected.has(id)) continue;
    collected.add(id);
    const obj = snapshot.objects[id];
    if (obj) stack.push(...obj.childIds);
  }
  return collected.size;
}
