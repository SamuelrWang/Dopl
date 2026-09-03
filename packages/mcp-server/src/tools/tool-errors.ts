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

/**
 * ONE NAMED ERROR, AND THE THREE THINGS AN AGENT NEEDS ABOUT IT.
 *
 * ⚠ `reason` IS THE SERVER'S OWN LITERAL CODE AND IS NEVER PARAPHRASED. That
 * is the whole mechanism: the agent string-matches what came back on the wire
 * against what the description told it, so the two must be the same characters.
 * ⚠ `tool-style.test.ts › its Errors block quotes only literals from
 * tool-errors.ts` checks ONE direction — a description may teach only a code
 * this table declares. The other direction is held by CONSTRUCTION rather than
 * by a test: every refusal renders through {@link refusal}, so a renamed
 * `reason` moves the wire and the description together. Hand-writing a
 * `reason=` string anywhere else is the one way to break that.
 */
export interface ToolError {
  /** The literal `reason=` code, exactly as a refusal renders it. */
  reason: string;
  /** One line: what it means. Not what to do — that is `retry`. */
  meaning: string;
  /**
   * `"no"` when re-issuing the same call cannot help, else the op that produces
   * the missing input. ⚠ Slack's `channel_not_found` line is the model: naming
   * the remedy is what turns a dead end into one more call.
   */
  retry: string;
}

/**
 * THE REFUSAL LINE ITSELF — ⚠ the one renderer, so a refusal on the wire and
 * the description that predicts it are produced by the same code.
 *
 * ⚠ `reason=` FIRST, because it is the half a model can match on; the sentence
 * after it is for a human reading a transcript. `retry=` last and always
 * present: "do not retry with the same input" is a fact an agent otherwise has
 * to infer, and it infers it wrong under pressure.
 */
export function refusal(error: ToolError, detail = ""): string {
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
export const MISSING_PARAMS: ToolError = {
  reason: "missing_params",
  meaning: "a param this op needs is absent; the message names it",
  retry: "no",
};

export const WORKSPACE_REQUIRED: ToolError = {
  reason: "workspace_required",
  meaning: "no workspace resolved for this call",
  retry: "dopl_workspaces",
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

export const CREDITS_EXHAUSTED: ToolError = {
  reason: "credits_exhausted",
  meaning: "this workspace is out of MCP credits for this billing period",
  retry: "no",
};

/**
 * ⚠ THE OPTIMISTIC-CONCURRENCY REFUSAL, PARAMETERIZED BY ITS REMEDY. The code
 * is one fact — somebody else wrote after your read — but the op that produces
 * a fresh `expected_version` differs per tool, and a remedy naming the wrong op
 * is worse than none: it sends the agent to a call that cannot help and it will
 * make it twice.
 */
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
 * THE PER-TOOL TABLES. ⚠ Each is ordered by FREQUENCY, because
 * {@link renderErrors} pushes the first three and drops the rest — the order is
 * an editorial decision about which failure an agent is warned about, not a
 * list.
 */
/**
 * ⚠ **TWO ROWS, AND `entry_not_found` IS NOT THE THIRD.** It was drafted as one
 * and removed before it shipped: no code path emits that literal — a missing
 * PATH comes back through the same resolver that answers `base_not_found` — so
 * teaching it would promise an agent a string it can never match, which is the
 * break this whole table exists to prevent, pointed the other way. Where to
 * look when a path misses is `path`'s own `.describe()` and `op="list_dir"`.
 * ⚠ `MISSING_PARAMS` is not here either: it is raised by `respond.ts` for every
 * op on every tool, so pushing it into one description buys nothing an agent
 * could act on differently.
 */
export const KB_ERRORS: readonly ToolError[] = [
  notFound("base_not_found", "knowledge base", 'op="list_bases"'),
  versionConflict('op="read_file"'),
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

/**
 * ⚠ **`bad_session_date` IS FIRST BECAUSE IT REPLACED A SCHEMA REGEX** (A14,
 * item 10). The published `pattern` failed as an opaque `-32602` naming neither
 * the field nor the format; a named code plus the example that works is the
 * whole reason the validator moved into the handler.
 */
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
  notFound("cluster_not_found", "cluster", 'op="map"'),
];

export const AGENT_ERRORS: readonly ToolError[] = [
  notFound("template_not_found", "template", 'op="list"'),
  {
    reason: "ambiguous_name",
    meaning: "two templates share that name; both ids are in the message",
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

export const HOME_ERRORS: readonly ToolError[] = [
  {
    reason: "invite_is_app_only",
    meaning: "minting an invite link needs an interactive session",
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
  WORKSPACE_REQUIRED,
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
export const STATUS_ERRORS: readonly ToolError[] = [CREDITS_EXHAUSTED];

export const WORKSPACE_ERRORS: readonly ToolError[] = [WORKSPACE_REQUIRED];
