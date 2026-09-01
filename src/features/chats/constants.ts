import type { ChatSource, ExportFormat } from "./types";

export const SOURCE_LABELS: Record<ChatSource, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  codex: "Codex",
  cursor: "Cursor",
  other: "Agent",
};

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  summarized: "Summarized",
  verbatim: "Verbatim",
  mixed: "Mixed",
};

/**
 * Ceiling on ONE workspace's chat list (`server/repository.ts ›
 * listVisibleChats`).
 *
 * ⚠ THE READ WAS UNBOUNDED UNTIL 2026-09-01 — an archive that grows forever,
 * ordered `updated_at DESC`, with the full row (`overview`, `deliverables`,
 * `learnings` JSONB) per entry. INVARIANTS §9's "every whole-workspace list read
 * carries a `limit`, and a clipped read SAYS SO" is the rule it failed, and it
 * failed the SAYS-SO half more dangerously than the limit half: PostgREST
 * applies its own `max-rows` ceiling regardless, so the read was already being
 * clipped at a number no layer reported.
 *
 * ⚠ **THE CEILING BITES BEFORE THE VISIBILITY FILTER**, so a clipped page can
 * return fewer than this many chats. `truncated` therefore reports the RAW read
 * hitting the ceiling, never the post-filter length — a list that filters down
 * to nothing out of a full page is still clipped.
 *
 * ⚠ NOT DERIVED FROM A PRODUCTION MEASUREMENT. The number to check before
 * moving it is `SELECT workspace_id, count(*) FROM chats GROUP BY 1 ORDER BY 2
 * DESC`. 200 mirrors the channels feature's two list ceilings
 * (`CHANNEL_THREAD_LIST_LIMIT`) for the same reason: it is well past what any
 * reader scrolls in one sitting and well short of a payload that stalls a paint.
 *
 * ⚠ THE HEAVIER HALF OF DL-001 IS STILL OPEN — this list ships the full row,
 * JSONB included, where §9 wants a summary projection and the detail path
 * carrying the bodies. A `limit` bounds the blast radius; it does not make the
 * row lean. See docs/DATA-LOADING-AUDIT.md § DL-001.
 */
export const CHAT_LIST_LIMIT = 200;

export const UNFILED_LABEL = "Unfiled";

export const SHARED_WITH_ME_LABEL = "Shared with me";
