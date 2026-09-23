"use strict";
/**
 * NAMED ERROR → NAMED REMEDY — ⚠ **the codes an agent matches on, in ONE
 * table** (A14, 2026-09-02).
 *
 * ⚠ THE MECHANISM IS STRING EQUALITY, AND EVERYTHING ELSE HERE SERVES IT.
 * Slack's whole reliability trick is one clause — *"If 'channel_not_found', try
 * slack_search_channels first"* — and it works only because the literal that
 * comes back on the wire is the literal the description taught. So a code is
 * declared ONCE, here; {@link renderErrors} puts it in the description and
 * {@link refusal} puts it on the wire, so the two are the same characters by
 * construction. A paraphrase on either side is a silent break — the agent reads
 * a remedy it can never match.
 *
 * ⚠ WHY OUR OWN LITERALS RATHER THAN THE API's, EXCEPT WHERE THEY ARE THE
 * API's. Most refusals on this surface are raised by THIS layer — a missing
 * param, a read-only scope, an unresolvable base — and never touch the API at
 * all, so there is no upstream code to quote. Where a refusal IS an API code
 * classified by `channel-errors.ts`, the row names that code verbatim
 * (`CHANNEL_FORBIDDEN`, not `not_a_member`), because the agent may also see it
 * echoed in a server detail line and the two must not look like two errors.
 *
 * ⚠ THREE PER TOOL IN THE DESCRIPTION, AND THAT IS A CEILING ON WHAT GETS
 * PUSHED, not on what this table may hold. `renderErrors` takes the first
 * three; order the array by how often the failure actually happens, because
 * position here is what decides which remedy an agent is told about.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_ERRORS = exports.SEARCH_ERRORS = exports.HOME_ERRORS = exports.CHANNEL_ERRORS = exports.AGENT_ERRORS = exports.ONTOLOGY_ERRORS = exports.MEMBERS_ERRORS = exports.CHATS_ERRORS = exports.BAD_SESSION_DATE = exports.SKILL_ERRORS = exports.KB_ERRORS = exports.SESSION_REQUIRED = exports.KB_TARGET_VANISHED = exports.KB_ENTRY_NOT_FOUND = exports.KB_INVALID_FIELD = exports.CREDITS_EXHAUSTED = exports.AMBIGUOUS_CONTAINER = exports.DELETE_IS_APP_ONLY = exports.READ_ONLY_SESSION = exports.MISSING_PARAMS = void 0;
exports.refusal = refusal;
exports.versionConflict = versionConflict;
exports.fieldTooLong = fieldTooLong;
/**
 * THE REFUSAL LINE ITSELF — ⚠ the one renderer, so a refusal on the wire and
 * the description that predicts it are produced by the same code.
 *
 * ⚠ `reason=` FIRST, because it is the half a model can match on; the sentence
 * after it is for a human reading a transcript. `retry=` last and always
 * present: "do not retry with the same input" is a fact an agent otherwise has
 * to infer, and it infers it wrong under pressure.
 */
function refusal(error, detail = "") {
    // ⚠ The meaning is written WITHOUT terminal punctuation so it reads as a
    // clause in the description's one-line `Errors:` row; the wire needs a full
    // stop before the detail, so it is added HERE rather than in thirty tables.
    const tail = detail ? `. ${detail.trim()}` : "";
    return `reason=${error.reason} · ${error.meaning}${tail} · retry=${error.retry}`;
}
/**
 * ⚠ THE CROSS-CUTTING FOUR — raised by the gates and the registrar, so they can
 * arrive from ANY tool and are declared apart from any one tool's table. They
 * are deliberately NOT pushed into all thirteen descriptions: a rule that
 * applies everywhere belongs in the `instructions` briefing, which states the
 * deletion rule and the `workspace=` contract once, and a tool names one of
 * these only when it is among its own top three.
 */
exports.MISSING_PARAMS = {
    reason: "missing_params",
    meaning: "a param this op needs is absent; the message names it",
    retry: "no",
};
exports.READ_ONLY_SESSION = {
    reason: "read_only_session",
    meaning: "this session is read-only — its token has no `dopl.write` scope",
    retry: "no",
};
exports.DELETE_IS_APP_ONLY = {
    reason: "delete_is_app_only",
    meaning: "agents never delete over MCP",
    retry: "no",
};
/**
 * 🔒 **THE SAME `ambiguous_slug` LITERAL `KB_ERRORS` DECLARES, ONE TABLE OVER**
 * (F-719) — a `container=` slug naming two rows the caller can SEE is refused
 * rather than picked, exactly as a base slug is. Declaring it HERE rather than
 * inventing `ambiguous_container` is what lets an agent match the same characters.
 *
 * ⚠ **CROSS-CUTTING, SO IT IS PUSHED INTO NO DESCRIPTION** — raised by the
 * registrar's address resolver for every tool that takes an address, like the four
 * above it; the remedy is in the refusal, which names every candidate's id.
 */
exports.AMBIGUOUS_CONTAINER = {
    reason: "ambiguous_slug",
    meaning: "that slug names 2+ containers you can see",
    retry: "use the id",
};
exports.CREDITS_EXHAUSTED = {
    reason: "credits_exhausted",
    // ⚠ "CREDITS", NEVER "MCP CREDITS" (Samuel, 2026-09-05: "it's not MCP
    // credits, it's credits"). This meaning is READ BY AGENTS — it ships inside
    // the served tool descriptions as well as the refusal — so the wording rule
    // binds here first.
    // ⚠ "YOU", NEVER "THIS WORKSPACE" (Samuel, 2026-09-07): an allocation belongs
    // to ONE person — a personal wallet, or one member's seat — and is never
    // pooled across a workspace, so a workspace-wide sentence would send the
    // caller to an admin who cannot refill it. ⚠ NO NUMBERS HERE: the allowances
    // live in `src/features/billing/credits.ts` alone.
    meaning: "you are out of credits for this billing period",
    retry: "no",
};
/**
 * ⚠ THE OPTIMISTIC-CONCURRENCY REFUSAL, PARAMETERIZED BY ITS REMEDY. The code
 * is one fact — somebody else wrote after your read — but the op that produces
 * a fresh `expected_version` differs per tool, and a remedy naming the wrong op
 * is worse than none: it sends the agent to a call that cannot help and it will
 * make it twice.
 */
function versionConflict(readOp) {
    return {
        reason: "version_conflict",
        meaning: "somebody wrote after your read; `expected_version` is stale",
        retry: readOp,
    };
}
/** A "we looked and it is not here" refusal, pointed at the op that lists. */
function notFound(reason, noun, listOp) {
    return {
        reason,
        meaning: `no ${noun} by that ref, or none you can read`,
        retry: listOp,
    };
}
/**
 * ⚠ **A FIELD OVER ITS CAP, AND THE TWO NUMBERS AN AGENT NEEDS ARE IN THE
 * `meaning` RATHER THAN IN THE DETAIL** (B3, 2026-09-18). The refusal these
 * produce reads `reason=field_too_long · field=excerpt limit=300 …`, so WHICH
 * field and WHAT bound are on the same line as the code a model matches on.
 *
 * ⚠ **A FACTORY, BECAUSE A SHARED ROW WOULD HAVE TO DROP THE NUMBERS.** One
 * static `field_too_long` would say "a field is over its cap" — which is what
 * `VALIDATION_FAILED` already said, and the whole defect S52 records is a
 * refusal that named the field and then printed the rule for a DIFFERENT one.
 * ⚠ **EMIT-ONLY: it is deliberately in no per-tool table.** `renderErrors`
 * pushes three rows per tool and `dopl_kb` has ~112 characters of headroom
 * before `HARD_DESCRIPTION_CEILING` throws at import; a fourth row there would
 * silently drop `ambiguous_slug`, which is the one KB failure an agent cannot
 * diagnose from the answer it gets instead.
 */
function fieldTooLong(field, limit) {
    return {
        reason: "field_too_long",
        meaning: `field=${field} limit=${limit} — the value you sent is longer`,
        retry: "shorten that field and re-issue; nothing was written",
    };
}
/**
 * ⚠ **A FIELD THAT BREAKS ITS OWN RULE RATHER THAN ITS LENGTH** — the sibling of
 * {@link fieldTooLong}, and emit-only for the same headroom reason. The RULE
 * itself goes in the detail, because it differs per field and a shared `meaning`
 * that tried to cover all of them is how a refusal ends up printing a title rule
 * over an excerpt failure (S52).
 */
exports.KB_INVALID_FIELD = {
    reason: "invalid_field",
    meaning: "a field's value breaks its own rule; this line names which",
    retry: "fix that field and re-issue; nothing was written",
};
/**
 * 🔒 **THE ENTRY 404, AND IT IS EMIT-ONLY FOR THE REASON DIRECTLY BELOW** (S41,
 * 2026-09-18). `src/features/knowledge/server/errors.ts › EntryNotFoundError`
 * becomes a 404 `KNOWLEDGE_ENTRY_NOT_FOUND`; until this wave NO MCP module
 * mapped it, so it rethrew past the registrar as an unhandled transport error
 * over a read that had simply missed.
 *
 * ⚠ **"MAY HAVE MOVED" IS THE LOAD-BEARING HALF, NOT A HEDGE.** A path is a
 * position, not an identity: `move_file` and a retitle both vacate one, and an
 * agent told only "not found" re-writes at the old path — which `write_file`
 * upserts into a SECOND entry. The remedy therefore names the op that lists,
 * and the detail names the entry id as the handle that survives a move.
 */
exports.KB_ENTRY_NOT_FOUND = {
    reason: "entry_not_found",
    meaning: "no entry at that path in that base; it may have moved or been renamed",
    retry: 'op="list_dir"',
};
/**
 * 🔒 **THE UPSERT'S OWN HAZARD, NAMED (S40, 2026-09-18).** The entry this write
 * meant to overwrite is no longer at that path — and because `write_file` is an
 * UPSERT, the obvious "recovery" (re-issue with `force=true`) writes a SECOND
 * entry at the vacated position rather than failing. So the remedy is the op
 * that says where it went, and the detail spells the duplicate out.
 * Emit-only, like its neighbours here.
 */
exports.KB_TARGET_VANISHED = {
    reason: "target_vanished",
    meaning: "the entry you meant to overwrite is not at that path any more",
    retry: 'op="list_dir" — NOT force=true, which would create a duplicate',
};
/**
 * ⚠ **AN MCP-REFUSED OP, ANSWERED AS A REFUSAL RATHER THAN AS A THROW** (S43).
 * `shared/auth/with-auth.ts`'s `sessionOnly` answers a 403 `SESSION_REQUIRED`
 * to every OAuth caller, and every MCP caller is one — so this is not a
 * permission an agent can be granted and `retry` says so. Emit-only for the
 * same headroom reason as {@link KB_ENTRY_NOT_FOUND}; making the OP LIST itself
 * honest about the refusal is a separate change (Q2, pending Samuel).
 */
exports.SESSION_REQUIRED = {
    reason: "session_required",
    meaning: "this op needs an interactive app session; MCP callers are refused",
    retry: "no",
};
/**
 * THE PER-TOOL TABLES. ⚠ Each is ordered by FREQUENCY, because
 * {@link renderErrors} pushes the first three and drops the rest — the order is
 * an editorial decision about which failure an agent is warned about, not a
 * list.
 */
/**
 * ⚠ **THREE ROWS, AND `entry_not_found` IS STILL NOT ONE OF THEM — BUT THE
 * REASON IN THIS DOCBLOCK WAS WRONG AND IS CORRECTED (S41, 2026-09-18).** It
 * said *"no code path emits that literal — a missing PATH comes back through
 * the same resolver that answers `base_not_found`"*. That described the absence
 * of a MAPPER, not the absence of an error: the server has always raised
 * `EntryNotFoundError` → 404 `KNOWLEDGE_ENTRY_NOT_FOUND` for a path that
 * resolves to nothing, and with nothing mapping it the refusal reached the
 * agent as an unhandled throw. {@link KB_ENTRY_NOT_FOUND} maps it now, so the
 * literal IS emitted — it stays off this table because `renderErrors` pushes
 * exactly three and a fourth row would silently drop `ambiguous_slug`, which is
 * the one KB failure an agent cannot diagnose from the answer it gets instead.
 * ⚠ `MISSING_PARAMS` is not here either: it is raised by `respond.ts` for every
 * op on every tool, so pushing it into one description buys nothing an agent
 * could act on differently.
 *
 * ⚠ **`ambiguous_slug` IS THIRD AND LAST, WHICH PUTS IT EXACTLY ON THE CUT.**
 * `renderErrors` pushes three, so it is taught — and it must be, because it is
 * the one KB failure an agent CANNOT diagnose from the successful-looking
 * answer it used to get instead (`knowledge-shared.ts › resolveBaseRef`). A
 * fourth row added here silently drops it.
 */
exports.KB_ERRORS = [
    notFound("base_not_found", "knowledge base", 'op="list_bases"'),
    versionConflict('op="read_file"'),
    {
        reason: "ambiguous_slug",
        // ⚠ WORDED TO THE CHARACTER, NOT TO TASTE. `dopl_kb`'s composed description
        // sits ~20 chars under the 2000 HARD ceiling with this row on it
        // (`tool-style.ts › composeDescription` throws at import, so the whole
        // package fails to load rather than shipping a truncated tool). A longer
        // meaning here is a build break, not a style note — measure, do not guess.
        meaning: "that slug names bases in 2+ containers",
        retry: "use the id",
    },
];
exports.SKILL_ERRORS = [
    notFound("skill_not_found", "active skill", 'op="list"'),
    versionConflict('op="read"'),
    {
        reason: "human_only_field",
        meaning: "`agent_write_enabled` is human-only, set in the app",
        retry: "no",
    },
];
/**
 * ⚠ **`bad_session_date` IS FIRST BECAUSE IT REPLACED A SCHEMA REGEX** (A14,
 * item 10). The published `pattern` failed as an opaque `-32602` naming neither
 * the field nor the format; a named code plus the example that works is the
 * whole reason the validator moved into the handler.
 */
exports.BAD_SESSION_DATE = {
    reason: "bad_session_date",
    meaning: "`session_date` must be a real calendar date, YYYY-MM-DD",
    retry: "pass YYYY-MM-DD",
};
exports.CHATS_ERRORS = [
    exports.BAD_SESSION_DATE,
    notFound("chat_not_found", "chat", 'op="list"'),
    {
        reason: "chat_outside_retention",
        meaning: "past the free plan's 90-day window; nothing was deleted",
        retry: "no",
    },
    {
        reason: "filed_chat_visibility",
        meaning: "a filed chat inherits its folder's sharing; set it there",
        retry: 'op="update_folder"',
    },
];
exports.MEMBERS_ERRORS = [
    notFound("member_not_found", "member", 'op="list"'),
    {
        reason: "admin_only",
        meaning: "another member's effective access is admin/owner-only",
        retry: "no",
    },
    notFound("team_not_found", "team", 'op="teams"'),
];
exports.ONTOLOGY_ERRORS = [
    notFound("object_not_found", "object", 'op="resolve"'),
    versionConflict('op="get"'),
    notFound("cluster_not_found", "ontology", 'op="map"'),
];
exports.AGENT_ERRORS = [
    notFound("identity_not_found", "identity", 'op="list"'),
    {
        reason: "ambiguous_name",
        meaning: "two identities share that name; both ids are in the message",
        retry: "no",
    },
    {
        reason: "confirm_required",
        meaning: "publishing into a peer's room previews first, returning a token",
        retry: "re-issue with confirm_token",
    },
];
/**
 * ⚠ THE THREE HERE ARE API CODES, VERBATIM. `channel-errors.ts` classifies them
 * off `DoplApiError.code` and the server also echoes its own message beside
 * them, so a paraphrase would put two spellings of one failure in front of the
 * agent in a single response.
 */
exports.CHANNEL_ERRORS = [
    {
        reason: "CHANNEL_FORBIDDEN",
        meaning: "not a member of that channel",
        retry: 'rooms action="list"',
    },
    {
        reason: "CHANNEL_RECIPIENT_UNRESOLVED",
        meaning: "`to` named nobody; nothing was sent",
        retry: 'rooms action="members"',
    },
    {
        reason: "VALIDATION_FAILED",
        meaning: "a field is over its cap, NOT a membership problem",
        retry: "no",
    },
];
exports.HOME_ERRORS = [
    {
        reason: "invite_is_app_only",
        meaning: "minting an invite link needs an interactive session",
        retry: "no",
    },
];
exports.SEARCH_ERRORS = [
    {
        reason: "partial_read",
        meaning: "a domain or scope did not answer, so this result is short",
        retry: 'the same call',
    },
    exports.CREDITS_EXHAUSTED,
];
/**
 * ⚠ **ONE ROW, AND `no_cursor` IS NOT THE SECOND.** It was drafted as one and
 * removed before it shipped: `since` omitted makes every unread count render
 * "no cursor" rather than 0, which is a RESULT the tool returns and not a
 * refusal any code path emits. Teaching it as `reason=no_cursor` would put a
 * literal in the description that never arrives on the wire — the exact break
 * this table exists to prevent, pointed the other way. The fact itself is where
 * it belongs: on `since`'s own `.describe()`.
 */
exports.STATUS_ERRORS = [exports.CREDITS_EXHAUSTED];
/**
 * ⚠ **`WORKSPACE_REQUIRED` AND `WORKSPACE_ERRORS` ARE DELETED (2026-09-02,
 * batch-3 integration).** B10 removed the default workspace and B14 removed the
 * refusal with it: `workspaces/server/service.ts › WorkspaceResolutionError` is
 * ONE CODE now — `WORKSPACE_INVALID`, *"you named something that is not a
 * workspace id"* — and naming NOTHING stopped being a question. **No server path
 * emits `WORKSPACE_REQUIRED`**, so the constant taught a refusal that could not
 * arrive, which is the exact break the error tables exist to prevent, pointed
 * the other way. `WORKSPACE_ERRORS` had lost its last consumer with `dopl_home`.
 */
