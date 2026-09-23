"use strict";
/**
 * Named error → named remedy: the `reason=` codes an agent matches on, declared once. Every
 * advertised `reason=` must be one a refusal actually renders (string equality with the
 * description's Errors line, `tool-style.test.ts`); a code taught but never emitted is the defect
 * these tables prevent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_ERRORS = exports.SEARCH_ERRORS = exports.CHANNEL_ERRORS = exports.AGENT_ERRORS = exports.ONTOLOGY_ERRORS = exports.MEMBERS_ERRORS = exports.CHATS_ERRORS = exports.BAD_SESSION_DATE = exports.SKILL_ERRORS = exports.KB_ERRORS = exports.SESSION_REQUIRED = exports.KB_TARGET_VANISHED = exports.KB_ENTRY_NOT_FOUND = exports.KB_INVALID_FIELD = exports.CREDITS_EXHAUSTED = exports.AMBIGUOUS_CONTAINER = exports.DELETE_IS_APP_ONLY = exports.READ_ONLY_SESSION = exports.MISSING_PARAMS = void 0;
exports.refusal = refusal;
exports.versionConflict = versionConflict;
exports.fieldTooLong = fieldTooLong;
/** The one refusal renderer, so the wire and the description that predicts it cannot drift. */
function refusal(error, detail = "") {
    const tail = detail ? `. ${detail.trim()}` : "";
    return `reason=${error.reason} · ${error.meaning}${tail} · retry=${error.retry}`;
}
// Cross-cutting (gates, registrar): a tool's table names one only when it is in its own top three.
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
// `container=` slug naming 2+ visible rows; same literal as `KB_ERRORS`' row, one code (F-719).
exports.AMBIGUOUS_CONTAINER = {
    reason: "ambiguous_slug",
    meaning: "that slug names 2+ containers you can see",
    retry: "use the id",
};
exports.CREDITS_EXHAUSTED = {
    reason: "credits_exhausted",
    // Say credits, not MCP credits, and you, not this workspace (never pooled); no allowance numbers.
    meaning: "you are out of credits for this billing period",
    retry: "no",
};
/** HTTP 412; `retry` is the op that yields a fresh `expected_version`, which differs per tool. */
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
 * Emit-only (`dopl_kb` has no description headroom for a fourth row). Field and bound sit in
 * `meaning`, on the line an agent matches.
 */
function fieldTooLong(field, limit) {
    return {
        reason: "field_too_long",
        meaning: `field=${field} limit=${limit} — the value you sent is longer`,
        retry: "shorten that field and re-issue; nothing was written",
    };
}
/** Emit-only sibling of {@link fieldTooLong}; the rule differs per field, so it is in the detail. */
exports.KB_INVALID_FIELD = {
    reason: "invalid_field",
    meaning: "a field's value breaks its own rule; this line names which",
    retry: "fix that field and re-issue; nothing was written",
};
/**
 * Emit-only; maps 404 `KNOWLEDGE_ENTRY_NOT_FOUND`. "May have moved" is load-bearing: `write_file`
 * upserts, so re-writing at a vacated path creates a second entry.
 */
exports.KB_ENTRY_NOT_FOUND = {
    reason: "entry_not_found",
    meaning: "no entry at that path in that base; it may have moved or been renamed",
    retry: 'op="list_dir"',
};
/** Emit-only. `write_file` upserts, so `force=true` here would write a duplicate at that path. */
exports.KB_TARGET_VANISHED = {
    reason: "target_vanished",
    meaning: "the entry you meant to overwrite is not at that path any more",
    retry: 'op="list_dir" — NOT force=true, which would create a duplicate',
};
/** Emit-only. 403 `SESSION_REQUIRED` = an app-only route, not a grantable permission. */
exports.SESSION_REQUIRED = {
    reason: "session_required",
    meaning: "this op needs an interactive app session; MCP callers are refused",
    retry: "no",
};
// Per-tool tables, ordered by frequency: `renderErrors` teaches only the first three.
// `ambiguous_slug` must stay in `KB_ERRORS`' top three — a new row ahead of it silently drops it.
exports.KB_ERRORS = [
    notFound("base_not_found", "knowledge base", 'op="list_bases"'),
    versionConflict('op="read_file"'),
    {
        reason: "ambiguous_slug",
        // `dopl_kb` sits just under `HARD_DESCRIPTION_CEILING`, which throws at import; measure first.
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
// Validated in the handler, not a schema `pattern`, so the refusal names the field and format.
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
];
// API codes verbatim (`channel-errors.ts` classifies them; the server echoes its own message).
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
exports.SEARCH_ERRORS = [
    {
        reason: "partial_read",
        meaning: "a domain or scope did not answer, so this result is short",
        retry: 'the same call',
    },
    exports.CREDITS_EXHAUSTED,
];
// `no_cursor` is a rendered result, not a refusal — it must never be taught here.
exports.STATUS_ERRORS = [exports.CREDITS_EXHAUSTED];
