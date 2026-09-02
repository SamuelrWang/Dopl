/**
 * `dopl_ontology` — the workspace object graph as a ROUTING layer. Read funnel:
 * anchor → map → resolve → get. Writes edit ONE thing at a time so agents never
 * round-trip whole objects. ⚠ There is no delete op and no
 * `dopl_ontology_admin` (deleted 2026-09-02) — deletion is app-only, fenced by
 * `sessionOnly` on the object and cluster DELETE routes. The `remove_*` ops here
 * strip a FIELD from an object that survives; they are not deletes.
 *
 * Thin registrar: one tool schema wired to
 *   - `ontology-render.ts`    — shared ref resolvers + object renderer
 *   - `ontology-ops-read.ts`  — map/anchor/resolve/get
 *   - `ontology-ops-write.ts` — op dispatch + every mutating handler
 */

import { z } from "zod";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import type { DoplClient } from "@dopl/client";
import { type RegisterTool, type ToolResponse } from "./respond";
import { dispatch } from "./ontology-ops-write";

const ONTOLOGY_DESCRIPTION = `The workspace ontology — objects organized in clusters of columns, with attributes, relationships, and actions. An object IS whatever its column is named (a "Sales Rep" column holds sales reps). Objects are referenced by id (preferred) or exact name; clusters by slug/id/name.

READ — set \`op\` to:
- "map" — the clusters and their COLUMNS, each column's direct members named. TWO LEVELS ONLY: objects nested deeper, and objects in no column at all, never appear, and trashed rows appear in no read. It routes, it does not inventory. Call first.
- "anchor" — the object representing the CALLER. Start here for any "my/me" request; at most one is returned.
- "resolve" — objects whose NAME or SUBTITLE contains the query (substring, case-insensitive), capped at 20 matches, and the result says when it truncated. Requires: query.
- "get" — one object: attributes, outbound relationships plus inbound backlinks, nested objects, actions, and a Version token. Requires: object.

WRITE — set \`op\` to:
- "create_cluster" — Requires: name. Optional: purpose (agents read it to route).
- "update_cluster" — Requires: cluster. Optional: name, purpose.
- "create_column" — a container whose name says what its objects ARE. Requires: cluster, name.
- "create_object" — inherits the parent's template as empty fields, plus its relationships and actions. Requires: parent, name.
- "update_object" — Requires: object. Optional: name, subtitle.
- "set_template_field" — a DEFAULT field on a container; objects created inside are born with it, empty. Requires: object, label.
- "remove_template_field" — Requires: object, label.
- "set_attribute" — Requires: object, label. kind "text"/"pill" need \`value\`; "ref"/"knowledge"/"skill" need \`values\`.
- "remove_attribute" — Requires: object, label.
- "set_relationship" — replace one labeled edge. Requires: object, label, targets (never the object itself).
- "remove_relationship" — Requires: object, label.
- "set_action" — something the OBJECT does day to day, performed by an agent on its behalf. Requires: object, name. Optional: description, outcome, tools.
- "remove_action" — Requires: object, name.
- "claim_anchor" — link the CALLING user to an object as their anchor. Requires: object.

Object-mutating ops take an optional \`expected_version\`. No delete op — deletion is app-only.`;


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
          "Object-mutating ops: the object's Version from a prior op=\"get\", which rejects the write if the object changed since; omit to overwrite blindly (last-writer-wins)."
        ),
    },
    (args): Promise<ToolResponse> => dispatch(client, args, caller)
  );
}
