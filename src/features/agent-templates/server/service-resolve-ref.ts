import "server-only";
import { isUuid } from "@/shared/lib/id/uuid";
import { readResourceById } from "@/shared/tenancy/read-resource";
import {
  resolveResourcesByName,
  type ResolvedResource,
} from "@/shared/tenancy/resolve-resource";
import type {
  AgentTemplate,
  AgentTemplateContext,
  TemplateVisibility,
} from "../types";
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
  /**
   * ⚠ THE MISS THAT IS NOT A MYSTERY (T35). The ref names a template the caller
   * COULD ALREADY LIST FOR THEMSELVES — their own row, or a `workspace`-visible
   * one — living in a DIFFERENT tenancy than the one this call resolves in. See
   * {@link classifyMissingTemplateRef} for why saying so is not an oracle.
   */
  | { kind: "elsewhere"; template: TemplateElsewhere }
  | { kind: "ambiguous"; matches: TemplateRefMatch[] };

/** A template the caller holds somewhere else, and the phrase for WHERE. ⚠ The
 *  label is a TENANCY, never a row list: one name, one place, nothing about who
 *  else is in it. */
export interface TemplateElsewhere {
  name: string;
  /** "your personal shelf" / "the workspace \u201cAcme\u201d" / a home channel's container id. */
  label: string;
}

/**
 * Resolve `ref` — a template ID or an exact NAME — against what THIS caller may
 * see.
 *
 *   1. `ref` parses as a UUID → treat it as an id, exact match, **in whichever
 *      container of the caller's it lives in** (ruling #18). ⚠ Never falls back
 *      to a name lookup on a miss: a UUID-shaped name is not a thing this
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
  // 🔒 **AN ID FOLLOWS ITS OWN TENANCY — RULING #18, AND IT IS WHAT RECONCILES
  // THE TWO LAUNCH LANES** (B2, 2026-09-02). This door and the desktop's
  // spawn-time one (`service-reads.ts › readTemplateById`) now give the SAME
  // answer for the same id: a personal template launches anywhere its owner is.
  // Until B2 this side was workspace-keyed and 404'd an id the other side
  // followed — an asymmetry that was recorded rather than fixed, because
  // deciding it was Samuel's to decide.
  if (isUuid(needle)) {
    const hit = await readResourceById(
      ctx,
      "agent_template",
      needle,
      loadVisibleTemplateRow
    );
    return hit
      ? { kind: "found", id: hit.value.id, name: hit.value.name }
      : { kind: "not-found" };
  }
  const here = await resolveNameInThisTenancy(ctx, needle);
  if (here.kind !== "not-found") return here;
  // ⚠ ONE EXTRA READ, AND ONLY ON A MISS. The hit path is untouched; a launch
  // that resolves pays nothing for this, and a launch that does not is already
  // about to hand a human a sentence they have to act on.
  const template = await classifyMissingTemplateRef(ctx, needle);
  return template ? { kind: "elsewhere", template } : { kind: "not-found" };
}

/** One template, in ONE named container, through the matrix. ⚠ UNDECORATED on
 *  purpose — this lane resolves a REF and never reads the template's CONTENT,
 *  which is `service-reads.ts`'s single door and stays that way. */
async function loadVisibleTemplateRow(
  ctx: AgentTemplateContext,
  id: string
): Promise<AgentTemplate | null> {
  const template = await repo.findTemplateById(ctx.workspaceId, id);
  if (!template) return null;
  const share = await shareCtxForTemplates(ctx, [template]);
  return canSeeTemplate(ctx, template, share) ? template : null;
}

/** {@link resolveTemplateRef}'s NAME steps, inside `ctx.workspaceId` and nowhere
 *  else. ⚠ Split out so there is exactly ONE place that decides "not here", and
 *  therefore exactly one place the cross-tenancy classifier hangs off. */
async function resolveNameInThisTenancy(
  ctx: AgentTemplateContext,
  needle: string
): Promise<TemplateRefResolution> {
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

/**
 * 🔒 **WHY THE REF MISSED, WHEN THE HONEST ANSWER IS "IT LIVES SOMEWHERE ELSE"**
 * (T35).
 *
 * A template read is keyed `(workspace_id, id)`, so `canSeeTemplate` is never
 * even reached for a row in another tenancy — it is filtered out BEFORE
 * visibility runs. That makes "you own it" and "it resolves here" different
 * questions, and an agent that does not know the difference re-checks the
 * spelling of a name that was never wrong. This function is what lets the
 * refusal say which question failed.
 *
 * ── ⚠ WHY THIS IS NOT THE EXISTENCE ORACLE THE REST OF THE SURFACE CLOSES ──
 *
 * ⚠ **IT OWNS NO FENCE OF ITS OWN SINCE 2026-09-02 (A12).** Every clause —
 * shared credential, active membership at the `viewer` floor, the credential's
 * workspace lock, and the two-arm "rows you could already list for yourself"
 * `.or()` — lives once, in `shared/tenancy/resolve-resource.ts`, and this
 * function is the LABEL over its answer. What was a second place deciding what
 * may be named across a tenancy boundary is now a `.filter()` and a sentence.
 *
 * ⚠ IT NAMES A TENANCY, NEVER A ROSTER. One name and one place — never how many
 * matched, never who else is in that workspace, never the other candidates.
 *
 * ⚠ **NAMES ONLY SINCE B2, AND THE NARROWING IS THE POINT.** Both launch lanes
 * FOLLOW an id now (ruling #18), so an id that resolves elsewhere SUCCEEDS
 * rather than earning a label — there is no id-shaped miss left to explain. A
 * NAME still cannot resolve a tenancy on its own (`agent_templates` has no name
 * uniqueness, so several containers may each hold one and picking would launch
 * an identity nobody chose), which is what is left of T35: one place, one
 * sentence, no second id lane to keep in step.
 */
export async function classifyMissingTemplateRef(
  ctx: AgentTemplateContext,
  needle: string
): Promise<TemplateElsewhere | null> {
  const matches = await resolveResourcesByName(ctx, "agent_template", needle);
  // ⚠ "ELSEWHERE" IS THE WHOLE POINT — a match in the tenancy this call already
  // resolves in is not a miss to explain. The resolver is asked about the
  // caller's WHOLE reach and this is the one line that makes it a difference.
  const labelled = matches
    .filter(
      (row): row is ResolvedResource => row.containerId !== ctx.workspaceId
    )
    .map((row) => ({ name: row.name, label: tenancyLabel(row) }))
    // ⚠ ONE ANSWER, DETERMINISTICALLY CHOSEN. A name can legitimately match
    // rows in several tenancies; listing them would be the roster this must not
    // print, and an arbitrary pick would make the same refusal read differently
    // on two consecutive calls. Sorted by the label the caller will read.
    .sort((a, b) => a.label.localeCompare(b.label));
  return labelled[0] ?? null;
}

/**
 * The phrase for a tenancy the caller belongs to.
 *
 * ⚠ THREE SHAPES, AND THE FIRST ONE IS A CONTAINER KIND SINCE 2026-09-02
 * (slice B15, F-564). It read the `home_scoped` BOOLEAN and said "your personal
 * shelf"; the column is dropped and a personal row is an ordinary row in the
 * caller's own `kind='personal'` container (ruling B10), so the KIND is what
 * answers now — and it answers for KBs, skills and chats too, which the boolean
 * never did.
 * ⚠ **THIS IS ALSO WHY THE `!== "standard"` ARM COULD NOT STAY FIRST.** A
 * personal container is not standard, so under B11 every personal row would have
 * rendered as "a home channel of yours" with a container id the caller has no
 * use for. The two non-standard kinds are different places and the label says
 * which.
 * ⚠ A `kind='link'` container is named by ITS ID and not by its name: the id is
 * the actionable half (`workspace=<container id>`), and §4A forbids advertising
 * a container as a workspace.
 * ⚠ NO MARKDOWN IN HERE. The label is peer-adjacent text (a workspace NAME) and
 * every renderer of it neutralizes inline punctuation, so backticks added here
 * would arrive as blanks. The renderer decides the typography; this decides the
 * WORDS.
 */
function tenancyLabel(row: ResolvedResource): string {
  if (row.containerKind === "personal") return "your personal container";
  if (row.containerKind !== "standard") {
    return `a home channel of yours, container ${row.containerId}`;
  }
  return row.containerName
    ? `the workspace “${row.containerName}”`
    : "another workspace you belong to";
}
