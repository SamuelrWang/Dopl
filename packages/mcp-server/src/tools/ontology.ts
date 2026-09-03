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
 * {@link DESCRIPTION_MAX_CHARS}, AND IT IS A DECISION RECORDED IN CODE RATHER
 * THAN A CAP QUIETLY ABSORBED. EIGHTEEN ops, and `parity.test.ts` requires
 * every one of them to appear as a quoted `"op_name"`, on top of the two
 * disclosures `tool-scope-claims.test.ts` pins by phrase (op="map"'s TWO LEVELS
 * ONLY, op="resolve"'s cap). That floor does not fit 1,200.
 *
 * ⚠ 1,508 IS THE MEASURED PROSE, NOT A ROUND NUMBER WITH ROOM IN IT: it is a
 * ratchet, so the next sentence added here fails at import instead of being
 * absorbed. The whole SERVED string still answers to
 * {@link HARD_DESCRIPTION_CEILING}, which no constant may raise — that is what
 * grouped the inverse write ops onto one line below.
 *
 * ⚠ THE HONEST NEXT MOVE IS NOT A HIGHER NUMBER — it is the one `dopl_channel`
 * already made for its law: pull the write-op glosses into an MCP resource, so
 * they stop being pushed to every client that only ever reads the graph.
 */
const ONTOLOGY_PROSE_BUDGET = 1_508;

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
    "The workspace object graph — objects in clusters of columns, with attributes, relationships and actions; it routes rather than inventories.",
  policy:
    "Reads plus writes that edit ONE thing at a time. No delete op — a `remove_*` op strips a field, never the object.",
  routing: ["Use dopl_map for the workspace-wide routing view."],
  body: [
    `READ — set \`op\` to:
- "map" — clusters and their COLUMNS, with each column's direct members. TWO LEVELS ONLY: objects nested deeper, and objects in no column, never appear. Call first.
- "anchor" — the CALLER's own object; start here for any "my/me" request, at most one.
- "resolve" — objects whose NAME or SUBTITLE contains the query (case-insensitive substring), capped at 20 matches; the result says so.
- "get" — one object: attributes, relationships, backlinks, nested objects, actions, a Version token.`,
    // ⚠ GROUPED, NOT ONE LINE PER OP, AND THAT IS THE HARD CEILING TALKING.
    // `parity.test.ts` needs every enum op to appear as a quoted `"op_name"`,
    // not to own a line; eight of these lines were the op name said twice
    // (`"remove_attribute" — drop one.`), and the whole served string has to
    // fit {@link HARD_DESCRIPTION_CEILING}, which no constant may raise.
    // ⚠ The two ops `tool-scope-claims.test.ts` reads as BULLETS — "map" and
    // "resolve" — keep their own lines and must keep them.
    `WRITE — set \`op\` to:
- "create_cluster" / "update_cluster" — a cluster's name and \`purpose\`.
- "create_column" — a container; its name says what its objects ARE.
- "create_object" / "update_object" — born with the parent's template, relationships and actions.
- "set_template_field" — a DEFAULT field; objects made inside inherit it, empty.
- "set_attribute" / "set_relationship" / "set_action" — one attribute, one labeled edge (never onto the object itself), or one thing the OBJECT does day to day.
- "remove_template_field" / "remove_attribute" / "remove_relationship" / "remove_action" — drop one, by label or name.
- "claim_anchor" — link the CALLING user to an object as their anchor.`,
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
      // ⚠ A16's response-size knob, on the FOUR read ops. ONE `.describe()`,
      // in `response-size.ts`, shared with every tool that takes it — because
      // five wordings is five chances to promise something `concise` does not
      // do, and the promise ("bodies are untouched") is why it gets used.
      response_format: RESPONSE_FORMAT_FIELD,
    },
    (args): Promise<ToolResponse> => dispatch(client, args, caller)
  );
}
