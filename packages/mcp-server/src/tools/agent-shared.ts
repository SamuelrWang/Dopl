/**
 * Shared resolution + rendering for `dopl_agent`. The registrar (`agent.ts`)
 * routes; the op modules render.
 *
 * ⚠ THE `agent-` FILENAME PREFIX IS THE CONTRACT — `tool-group-files.ts` groups
 * a tool's files on the registrar's stem, and a handler in an unprefixed file is
 * invisible to every parity scan.
 *
 * ── THE THREE-ANSWER RULE (spec §7.1) ─────────────────────────────────────
 * A ref resolves to exactly one of RESOLVED / AMBIGUOUS / NOT FOUND, and the
 * middle one REFUSES with every candidate listed. The shipped precedent is
 * `src/features/agent-templates/server/service-resolve-ref.ts ›
 * resolveTemplateRef`, which the launch lane already uses — so an agent learns
 * ONE rule for naming a template, whichever door it comes through.
 *
 * ⚠ THIS IS NOT A SECOND COPY OF `canSeeTemplate`, and it must never become
 * one. It matches NAMES over the rows `GET /api/agent-templates` already
 * returned, which the server filtered through the visibility matrix before they
 * crossed the wire — the same shape `knowledge-shared.ts › resolveBase` uses
 * over `listKbBases`. A predicate re-implemented here would be the F-278 shape:
 * "the copy is the one that will not notice".
 *
 * ⚠ 404-NEVER-403. "No such template" and "not visible to you" are ONE answer,
 * because the difference between the two is an existence oracle (INVARIANTS
 * §5A), and this surface must not rebuild on a new door what the route closed.
 */

import type { AgentTemplate, DoplClient } from "@dopl/client";
import { inlineOr } from "./narration.js";
import { apiMessage, err, isApiError, type ToolResponse } from "./respond.js";

/**
 * The server's 403 code for "a credential that may be shared between humans
 * cannot own a PRIVATE row". ⚠ ONE SPELLING, shared with the knowledge surface
 * (`knowledge-shared.ts › sharedCredentialPrivateBaseDenied`) — both create
 * paths can raise it and neither may guess at the string.
 */
export const PRIVATE_VISIBILITY_DENIED_CODE = "WORKSPACE_KEY_PRIVATE_VISIBILITY";

/**
 * 🔒 THE VISIBILITY AXIS THIS SURFACE OFFERS — **TWO values, not three.**
 *
 * `TemplateVisibility` in `src/features/agent-templates/types.ts` still carries
 * `'team'`, the column still stores it and the route still accepts it from the
 * app. A8 takes the axis off the MCP SURFACE ONLY, so no agent is ever TAUGHT a
 * third option: measured in production 2026-09-02 there are **0 team-visibility
 * templates and 0 `agent_template_teams` rows**, and an axis nothing uses is an
 * enum arm a model still has to read, weigh and occasionally pick. Dropping the
 * column, the two tables, the trigger and the app's second editor is B4.
 *
 * ⚠ ONE DECLARATION, read by the tool's enum ({@link agent.ts}), the list
 * grouping ({@link agent-ops-read.ts}) and the write input type
 * ({@link agent-ops-write.ts}) — a second list is how an enum and its headings
 * drift apart in silence.
 *
 * ⚠ IT NARROWS WHAT IS OFFERED, NOT WHAT EXISTS. A row the server hands back at
 * a visibility absent from this list is still RENDERED (see `opList`); filtering
 * the read to match the write enum would drop rows instead of retiring an axis.
 */
export const TEMPLATE_VISIBILITY_VALUES = ["private", "workspace"] as const;

/** The visibility values `dopl_agent` accepts on a write. */
export type OfferedTemplateVisibility =
  (typeof TEMPLATE_VISIBILITY_VALUES)[number];

/**
 * The one-line refusal for a retired `visibility`, raised by zod as `-32602`
 * before any round trip — the same argument `shelf.ts` makes for its enum.
 *
 * ⚠ IT NAMES THE RETIRED VALUE. zod's own "Invalid option: expected one of …"
 * reads as a typo and invites a retry with the same word; saying the option is
 * gone is what stops the second call.
 */
export const VISIBILITY_ENUM_MESSAGE =
  'visibility must be "private" or "workspace", and nothing was written — "team" is no longer a sharing option on this surface.';

/** A template with nothing nameable left after neutralization. */
export const NO_NAME = "`(unnamed)`";

/** ⚠ Local, like `channel-addressing.ts` and `ontology-ops-write.ts` — three
 *  copies already exist in this package and unifying them is not this wave. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TemplateRefResolution =
  | { kind: "found"; template: AgentTemplate }
  | { kind: "not-found" }
  | { kind: "ambiguous"; matches: AgentTemplate[] };

/**
 * Resolve `ref` — a template ID or an exact NAME — against what this caller may
 * see.
 *
 *   1. UUID → id match, exact. ⚠ NEVER falls back to a name lookup on a miss:
 *      a fallback would make "no such id" and "no such name" answer through each
 *      other.
 *   2. Otherwise → CASE-INSENSITIVE EXACT match on `name`. Not a prefix, not
 *      fuzzy: an orchestrator naming "Auditor" must not silently get "Contract
 *      Auditor".
 *   3. More than one → AMBIGUOUS, listing each. 4. Zero → not found.
 */
export async function resolveTemplateRef(
  client: DoplClient,
  ref: string,
): Promise<TemplateRefResolution> {
  const needle = ref.trim();
  if (needle === "") return { kind: "not-found" };
  // ⚠ NO `shelf` FILTER. A ref must resolve wherever the row lives — narrowing
  // here would make a personal-shelf template unaddressable from an op that
  // never mentioned a shelf.
  const all = await client.listAgentTemplates();
  if (UUID_RE.test(needle)) {
    const byId = all.find((t) => t.id === needle);
    return byId ? { kind: "found", template: byId } : { kind: "not-found" };
  }
  const matches = all.filter(
    (t) => t.name.toLocaleLowerCase() === needle.toLocaleLowerCase(),
  );
  if (matches.length === 0) return { kind: "not-found" };
  if (matches.length === 1) return { kind: "found", template: matches[0] };
  // ⚠ Name-ordered so a caller re-reading the refusal sees a stable list and can
  // act on "the second one".
  return {
    kind: "ambiguous",
    matches: [...matches].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * `resolveTemplateRef` + the two refusals, so an op body is one `isErr` check.
 * Returns the row, or the tool error to return verbatim.
 */
export async function resolveTemplateOr(
  client: DoplClient,
  ref: string,
): Promise<AgentTemplate | ToolResponse> {
  const res = await resolveTemplateRef(client, ref);
  if (res.kind === "found") return res.template;
  if (res.kind === "ambiguous") return ambiguousTemplate(ref, res.matches);
  return templateNotFound(ref);
}

export function isErr(x: AgentTemplate | ToolResponse): x is ToolResponse {
  return "isError" in x && x.isError === true;
}

/**
 * THE AMBIGUOUS-NAME REFUSAL — **it lists, and it does not pick.**
 *
 * ⚠ `agent_templates` HAS NO NAME UNIQUENESS, DELIBERATELY: a unique index
 * across a visibility boundary would leak the existence of somebody's private
 * row through a conflict error, and two people may each keep a "Researcher". So
 * two visible templates sharing a name is a LEGITIMATE state, and every natural
 * tie-break ("mine wins", "newest wins") silently acts on an identity the caller
 * did not choose and reports success.
 *
 * ⚠ THE LIST IS NOT AN ORACLE. Every row in it already passed this caller's own
 * visibility predicate server-side, so it discloses exactly what op="list"
 * would. ⚠ And the list is the whole VALUE of the refusal — "that name is
 * ambiguous" alone sends the agent to another tool for ids it was already
 * holding.
 */
export function ambiguousTemplate(
  ref: string,
  matches: AgentTemplate[],
): ToolResponse {
  const label = inlineOr(ref, NO_NAME);
  return err(
    [
      `Nothing was read or written — the name ${label} matches ${matches.length} agent templates you can see, and this call refuses rather than picking one. Template names are deliberately NOT unique (two members may each keep a "Researcher").`,
      `Re-issue with the ID of the one you meant:`,
      ...matches.map(
        (m) =>
          `- \`${m.id}\` — ${inlineOr(m.name, NO_NAME)} (${m.visibility})`,
      ),
    ].join("\n"),
  );
}

/**
 * THE NOT-FOUND REFUSAL. ⚠ It does not say whether the template EXISTS: the
 * whole read surface is 404-never-403 so an id cannot be probed, and a sentence
 * that guessed would rebuild that oracle.
 */
export function templateNotFound(ref: string): ToolResponse {
  return err(
    `No agent template ${inlineOr(ref, NO_NAME)} resolves for you, and nothing was read or written. Either there is no such template or it is not shared with you — those are ONE answer here on purpose, so ids cannot be probed. Matching on a name is EXACT (case-insensitive), never fuzzy; list what you can see with dopl_agent(op="list").`,
  );
}

/**
 * A template write refused because the caller is neither its creator nor a
 * workspace admin (403 `RESOURCE_ACCESS_DENIED`). Null so the caller rethrows.
 *
 * ⚠ Only ever reachable for a template the caller CAN SEE — an invisible one
 * 404s first, so surfacing this never confirms existence.
 */
export function templateWriteDenied(e: unknown): ToolResponse | null {
  if (
    typeof e !== "object" ||
    e === null ||
    (e as { status?: number }).status !== 403 ||
    (e as { code?: unknown }).code !== "RESOURCE_ACCESS_DENIED"
  ) {
    return null;
  }
  const msg = (e as { apiMessage?: unknown }).apiMessage;
  return err(
    typeof msg === "string" && msg
      ? `${msg} Nothing was changed.`
      : `Only the template's creator or a workspace admin can change it. Nothing was changed.`,
  );
}

/**
 * A knowledge base named in `knowledge_bases` is not visible to the caller
 * (404 `KNOWLEDGE_BASE_NOT_FOUND`). ⚠ 404-SHAPED ON PURPOSE server-side —
 * "you may not attach this" and "no such base" must be the same answer, or the
 * attach endpoint becomes an existence oracle for other people's private bases.
 * The refusal here must not soften that into a "forbidden".
 */
export function knowledgeBaseNotAttachable(e: unknown): ToolResponse | null {
  if (!isApiError(e, 404, "KNOWLEDGE_BASE_NOT_FOUND")) return null;
  return err(
    `At least one knowledge base id you passed does not resolve for you, so nothing was written. A base you cannot READ cannot be attached — that is what stops a template laundering access to somebody else's private base — and "not yours" and "no such base" answer the same way here. Check ids with dopl_kb(op="list_bases").`,
  );
}

/**
 * A shared/service credential tried to own a PRIVATE template (403
 * `WORKSPACE_KEY_PRIVATE_VISIBILITY`). ⚠ Surfaced with the server's own
 * sentence: it names the key class and the fix, and this layer cannot tell which
 * credential is in play.
 */
export function sharedCredentialPrivateDenied(e: unknown): ToolResponse | null {
  if (!isApiError(e, 403, PRIVATE_VISIBILITY_DENIED_CODE)) return null;
  return err(
    `${apiMessage(e) ?? "This credential cannot own a private agent template."} Nothing was created. A credential that may be shared between humans has no "private to me" to write to — create it with visibility="workspace", or reconnect with a personal credential.`,
  );
}

/** One template rendered as a list row. ⚠ Every displayed field is a VALUE
 *  spliced into a line we wrote — name and description are length-bounded only,
 *  so a newline in either would otherwise start a row of its own. */
export function templateRow(t: AgentTemplate): string {
  const desc = t.description ? `\n  ${inlineOr(t.description, "")}` : "";
  const model = t.model ? ` · model ${inlineOr(t.model, "`(unnamed)`")}` : "";
  const kbs =
    t.knowledgeBases.length > 0
      ? ` · ${t.knowledgeBases.length} knowledge base${t.knowledgeBases.length === 1 ? "" : "s"}`
      : "";
  return `- ${inlineOr(t.name, NO_NAME)} (id: \`${t.id}\` · ${t.visibility}${model}${kbs})${desc}`;
}

/**
 * ⚠ WHOSE VIEW THIS IS, stated ON THE RESULT and not only in the description.
 * `listTemplates` is filtered server-side by `canSeeTemplate`, so another
 * member's private templates, and any the caller has no grant on, are simply
 * absent — an untraced filter makes a four-row heading read as the workspace's
 * roster.
 *
 * ⚠ **THE `· personal` MARKER LEFT ON 2026-09-02 (slice B15, ruling B10).** It
 * rode a `homeScopedTemplateIds` SIBLING KEY over the `home_scoped` boolean, and
 * that column is dropped: a personal template is an ordinary row in the caller's
 * own `kind='personal'` container, so every row a single list returns is on the
 * same shelf and a per-row label says nothing. **The tenancy is what answers
 * now**, and the status footer already names it.
 */
export const TEMPLATES_SCOPE_NOTE = `_Agent templates you can SEE here. Another member's private templates, and any you have no grant on, are not listed — this is your view, not the workspace's roster._`;
