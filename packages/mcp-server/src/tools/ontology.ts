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
import { RESPONSE_FORMAT_FIELD } from "./response-size";
import { UNKNOWN_CALLER, type CallerIdentity } from "./identity";
import type { DoplClient } from "@dopl/client";
import { type RegisterTool, type ToolResponse } from "./respond";
import { dispatch } from "./ontology-ops-write";
import { ONTOLOGY_ERRORS } from "./tool-errors";
import { composeDescription } from "./tool-style";

/**
 * ⚠ THE ONE PROSE BUDGET ON THIS SURFACE THAT IS NOT
 * {@link DESCRIPTION_MAX_CHARS}, RECORDED IN CODE RATHER THAN QUIETLY ABSORBED.
 * EIGHTEEN ops, each of which `parity.test.ts` requires as a quoted `"op_name"`,
 * plus the two disclosures `tool-scope-claims.test.ts` pins by phrase (op="map"'s
 * TWO LEVELS ONLY, op="resolve"'s cap) — that floor does not fit 1,200.
 *
 * ⚠ IT IS THE MEASURED PROSE, NOT A ROUND NUMBER WITH ROOM IN IT: a ratchet, so
 * the next sentence fails at import. The whole SERVED string still answers to
 * {@link HARD_DESCRIPTION_CEILING}, which no constant may raise — that is what
 * grouped the inverse write ops onto one line below.
 *
 * ⚠ THE HONEST NEXT MOVE IS NOT A HIGHER NUMBER — it is `dopl_channel`'s: pull
 * the write-op glosses into an MCP resource, so they stop being pushed to every
 * client that only reads the graph.
 */
const ONTOLOGY_PROSE_BUDGET = 1_503; // ⚠ **1,506 → 1,503 (2026-09-09): BANKED, NOT RAISED.** The CHANGELOG lane part 2 added one clause to `policy` — every ontology write is filed per field in the changelog, which is a fact an agent cannot derive from any op — and paid for it out of this same description: five glosses trimmed to what only they say (the headline's routing tail, `op="get"`'s "Version token", `op="anchor"`'s phrasing, `create_column`'s, and "an agent gets its operator's" losing a word the ladder already carries). The three chars left over are banked here rather than left as headroom, which is the discipline `knowledge.ts › KB_PROSE_BUDGET` states: a ratchet that fails on a SHRINK is how a win gets kept.

/**
 * ⚠ RENDERED, NOT WRITTEN — `tool-style.ts › composeDescription` holds the
 * order for every tool on this surface.
 *
 * ⚠ WHAT LEFT: every "Requires:" / "Optional:" clause, the `expected_version`
 * sentence, the ref-syntax sentence (id preferred, exact name, cluster by
 * slug/id/name) and the attribute `kind` → `value`/`values` mapping. Each is
 * stated by the param's own `.describe()` below, and a description and its arg
 * descriptions are BOTH pushed on every connection.
 */
const ONTOLOGY_DESCRIPTION = composeDescription({
  headline:
    "The object graph you reach — objects in clusters of columns, with attributes, relationships and actions; it routes, not inventories.",
  // ⚠ THE FENCE SENTENCE IS THE POLICY'S THIRD (2026-09-09, home-ontology S5),
  // NOT A BODY BLOCK OF ITS OWN: a block costs its separator too, and this
  // description is at its ratchet. It states the two facts an agent cannot
  // derive — that a lend carries a LEVEL per channel, and that an agent never
  // exceeds the person it acts for (I1) — and no number and no new op, because
  // both would be a second copy of something the schema or the service owns.
  policy:
    "Reads plus writes that edit ONE thing at a time. No delete op — `remove_*` strips a field, not the object. A shared ontology reaches you only at the level its channel grants your role, and an agent gets its operator's. Writes are filed per field in the changelog.",
  routing: ["Use dopl_map for the routing view."],
  body: [
    `READ — set \`op\` to:
- "map" — clusters and their COLUMNS, with each column's direct members. TWO LEVELS ONLY: objects nested deeper, and objects in no column, never appear. Call first.
- "anchor" — the CALLER's own object; start here for "my/me" requests.
- "resolve" — objects whose NAME or SUBTITLE contains the query (case-insensitive substring), capped at 20 matches.
- "get" — one object: attributes, relationships, backlinks, children, actions, Version.`,
    // ⚠ GROUPED, NOT ONE LINE PER OP — the hard ceiling talking.
    // `parity.test.ts` needs every enum op as a quoted `"op_name"`, not a line of
    // its own, and eight of these were the op name said twice.
    // ⚠ The two ops `tool-scope-claims.test.ts` reads as BULLETS — "map" and
    // "resolve" — must keep their own lines.
    `WRITE — set \`op\` to:
- "create_cluster" / "update_cluster" — name and \`purpose\`.
- "create_column" — a container named for what it holds.
- "create_object" / "update_object" — inherits the parent's template, edges, actions.
- "set_template_field" — a DEFAULT field; new objects inherit it empty.
- "set_attribute" / "set_relationship" / "set_action" — one attribute, one labeled edge (never onto itself), or something the OBJECT does.
- "remove_template_field" / "remove_attribute" / "remove_relationship" / "remove_action" — drop one, by label or name.
- "claim_anchor" — link the CALLING user to an object.`,
  ],
  errors: ONTOLOGY_ERRORS,
  examples: [
    { op: "map" },
    { op: "resolve", query: "acme" },
    { op: "set_attribute", object: "o-12", label: "Stage", value: "Won" },
  ],
  cap: ONTOLOGY_PROSE_BUDGET,
});


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
      // ⚠ A16's response-size knob, on the FOUR read ops. ONE `.describe()`, in
      // `./response-size.ts`, shared with every tool that takes it: five wordings
      // is five chances to promise something `concise` does not do.
      response_format: RESPONSE_FORMAT_FIELD,
    },
    (args): Promise<ToolResponse> => dispatch(client, args, caller)
  );
}
