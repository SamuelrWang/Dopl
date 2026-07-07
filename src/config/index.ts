/**
 * Centralized constants shared across multiple files.
 *
 * Only values that are duplicated in 2+ files belong here.
 * Single-use constants stay co-located with their consumers.
 */

// ── Context budgets ─────────────────────────────────────────────────
export const CONTEXT_CHAR_BUDGET_PER_FIELD = 2000;

// ── Canvas storage keys ─────────────────────────────────────────────
export const CANVAS_STORAGE_KEY_PREFIX = "dopl:canvas:state";
export const CANVAS_ACTIVE_USER_KEY = "dopl:canvas:active-user";

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
  "invite",
  "login",
  "mcp",
  "oauth",
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
// Agent-facing descriptions (knowledge entries/folders/bases, workflow
// clusters) are capped at 300 chars: long enough for a useful preview,
// short enough that the MCP listings they stream into stay lean.
export const DESCRIPTION_MAX = 300;
