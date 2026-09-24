/**
 * Named error → named remedy: the `reason=` codes an agent matches on, declared once. Every
 * advertised `reason=` must be one a refusal actually renders (string equality with the
 * description's Errors line, `tool-style.test.ts`); a code taught but never emitted is the defect
 * these tables prevent.
 */

/** One named error. Render it only through {@link refusal}; never hand-write a `reason=` string. */
export interface ToolError {
  /** The literal wire code, never paraphrased. */
  reason: string;
  /** What it means (not what to do), without terminal punctuation. */
  meaning: string;
  /** `"no"` when re-issuing cannot help, else the op that produces the missing input. */
  retry: string;
}

/** The one refusal renderer, so the wire and the description that predicts it cannot drift. */
export function refusal(error: ToolError, detail = ""): string {
  const tail = detail ? `. ${detail.trim()}` : "";
  return `reason=${error.reason} · ${error.meaning}${tail} · retry=${error.retry}`;
}

// Cross-cutting (gates, registrar): a tool's table names one only when it is in its own top three.
export const MISSING_PARAMS: ToolError = {
  reason: "missing_params",
  meaning: "a param this op needs is absent; the message names it",
  retry: "no",
};

/** Emit-only: `respond.ts › unusedParams`. A param the op ignores is refused, never dropped. */
export const UNUSED_PARAM: ToolError = {
  reason: "unused_param",
  meaning: "a param this op does not take was sent; nothing was done",
  retry: "drop it and re-issue",
};

/** Emit-only: a channel rename/description write by a caller who cannot manage the room. */
export const CHANNEL_MANAGE_REQUIRED: ToolError = {
  reason: "manage_required",
  meaning: "renaming or describing a channel needs its owner or a workspace admin; nothing changed",
  retry: "no",
};

export const READ_ONLY_SESSION: ToolError = {
  reason: "read_only_session",
  meaning: "this session is read-only — its token has no `dopl.write` scope",
  retry: "no",
};

export const DELETE_IS_APP_ONLY: ToolError = {
  reason: "delete_is_app_only",
  meaning: "agents never delete over MCP",
  retry: "no",
};

// `container=` slug naming 2+ visible rows; same literal as `KB_ERRORS`' row, one code (F-719).
export const AMBIGUOUS_CONTAINER: ToolError = {
  reason: "ambiguous_slug",
  meaning: "that slug names 2+ containers you can see",
  retry: "use the id",
};

export const CREDITS_EXHAUSTED: ToolError = {
  reason: "credits_exhausted",
  // Say credits, not MCP credits, and you, not this workspace (never pooled); no allowance numbers.
  meaning: "you are out of credits for this billing period",
  retry: "no",
};

/** HTTP 412; `retry` is the op that yields a fresh `expected_version`, which differs per tool. */
export function versionConflict(readOp: string): ToolError {
  return {
    reason: "version_conflict",
    meaning: "somebody wrote after your read; `expected_version` is stale",
    retry: readOp,
  };
}

/** A "we looked and it is not here" refusal, pointed at the op that lists. */
function notFound(reason: string, noun: string, listOp: string): ToolError {
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
export function fieldTooLong(field: string, limit: number): ToolError {
  return {
    reason: "field_too_long",
    meaning: `field=${field} limit=${limit} — the value you sent is longer`,
    retry: "shorten that field and re-issue; nothing was written",
  };
}

/** Emit-only sibling of {@link fieldTooLong}; the rule differs per field, so it is in the detail. */
export const KB_INVALID_FIELD: ToolError = {
  reason: "invalid_field",
  meaning: "a field's value breaks its own rule; this line names which",
  retry: "fix that field and re-issue; nothing was written",
};

/**
 * Emit-only; maps 404 `KNOWLEDGE_ENTRY_NOT_FOUND`. "May have moved" is load-bearing: `write_file`
 * upserts, so re-writing at a vacated path creates a second entry.
 */
export const KB_ENTRY_NOT_FOUND: ToolError = {
  reason: "entry_not_found",
  meaning: "no entry at that path in that base; it may have moved or been renamed",
  retry: 'op="list_dir"',
};

/** Emit-only. `write_file` upserts, so `force=true` here would write a duplicate at that path. */
export const KB_TARGET_VANISHED: ToolError = {
  reason: "target_vanished",
  meaning: "the entry you meant to overwrite is not at that path any more",
  retry: 'op="list_dir" — NOT force=true, which would create a duplicate',
};

/** Emit-only. 403 `SESSION_REQUIRED` = an app-only route, not a grantable permission. */
export const SESSION_REQUIRED: ToolError = {
  reason: "session_required",
  meaning: "this op needs an interactive app session; MCP callers are refused",
  retry: "no",
};

// Per-tool tables, ordered by frequency: `renderErrors` teaches only the first three.
// `ambiguous_slug` must stay in `KB_ERRORS`' top three — a new row ahead of it silently drops it.
export const KB_ERRORS: readonly ToolError[] = [
  notFound("base_not_found", "knowledge base", 'op="list_bases"'),
  versionConflict('op="read_file"'),
  {
    reason: "ambiguous_slug",
    // `dopl_kb` sits just under `HARD_DESCRIPTION_CEILING`, which throws at import; measure first.
    meaning: "that slug names bases in 2+ containers",
    retry: "use the id",
  },
];

export const SKILL_ERRORS: readonly ToolError[] = [
  notFound("skill_not_found", "active skill", 'op="list"'),
  versionConflict('op="read"'),
  {
    reason: "human_only_field",
    meaning: "`agent_write_enabled` is human-only, set in the app",
    retry: "no",
  },
];

// Validated in the handler, not a schema `pattern`, so the refusal names the field and format.
export const BAD_SESSION_DATE: ToolError = {
  reason: "bad_session_date",
  meaning: "`session_date` must be a real calendar date, YYYY-MM-DD",
  retry: "pass YYYY-MM-DD",
};

export const CHATS_ERRORS: readonly ToolError[] = [
  BAD_SESSION_DATE,
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

export const MEMBERS_ERRORS: readonly ToolError[] = [
  notFound("member_not_found", "member", 'op="list"'),
  {
    reason: "admin_only",
    meaning: "another member's effective access is admin/owner-only",
    retry: "no",
  },
  notFound("team_not_found", "team", 'op="teams"'),
];

export const ONTOLOGY_ERRORS: readonly ToolError[] = [
  notFound("object_not_found", "object", 'op="resolve"'),
  versionConflict('op="get"'),
  notFound("ontology_not_found", "ontology", 'op="map"'),
];

export const AGENT_ERRORS: readonly ToolError[] = [
  notFound("identity_not_found", "identity", 'op="list"'),
  {
    reason: "ambiguous_name",
    meaning: "two identities share that name; both ids are in the message",
    retry: "no",
  },
];

// API codes verbatim (`channel-errors.ts` classifies them; the server echoes its own message).
export const CHANNEL_ERRORS: readonly ToolError[] = [
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

export const SEARCH_ERRORS: readonly ToolError[] = [
  {
    reason: "partial_read",
    meaning: "a domain or scope did not answer, so this result is short",
    retry: 'the same call',
  },
  CREDITS_EXHAUSTED,
];

// `no_cursor` is a rendered result, not a refusal — it must never be taught here.
export const STATUS_ERRORS: readonly ToolError[] = [CREDITS_EXHAUSTED];
