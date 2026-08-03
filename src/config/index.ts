/**
 * Centralized constants shared across multiple files.
 *
 * Only values that are duplicated in 2+ files belong here.
 * Single-use constants stay co-located with their consumers.
 */

// ── Context budgets ─────────────────────────────────────────────────
export const CONTEXT_CHAR_BUDGET_PER_FIELD = 2000;

// ── Reserved workspace slugs ────────────────────────────────────────
// Workspace slugs share the URL root with every top-level static route.
// `slugifyWorkspaceName` consults this list and refuses any base slug
// that would collide; collisions get the numeric `-2`, `-3`, ... suffix
// the dedupe loop already applies for in-user collisions.
//
// Add any new top-level route directory here when you create it. Next.js
// resolves static segments before dynamic ones, so a collision wouldn't
// 500 — it would silently route to the static page and the workspace
// becomes unreachable. Cheaper to forbid the collision at creation time.
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "auth",
  "browse",
  "build",
  "canvas",
  "connect",
  "design",
  "docs",
  "e",
  // Static API route segments at /api/workspaces/<name> — a legacy
  // slug-only workspace URL with one of these names would be shadowed
  // by the static route (desktop migration review, 2026-08-02).
  "ensure-default",
  "resolve",
  "invite",
  "join",
  "login",
  "mcp",
  "oauth",
  "onboarding",
  "pricing",
  "privacy",
  "settings",
  // `signup` removed in audit fix S-13 — no top-level /signup route
  // exists. Re-add here if a public signup page lands.
  "terms",
  "welcome",
  "workspaces",
]);

// ── Descriptor convention ───────────────────────────────────────────
// Agent-facing descriptions (knowledge entries/folders, workflow
// clusters) are capped at 300 chars: long enough for a useful preview,
// short enough that the MCP listings they stream into stay lean.
export const DESCRIPTION_MAX = 300;

// Knowledge-base descriptions are the exception: one per base (they
// never fan out across tree listings), so they get the same 2000-char
// budget as workspace/skill descriptions. The server zod and the MCP
// dopl_kb tool copy both advertise 2000 — keep every editor on this
// constant so the layers can't drift again (F-038 follow-up 3).
export const KB_BASE_DESCRIPTION_MAX = 2000;
