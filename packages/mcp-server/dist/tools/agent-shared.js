"use strict";
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
 * `src/features/agent-identities/server/service-resolve-ref.ts ›
 * resolveIdentityRef`, which the launch lane already uses — so an agent learns
 * ONE rule for naming an identity, whichever door it comes through.
 *
 * ⚠ THIS IS NOT A SECOND COPY OF `canSeeIdentity`, and it must never become
 * one. It matches NAMES over the rows `GET /api/agent-identities` already
 * returned, which the server filtered through the visibility matrix before they
 * crossed the wire — the same shape `knowledge-shared.ts › resolveBase` uses
 * over `listKbBases`. A predicate re-implemented here would be the F-278 shape:
 * "the copy is the one that will not notice".
 *
 * ⚠ 404-NEVER-403. "No such identity" and "not visible to you" are ONE answer,
 * because the difference between the two is an existence oracle (INVARIANTS
 * §5A), and this surface must not rebuild on a new door what the route closed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IDENTITIES_SCOPE_NOTE = exports.VISIBILITY_ENUM_MESSAGE = exports.IDENTITY_VISIBILITY_VALUES = exports.IDENTITY_NOT_FOUND_CODE = exports.PRIVATE_VISIBILITY_DENIED_CODE = void 0;
exports.resolveIdentityRef = resolveIdentityRef;
exports.resolveIdentityOr = resolveIdentityOr;
exports.ambiguousIdentity = ambiguousIdentity;
exports.identityNotFound = identityNotFound;
exports.identityWriteDenied = identityWriteDenied;
exports.knowledgeBaseNotAttachable = knowledgeBaseNotAttachable;
exports.sharedCredentialPrivateDenied = sharedCredentialPrivateDenied;
exports.identityRow = identityRow;
const narration_js_1 = require("./narration.js");
const respond_js_1 = require("./respond.js");
/**
 * The server's 403 code for "a credential that may be shared between humans
 * cannot own a PRIVATE row". ⚠ ONE SPELLING, shared with the knowledge surface
 * (`knowledge-shared.ts › sharedCredentialPrivateBaseDenied`) — both create
 * paths can raise it and neither may guess at the string.
 */
exports.PRIVATE_VISIBILITY_DENIED_CODE = "WORKSPACE_KEY_PRIVATE_VISIBILITY";
/** The server's 404 code for an identity this caller cannot name — the one
 *  refusal {@link resolveIdentityRef}'s id door swallows. ⚠ ONE SPELLING, and it
 *  is `src/features/agent-identities/server/http-mapping.ts`'s. */
exports.IDENTITY_NOT_FOUND_CODE = "AGENT_IDENTITY_NOT_FOUND";
/**
 * 🔒 THE VISIBILITY AXIS THIS SURFACE OFFERS — **TWO values, not three.**
 *
 * `IdentityVisibility` in `src/features/agent-identities/types.ts` still carries
 * `'team'`, the column still stores it and the route still accepts it from the
 * app. A8 takes the axis off the MCP SURFACE ONLY, so no agent is ever TAUGHT a
 * third option: measured in production 2026-09-02 there are **0 team-visibility
 * identities and 0 `agent_template_teams` rows**, and an axis nothing uses is an
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
exports.IDENTITY_VISIBILITY_VALUES = ["private", "workspace"];
/**
 * The one-line refusal for a retired `visibility`, raised by zod as `-32602`
 * before any round trip — the same argument `shelf.ts` makes for its enum.
 *
 * ⚠ IT NAMES THE RETIRED VALUE. zod's own "Invalid option: expected one of …"
 * reads as a typo and invites a retry with the same word; saying the option is
 * gone is what stops the second call.
 */
exports.VISIBILITY_ENUM_MESSAGE = 'visibility must be "private" or "workspace", and nothing was written — "team" is no longer a sharing option on this surface.';
/** ⚠ Local, like `channel-addressing.ts` and `ontology-ops-write.ts` — three
 *  copies already exist in this package and unifying them is not this wave. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Resolve `ref` — an identity ID or an exact NAME — against what this caller may
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
 * 2026-09-06 AND THIS ONE DID NOT (2026-09-18).** `listAgentIdentities` answers
 * for the container this call is in plus the caller's own personal one, so
 * matching a ref against that list made `get` and `update` CONTAINER-KEYED —
 * including the two ops whose whole argument is an id. An identity in another
 * home channel the caller is a member of answered "no such identity" for an id
 * that `GET /api/agent-identities/<id>` resolves, which is the wave's headline
 * claim ("an id resolves its own container") being untrue on this surface, and
 * it is why `get`/`update` are not in `workspace-arg.ts › WORKSPACE_ARG_OPS`:
 * there is nothing for a `container=` to fix once the id answers for itself.
 *
 * ⚠ **THE SECOND LOOKUP IS NOT A SECOND FENCE AND ADDS NO REACH.** It is the
 * server's own id door, which runs `canSeeIdentity` in the container the id
 * names. A ref this caller may not name comes back a 404 and is reported as
 * not-found — the same answer as before, and 404-never-403 is preserved.
 *
 * ⚠ **UUID ONLY, AND ONLY AN API REFUSAL IS SWALLOWED.** A transport failure
 * must not read as "no such identity" — that is how an outage becomes a deletion
 * in an agent's notes (`knowledge-shared.ts › resolveBaseRef`'s own rule).
 */
async function resolveIdentityRef(client, ref) {
    const needle = ref.trim();
    if (needle === "")
        return { kind: "not-found" };
    // ⚠ NO `shelf` FILTER. A ref must resolve wherever the row lives — narrowing
    // here would make a personal-shelf identity unaddressable from an op that
    // never mentioned a shelf.
    const all = await client.listAgentIdentities();
    if (UUID_RE.test(needle)) {
        const byId = all.find((t) => t.id === needle);
        if (byId)
            return { kind: "found", identity: byId };
        try {
            return { kind: "found", identity: await client.getAgentIdentity(needle) };
        }
        catch (e) {
            if (!(0, respond_js_1.isApiError)(e, 404, exports.IDENTITY_NOT_FOUND_CODE))
                throw e;
            return { kind: "not-found" };
        }
    }
    const matches = all.filter((t) => t.name.toLocaleLowerCase() === needle.toLocaleLowerCase());
    if (matches.length === 0)
        return { kind: "not-found" };
    if (matches.length === 1)
        return { kind: "found", identity: matches[0] };
    // ⚠ Name-ordered so a caller re-reading the refusal sees a stable list and can
    // act on "the second one".
    return {
        kind: "ambiguous",
        matches: [...matches].sort((a, b) => a.name.localeCompare(b.name)),
    };
}
/**
 * `resolveIdentityRef` + the two refusals, so an op body is one `isErr` check.
 * Returns the row, or the tool error to return verbatim.
 */
async function resolveIdentityOr(client, ref) {
    const res = await resolveIdentityRef(client, ref);
    if (res.kind === "found")
        return res.identity;
    if (res.kind === "ambiguous")
        return ambiguousIdentity(ref, res.matches);
    return identityNotFound(ref);
}
/**
 * THE AMBIGUOUS-NAME REFUSAL — **it lists, and it does not pick.**
 *
 * ⚠ `agent_identities` HAS NO NAME UNIQUENESS, DELIBERATELY: a unique index
 * across a visibility boundary would leak the existence of somebody's private
 * row through a conflict error, and two people may each keep a "Researcher". So
 * two visible identities sharing a name is a LEGITIMATE state, and every natural
 * tie-break ("mine wins", "newest wins") silently acts on an identity the caller
 * did not choose and reports success.
 *
 * ⚠ THE LIST IS NOT AN ORACLE. Every row in it already passed this caller's own
 * visibility predicate server-side, so it discloses exactly what op="list"
 * would. ⚠ And the list is the whole VALUE of the refusal — "that name is
 * ambiguous" alone sends the agent to another tool for ids it was already
 * holding.
 */
function ambiguousIdentity(ref, matches) {
    const label = (0, narration_js_1.inlineOr)(ref, narration_js_1.NO_NAME);
    return (0, respond_js_1.err)([
        `Nothing was read or written — the name ${label} matches ${matches.length} agent identities you can see, and this call refuses rather than picking one. Identity names are deliberately NOT unique (two members may each keep a "Researcher").`,
        `Re-issue with the ID of the one you meant:`,
        ...matches.map((m) => `- \`${m.id}\` — ${(0, narration_js_1.inlineOr)(m.name, narration_js_1.NO_NAME)} (${m.visibility})`),
    ].join("\n"));
}
/**
 * THE NOT-FOUND REFUSAL. ⚠ It does not say whether the identity EXISTS: the
 * whole read surface is 404-never-403 so an id cannot be probed, and a sentence
 * that guessed would rebuild that oracle.
 */
function identityNotFound(ref) {
    return (0, respond_js_1.err)(`No agent identity ${(0, narration_js_1.inlineOr)(ref, narration_js_1.NO_NAME)} resolves for you, and nothing was read or written. Either there is no such identity or it is not shared with you — those are ONE answer here on purpose, so ids cannot be probed. Matching on a name is EXACT (case-insensitive), never fuzzy; list what you can see with dopl_agent(op="list").`);
}
/**
 * An identity write refused because the caller is neither its creator nor a
 * workspace admin (403 `RESOURCE_ACCESS_DENIED`). Null so the caller rethrows.
 *
 * ⚠ Only ever reachable for an identity the caller CAN SEE — an invisible one
 * 404s first, so surfacing this never confirms existence.
 */
function identityWriteDenied(e) {
    if (typeof e !== "object" ||
        e === null ||
        e.status !== 403 ||
        e.code !== "RESOURCE_ACCESS_DENIED") {
        return null;
    }
    const msg = e.apiMessage;
    return (0, respond_js_1.err)(typeof msg === "string" && msg
        ? `${msg} Nothing was changed.`
        : `Only the identity's creator or a workspace admin can change it. Nothing was changed.`);
}
/**
 * A knowledge base named in `knowledge_bases` is not visible to the caller
 * (404 `KNOWLEDGE_BASE_NOT_FOUND`). ⚠ 404-SHAPED ON PURPOSE server-side —
 * "you may not attach this" and "no such base" must be the same answer, or the
 * attach endpoint becomes an existence oracle for other people's private bases.
 * The refusal here must not soften that into a "forbidden".
 */
function knowledgeBaseNotAttachable(e) {
    if (!(0, respond_js_1.isApiError)(e, 404, "KNOWLEDGE_BASE_NOT_FOUND"))
        return null;
    return (0, respond_js_1.err)(`At least one knowledge id you passed does not resolve for you, so nothing was written. A base you cannot READ cannot be attached — that is what stops an identity laundering access to somebody else's private base — and "not yours" and "no such base" answer the same way here. The same answer covers a folder or an entry that is trashed, or that lives in a different base than the one you named. Check ids with dopl_kb(op="list_bases") and dopl_kb(op="get_tree").`);
}
/**
 * A shared/service credential tried to own a PRIVATE identity (403
 * `WORKSPACE_KEY_PRIVATE_VISIBILITY`). ⚠ Surfaced with the server's own
 * sentence: it names the key class and the fix, and this layer cannot tell which
 * credential is in play.
 */
function sharedCredentialPrivateDenied(e) {
    if (!(0, respond_js_1.isApiError)(e, 403, exports.PRIVATE_VISIBILITY_DENIED_CODE))
        return null;
    return (0, respond_js_1.err)(`${(0, respond_js_1.apiMessage)(e) ?? "This credential cannot own a private agent identity."} Nothing was created. A credential that may be shared between humans has no "private to me" to write to — create it with visibility="workspace", or reconnect with a personal credential.`);
}
/** One identity rendered as a list row. ⚠ Every displayed field is a VALUE
 *  spliced into a line we wrote — name and description are length-bounded only,
 *  so a newline in either would otherwise start a row of its own.
 *
 *  ⚠ **`audience` IS PASSED IN, NOT READ OFF `t.visibility` (S21/S23,
 *  2026-09-18).** The column answers "what is in the visibility field"; a
 *  caller asks "who can see this", and inside a home channel `workspace` means
 *  the room rather than the company. The GROUP the caller put this row in is
 *  the only place that distinction exists — see `audience-label.ts`. */
function identityRow(t, audience) {
    const desc = t.description ? `\n  ${(0, narration_js_1.inlineOr)(t.description, "")}` : "";
    const model = t.model ? ` · model ${(0, narration_js_1.inlineOr)(t.model, narration_js_1.NO_NAME)}` : "";
    // ⚠ **"knowledge scope(s)", NOT "knowledge base(s)" (2026-09-08).** An
    // attachment is a base, a FOLDER or an ENTRY now, and counting three folders
    // of one base as "3 knowledge bases" is a false sentence about what the
    // identity names. ⚠ `knowledge` first, the base list as the §8/older-server
    // FALLBACK — never their sum, which would double-count every whole base.
    const scopeCount = (t.knowledge ?? []).length > 0 ? (t.knowledge ?? []).length : t.knowledgeBases.length;
    const kbs = scopeCount > 0
        ? ` · ${scopeCount} knowledge scope${scopeCount === 1 ? "" : "s"}`
        : "";
    return `- ${(0, narration_js_1.inlineOr)(t.name, narration_js_1.NO_NAME)} (id: \`${t.id}\` · seen by ${audience}${model}${kbs})${desc}`;
}
/**
 * ⚠ WHOSE VIEW THIS IS, stated ON THE RESULT and not only in the description.
 * `listIdentities` is filtered server-side by `canSeeIdentity`, so another
 * member's private identities, and any the caller has no grant on, are simply
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
 * groups by the `homeScopedIdentityIds` sibling key this note's argument had
 * retired; the key never went anywhere, only its reader did.
 */
exports.IDENTITIES_SCOPE_NOTE = `_Agent identities you can SEE here. Another member's private identities, and any you have no grant on, are not listed — this is your view, not the workspace's roster._`;
