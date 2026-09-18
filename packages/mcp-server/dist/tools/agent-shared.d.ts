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
import { type ToolResponse } from "./respond.js";
/**
 * The server's 403 code for "a credential that may be shared between humans
 * cannot own a PRIVATE row". ⚠ ONE SPELLING, shared with the knowledge surface
 * (`knowledge-shared.ts › sharedCredentialPrivateBaseDenied`) — both create
 * paths can raise it and neither may guess at the string.
 */
export declare const PRIVATE_VISIBILITY_DENIED_CODE = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
/** The server's 404 code for a template this caller cannot name — the one
 *  refusal {@link resolveTemplateRef}'s id door swallows. ⚠ ONE SPELLING, and it
 *  is `src/features/agent-templates/server/http-mapping.ts`'s. */
export declare const TEMPLATE_NOT_FOUND_CODE = "AGENT_TEMPLATE_NOT_FOUND";
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
export declare const TEMPLATE_VISIBILITY_VALUES: readonly ["private", "workspace"];
/** The visibility values `dopl_agent` accepts on a write. */
export type OfferedTemplateVisibility = (typeof TEMPLATE_VISIBILITY_VALUES)[number];
/**
 * The one-line refusal for a retired `visibility`, raised by zod as `-32602`
 * before any round trip — the same argument `shelf.ts` makes for its enum.
 *
 * ⚠ IT NAMES THE RETIRED VALUE. zod's own "Invalid option: expected one of …"
 * reads as a typo and invites a retry with the same word; saying the option is
 * gone is what stops the second call.
 */
export declare const VISIBILITY_ENUM_MESSAGE = "visibility must be \"private\" or \"workspace\", and nothing was written \u2014 \"team\" is no longer a sharing option on this surface.";
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
 *   1. UUID → id match over the visible list, then **the server's own id door**.
 *      ⚠ NEVER falls back to a name lookup on a miss: a fallback would make "no
 *      such id" and "no such name" answer through each other.
 *   2. Otherwise → CASE-INSENSITIVE EXACT match on `name`. Not a prefix, not
 *      fuzzy: an orchestrator naming "Auditor" must not silently get "Contract
 *      Auditor".
 *   3. More than one → AMBIGUOUS, listing each. 4. Zero → not found.
 *
 * 🔒 **THE ID DOOR IS THE PORT OF F-470, WHICH THE KNOWLEDGE LANE HAS HAD SINCE
 * 2026-09-06 AND THIS ONE DID NOT (2026-09-18).** `listAgentTemplates` answers
 * for the container this call is in plus the caller's own personal one, so
 * matching a ref against that list made `get` and `update` CONTAINER-KEYED —
 * including the two ops whose whole argument is an id. A template in another
 * home channel the caller is a member of answered "no such template" for an id
 * that `GET /api/agent-templates/<id>` resolves, which is the wave's headline
 * claim ("an id resolves its own container") being untrue on this surface, and
 * it is why `get`/`update` are not in `workspace-arg.ts › WORKSPACE_ARG_OPS`:
 * there is nothing for a `container=` to fix once the id answers for itself.
 *
 * ⚠ **THE SECOND LOOKUP IS NOT A SECOND FENCE AND ADDS NO REACH.** It is the
 * server's own id door, which runs `canSeeTemplate` in the container the id
 * names. A ref this caller may not name comes back a 404 and is reported as
 * not-found — the same answer as before, and 404-never-403 is preserved.
 *
 * ⚠ **UUID ONLY, AND ONLY AN API REFUSAL IS SWALLOWED.** A transport failure
 * must not read as "no such template" — that is how an outage becomes a deletion
 * in an agent's notes (`knowledge-shared.ts › resolveBaseRef`'s own rule).
 */
export declare function resolveTemplateRef(client: DoplClient, ref: string): Promise<TemplateRefResolution>;
/**
 * `resolveTemplateRef` + the two refusals, so an op body is one `isErr` check.
 * Returns the row, or the tool error to return verbatim.
 */
export declare function resolveTemplateOr(client: DoplClient, ref: string): Promise<AgentTemplate | ToolResponse>;
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
export declare function templateRow(t: AgentTemplate): string;
/**
 * ⚠ WHOSE VIEW THIS IS, stated ON THE RESULT and not only in the description.
 * `listTemplates` is filtered server-side by `canSeeTemplate`, so another
 * member's private templates, and any the caller has no grant on, are simply
 * absent — an untraced filter makes a four-row heading read as the workspace's
 * roster.
 *
 * ⚠ **THE `· personal` MARKER LEFT ON 2026-09-02 (slice B15, ruling B10)** on the
 * argument that *"every row a single list returns is on the same shelf, so a
 * per-row label says nothing"*.
 *
 * 🔒 **THAT ARGUMENT WAS FALSE FROM 2026-09-06, AND THE CORRECTION IS A
 * HEADING RATHER THAN A MARKER (2026-09-18).** Gap 1 of #1077 widened
 * `personal-container.ts › resolveShelfScope` so an UNFILTERED read returns the
 * calling container PLUS the caller's own personal one — two shelves in one
 * list, twelve days after the sentence above was written, and the footer names
 * only the container the call was ADDRESSED to. `agent-ops-read.ts › opList`
 * groups by the `homeScopedTemplateIds` sibling key this note's argument had
 * retired; the key never went anywhere, only its reader did.
 */
export declare const TEMPLATES_SCOPE_NOTE = "_Agent templates you can SEE here. Another member's private templates, and any you have no grant on, are not listed \u2014 this is your view, not the workspace's roster._";
