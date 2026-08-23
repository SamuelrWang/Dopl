import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import type { AgentTemplateContext, TemplateVisibility } from "../types";
import * as repo from "./repository";
import { canSeeTemplate, shareCtxForTemplates } from "./service-shared";

/**
 * ID-OR-NAME TEMPLATE RESOLUTION — the narrow export the LAUNCH DIRECTIVE lane
 * calls, and the only thing this feature exposes to another feature's service.
 *
 * ── ⚠ WHY IT LIVES HERE AND NOT IN `channels/` ────────────────────────────
 *
 * The alternative was for `channels/server/service-launch.ts` to read
 * `agent_templates` itself and apply the matrix. **That would be a SECOND copy
 * of `canSeeTemplate`**, and this tree has the record of what that costs:
 * `service-shared.ts › canSeeBaseRow` is a hand copy of the knowledge feature's
 * `canSeeBase` and F-278 is filed against exactly that shape — *"the copy is the
 * one that will not notice"*. A visibility matrix is the last predicate in the
 * product that should be written twice; it is already written twice (here and in
 * `agent_templates_member_select`) and that pair is documented as having to move
 * together.
 *
 * So the composition goes the other way: this feature keeps the matrix, and hands
 * out ONE function whose answer is three ids and nothing else. It is a
 * cross-feature import at the call site (INVARIANTS §1 says there are none;
 * **F-275 records that the tree has never obeyed that rule** and that the top
 * pairs are architectural). `channels → agent-templates` is already six imports
 * on the client side (`template-picker`, `launch-overrides`), so this adds a
 * direction that exists rather than a direction that does not.
 *
 * ── ⚠ WHAT IT DELIBERATELY DOES NOT RETURN ────────────────────────────────
 *
 * No instructions, no fields, no knowledge bases, no model. **The directive
 * stores an ID; the CONTENT is resolved on the desktop, at spawn, under the
 * OPERATOR's credential** (`main/template-resolve.js`, spec §3b). A resolver
 * that returned content here would put the ORCHESTRATOR's viewer-filtered
 * `knowledgeBases` into a row the OPERATOR later runs — two different people,
 * one filter, and the wrong one.
 *
 * ── ⚠ THE AMBIGUITY ARM IS A REFUSAL, NEVER A PICK ────────────────────────
 *
 * `agent_templates` has NO name uniqueness, deliberately: a unique index across a
 * visibility boundary would leak the existence of somebody's private row through
 * a conflict error, and two people may each keep a private "Researcher". So a
 * bare NAME can legitimately match more than one row the caller may see, and
 * every natural collision rule ("mine wins", "newest wins") silently launches an
 * identity the caller did not choose. It refuses and lists.
 *
 * ⚠ THE LIST IS NOT AN ORACLE. It contains only rows `canSeeTemplate` has already
 * passed FOR THIS CALLER, so it discloses nothing the list endpoint does not.
 */

/** One row in an ambiguity refusal. ⚠ Only ever built from rows the caller can
 *  already see — `visibility` is what makes the disambiguation actionable ("the
 *  private one is mine, the workspace one is the team's"). */
export interface TemplateRefMatch {
  id: string;
  name: string;
  visibility: TemplateVisibility;
}

/**
 * ⚠ A DISCRIMINATED UNION, NOT A THROW. The caller is another feature's service,
 * and it wants to raise ITS OWN domain error with its own HTTP mapping — a
 * thrown `AgentTemplateNotFoundError` crossing into the channels error mapper
 * would need that mapper to import this feature's error classes, which is a
 * second cross-feature edge for no gain. The union keeps the fence here and the
 * wording there.
 *
 * ⚠ `not-found` COVERS BOTH "no such row" AND "not visible to you", and must:
 * this feature's whole read surface is 404-never-403 so an id cannot be probed,
 * and a resolver that split them would rebuild that oracle on a new door.
 */
export type TemplateRefResolution =
  | { kind: "found"; id: string; name: string }
  | { kind: "not-found" }
  | { kind: "ambiguous"; matches: TemplateRefMatch[] };

/**
 * Resolve `ref` — a template ID or an exact NAME — against what THIS caller may
 * see.
 *
 *   1. `ref` parses as a UUID → treat it as an id, exact match. ⚠ Never falls
 *      back to a name lookup on a miss: a UUID-shaped name is not a thing this
 *      product makes, and a fallback would make "no such id" and "no such name"
 *      answer through each other.
 *   2. Otherwise → CASE-INSENSITIVE EXACT match on `name`. Not a prefix and not
 *      a fuzzy match: an orchestrator naming "Auditor" must not silently get
 *      "Contract Auditor", and a substring rule turns every added template into
 *      a chance of re-pointing somebody's existing call.
 *   3. More than one → REFUSE, listing each match.
 *   4. Zero → not found.
 *
 * ⚠ THE NAME PATH READS THE WHOLE WORKSPACE AND FILTERS IN THE SERVICE, exactly
 * as `listTemplates` does, because the matrix is a TypeScript predicate over
 * team links — it cannot be expressed as a `WHERE`. The row count is a
 * workspace's template list; this is a cold path (one call per launch), and the
 * alternative is the second copy of the matrix this file exists to avoid.
 */
export async function resolveTemplateRef(
  ctx: AgentTemplateContext,
  ref: string
): Promise<TemplateRefResolution> {
  const needle = ref.trim();
  if (needle === "") return { kind: "not-found" };

  if (isUuid(needle)) {
    const template = await repo.findTemplateById(ctx.workspaceId, needle);
    if (!template) return { kind: "not-found" };
    const share = await shareCtxForTemplates(ctx, [template]);
    if (!canSeeTemplate(ctx, template, share)) return { kind: "not-found" };
    return { kind: "found", id: template.id, name: template.name };
  }

  const all = await repo.listTemplatesForWorkspace(ctx.workspaceId);
  if (all.length === 0) return { kind: "not-found" };
  const share = await shareCtxForTemplates(ctx, all);
  // ⚠ THE VISIBILITY FILTER RUNS BEFORE THE NAME COMPARE, not after. Comparing
  // first and filtering second would be the same answer here — and would be a
  // shape where a future `else` branch on "matched but invisible" could tell a
  // caller that SOMETHING with that name exists.
  const matches = all
    .filter((t) => canSeeTemplate(ctx, t, share))
    // ⚠ `toLocaleLowerCase()` on both halves — the same casefold the picker's
    // own search uses. It is exact-after-casefold, nothing looser.
    .filter((t) => t.name.toLocaleLowerCase() === needle.toLocaleLowerCase());

  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) {
    return { kind: "found", id: matches[0].id, name: matches[0].name };
  }
  return {
    kind: "ambiguous",
    // ⚠ NAME-ORDERED ALREADY (`listTemplatesForWorkspace` orders by name), so the
    // list is stable across calls; a caller re-reading the refusal sees the same
    // order and can act on "the second one".
    matches: matches.map((t) => ({
      id: t.id,
      name: t.name,
      visibility: t.visibility,
    })),
  };
}
