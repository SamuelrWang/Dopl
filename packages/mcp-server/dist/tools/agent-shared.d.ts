/**
 * Shared resolution + rendering for `dopl_agent` / `dopl_agent_admin`. The
 * registrar (`agent.ts`) routes; the op modules render.
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
import { type ToolResponse } from "./respond.js";
/** A template with nothing nameable left after neutralization. */
export declare const NO_NAME = "`(unnamed)`";
export type TemplateRefResolution = {
    kind: "found";
    template: AgentTemplate;
} | {
    kind: "not-found";
} | {
    kind: "ambiguous";
    matches: AgentTemplate[];
};
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
export declare function resolveTemplateRef(client: DoplClient, ref: string): Promise<TemplateRefResolution>;
/**
 * `resolveTemplateRef` + the two refusals, so an op body is one `isErr` check.
 * Returns the row, or the tool error to return verbatim.
 */
export declare function resolveTemplateOr(client: DoplClient, ref: string): Promise<AgentTemplate | ToolResponse>;
export declare function isErr(x: AgentTemplate | ToolResponse): x is ToolResponse;
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
export declare function ambiguousTemplate(ref: string, matches: AgentTemplate[]): ToolResponse;
/**
 * THE NOT-FOUND REFUSAL. ⚠ It does not say whether the template EXISTS: the
 * whole read surface is 404-never-403 so an id cannot be probed, and a sentence
 * that guessed would rebuild that oracle.
 */
export declare function templateNotFound(ref: string): ToolResponse;
/**
 * A template write refused because the caller is neither its creator nor a
 * workspace admin (403 `RESOURCE_ACCESS_DENIED`). Null so the caller rethrows.
 *
 * ⚠ Only ever reachable for a template the caller CAN SEE — an invisible one
 * 404s first, so surfacing this never confirms existence.
 */
export declare function templateWriteDenied(e: unknown): ToolResponse | null;
/**
 * A knowledge base named in `knowledge_bases` is not visible to the caller
 * (404 `KNOWLEDGE_BASE_NOT_FOUND`). ⚠ 404-SHAPED ON PURPOSE server-side —
 * "you may not attach this" and "no such base" must be the same answer, or the
 * attach endpoint becomes an existence oracle for other people's private bases.
 * The refusal here must not soften that into a "forbidden".
 */
export declare function knowledgeBaseNotAttachable(e: unknown): ToolResponse | null;
/**
 * A shared/service credential tried to own a PRIVATE template (403
 * `WORKSPACE_KEY_PRIVATE_VISIBILITY`). ⚠ Surfaced with the server's own
 * sentence: it names the key class and the fix, and this layer cannot tell which
 * credential is in play.
 */
export declare function sharedCredentialPrivateDenied(e: unknown): ToolResponse | null;
/** One template rendered as a list row. ⚠ Every displayed field is a VALUE
 *  spliced into a line we wrote — name and description are length-bounded only,
 *  so a newline in either would otherwise start a row of its own. */
export declare function templateRow(t: AgentTemplate, personal?: boolean): string;
/**
 * ⚠ WHOSE VIEW THIS IS, stated ON THE RESULT and not only in the description.
 * `listTemplates` is filtered server-side by `canSeeTemplate`, so another
 * member's private templates and team templates the caller has no grant on are
 * simply absent — an untraced filter makes a four-row heading read as the
 * workspace's roster.
 *
 * ⚠ AND THE SHELF IS NOT ON THE ROW. `home_scoped` is deliberately absent from
 * `server/dto.ts › AGENT_TEMPLATE_COLS` so no client can re-implement the fence;
 * the `personal` marker {@link templateRow} prints comes from the response's
 * SIBLING KEY (`homeScopedTemplateIds`), never from the row. Which is why the
 * note below states what an UNMARKED row means — workspace shelf, or a server
 * that does not send the key — rather than letting an absent label be read as an
 * assertion.
 */
export declare const TEMPLATES_SCOPE_NOTE = "_Agent templates you can SEE. Another member's private templates, and team templates you have no grant on, are not listed \u2014 this is your view, not the workspace's roster. A row marked `personal` is on your own /home shelf and does not appear on the workspace Agents page; an UNMARKED row is on the workspace shelf, or on a server too old to say._";
