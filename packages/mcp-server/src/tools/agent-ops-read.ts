/**
 * `dopl_agent` READ op handlers: list, get. Non-mutating — they resolve a
 * template ref (or a shelf) and render it. Routed from the registrar in
 * `agent.ts`.
 */

import type { AgentTemplate, DoplClient } from "@dopl/client";
import { inlineOr, isForeignAuthored } from "./narration.js";
import { fenceBody } from "./untrusted-fence";
import { ok, type ToolResponse } from "./respond.js";
import { clipToMaxChars } from "./response-size.js";
import { toWireShelfOrUndefined, type ShelfArg } from "./shelf.js";
import {
  isErr,
  NO_NAME,
  resolveTemplateOr,
  TEMPLATE_VISIBILITY_VALUES,
  type OfferedTemplateVisibility,
  TEMPLATES_SCOPE_NOTE,
  templateRow,
} from "./agent-shared.js";

/** One heading per OFFERED visibility, in the order `op="list"` prints them. */
const VISIBILITY_HEADINGS: Record<OfferedTemplateVisibility, string> = {
  private: "Private to you",
  workspace: "Shared with the whole workspace",
};

const OFFERED_VISIBILITIES = new Set<string>(TEMPLATE_VISIBILITY_VALUES);

/** The heading for every OTHER stored visibility. ⚠ It names no axis on
 *  purpose: it exists so a row SHOWS, not so a retired sharing model gets taught
 *  back to the reader one heading at a time. */
const OTHER_HEADING = "Shared";

export async function opList(
  client: DoplClient,
  shelf?: ShelfArg,
): Promise<ToolResponse> {
  const payload = await client.listAgentTemplatesPayload({
    shelf: toWireShelfOrUndefined(shelf),
  });
  const templates = payload.templates;
  // 🔒 ⚠ SIBLING KEY, `?? []` INLINE (INVARIANTS §8) — the twin of
  // `dopl_kb(op="list_bases")`'s. `home_scoped` stays off the row so no client
  // can re-derive the shelf fence; an absent key leaves every row UNLABELLED,
  // which is what this surface showed before the key existed.
  const personal = new Set(payload.homeScopedTemplateIds ?? []);
  const where =
    shelf === "personal"
      ? " on your personal shelf"
      : shelf === "workspace"
        ? " on the workspace shelf"
        : "";
  if (templates.length === 0) {
    return ok(
      `No agent templates visible to you${where}. ${TEMPLATES_SCOPE_NOTE}\n\nCreate one with \`dopl_agent(op='create')\`.`,
    );
  }
  // ⚠ GROUPED BY VISIBILITY because that is the axis a caller acts on ("the
  // private one is mine, the workspace one is everyone's") — and it is what
  // makes an ambiguity refusal actionable when two rows share a name.
  //
  // ⚠ A ROW IS NEVER DROPPED FOR HAVING A VISIBILITY THIS SURFACE NO LONGER
  // OFFERS. The write enum lost `team` (`agent-shared.ts ›
  // TEMPLATE_VISIBILITY_VALUES`) while the column kept it, so grouping by a
  // fixed table of the OFFERED values would have made any surviving row
  // invisible with no error anywhere — the silent-drop shape, not a retirement.
  // Unoffered values fall through to one trailing bucket that names no axis.
  const groups: Array<readonly [string, AgentTemplate[]]> = [
    ...TEMPLATE_VISIBILITY_VALUES.map(
      (v) =>
        [
          VISIBILITY_HEADINGS[v],
          templates.filter((t) => t.visibility === v),
        ] as const,
    ),
    [OTHER_HEADING, templates.filter((t) => !OFFERED_VISIBILITIES.has(t.visibility))],
  ];
  const lines = [`## Agent templates${where}\n`];
  for (const [heading, rows] of groups) {
    if (rows.length === 0) continue;
    lines.push(`### ${heading}`);
    for (const t of rows) lines.push(templateRow(t, personal.has(t.id)));
    lines.push("");
  }
  lines.push(TEMPLATES_SCOPE_NOTE);
  return ok(lines.join("\n"));
}

export async function opGet(
  client: DoplClient,
  ref: string,
  // ⚠ Only the FRAMING reads this — visibility is the server's decision and it
  // already ran.
  callerUserId: string | null = null,
  /** A16: clip the INSTRUCTIONS body, and SAY so. */
  maxChars?: number,
): Promise<ToolResponse> {
  const template = await resolveTemplateOr(client, ref);
  if (isErr(template)) return template;
  const foreign = isForeignAuthored(
    // ⚠ A template row carries `createdBy` and no `lastEditedBy` column, so the
    // second author slot is genuinely absent rather than unknown — passing it
    // explicitly keeps `isForeignAuthored`'s fail-closed arms readable.
    { createdBy: template.createdBy, lastEditedBy: null },
    callerUserId,
  );
  const lines = [
    `# ${inlineOr(template.name, NO_NAME)}`,
    `id: \`${template.id}\` · ${template.visibility} · model ${template.model ? inlineOr(template.model, NO_NAME) : "(the desktop's default)"}`,
    ...(template.description ? [inlineOr(template.description, "")] : []),
  ];
  if (template.knowledgeBases.length > 0) {
    lines.push("", "## Attached knowledge bases");
    for (const kb of template.knowledgeBases) {
      lines.push(`- ${inlineOr(kb.name, NO_NAME)} (id: \`${kb.id}\`)`);
    }
    // ⚠ VIEWER-FILTERED, and saying so matters: the desktop resolves this list
    // again under the OPERATOR's credential at spawn, so what you see here is
    // not necessarily what a launched session gets.
    lines.push(
      "",
      `_Only the bases YOU can see are listed. At launch the operator's own machine resolves this list again under THEIR visibility, so a base you can read and they cannot is simply omitted there._`,
    );
  }
  if (template.fields.length > 0) {
    lines.push("", "## Custom fields");
    for (const f of template.fields) {
      lines.push(`- ${inlineOr(f.key, NO_NAME)}: ${inlineOr(f.value, "`(empty)`")}`);
    }
  }
  lines.push("", "## Instructions");
  // ⚠ BODY below the rule — the system prompt is the document this op exists to
  // hand over, and stripping its markdown breaks the feature. Framed above when
  // it is somebody else's; never neutralized.
  lines.push("", "---", "");
  // ⚠ FENCED WHEN IT IS SOMEBODY ELSE'S, and the fence sits HERE rather than at
  // the top of the result: it wraps the instructions block alone, so the header
  // rows above it are visibly this server's and the system prompt cannot be
  // read as continuing into them.
  // ⚠ **STILL CONDITIONAL, AND NO LONGER A BANNER** (A14). This block is a
  // SYSTEM PROMPT another member wrote, which is the reason `op="get"` takes a
  // caller id at all; it used to carry its own 340-char banner and now carries
  // `untrusted-fence.ts`'s one wording plus the part a banner could never do —
  // a close tag with a per-response random suffix, so the prompt cannot end its
  // own fence and claim the text after it. The caller's OWN templates render
  // bare: framing every one of them is noise on the common path, and noise is
  // how a security header stops being read.
  // ⚠ **CLIPPED BEFORE THE FENCE, NEVER AFTER** (A16). `fenceBody` closes with a
  // per-response random suffix; clipping the fenced block would cut that close
  // tag off and leave a system prompt somebody else wrote running to the end of
  // the response with nothing marking where it stops. The clip is a size knob,
  // not a licence to break the one structure that makes foreign instructions
  // safe to render at all.
  const whole = template.instructions ?? "_No instructions set._";
  const { body: instructions, notice } = clipToMaxChars(whole, maxChars);
  lines.push(
    ...(foreign && template.instructions
      ? fenceBody(instructions, "agent instructions by another member")
      : [instructions]),
  );
  // ⚠ OUTSIDE the fence, so the notice is visibly this server's — a line the
  // clipped prompt could otherwise be read as having written about itself.
  if (notice) lines.push("", notice);
  return ok(lines.join("\n"));
}
