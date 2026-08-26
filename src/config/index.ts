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
  // The one auth page (`src/app/(auth)/authenticate/page.tsx`, 2026-08-16);
  // `/login` and `/signup` 307 to it and stay reserved below for the same
  // shadowing reason.
  "authenticate",
  "browse",
  "build",
  // Guest web channel (2026-08-25): `/c/{workspaceId}` is a top-level route.
  // A workspace slugged "c" would carry its legacy URLs at `/c/{page}`, where
  // the new route's dynamic segment answers first — the same silent shadowing
  // that reserves "link", "join" and "invite" below.
  "c",
  "canvas",
  "connect",
  "design",
  "docs",
  // `/download` (the dmg redirect) and `/get-started` (the post-auth download
  // page) are both top-level routes; a workspace slugged either name would be
  // silently shadowed by them.
  "download",
  "e",
  "get-started",
  // Static API route segments at /api/workspaces/<name> — a legacy
  // slug-only workspace URL with one of these names would be shadowed
  // by the static route (desktop migration review, 2026-08-02).
  "ensure-default",
  "resolve",
  "invite",
  "join",
  // Home-channel claim links (2026-08-23): `/link/{token}` is a top-level
  // route, and `/link/` is already in `shared/auth/public-routes.ts ›
  // PUBLIC_ROUTES`. A workspace slugged "link" would be silently shadowed by
  // it, exactly as one slugged "join" would.
  "link",
  "login",
  "mcp",
  "oauth",
  "onboarding",
  "pricing",
  "privacy",
  "settings",
  // Re-added 2026-08-13, on the condition S-13 set when it removed this: the
  // public signup page landed (`src/app/(auth)/signup/page.tsx`), so a workspace
  // slugged "signup" would now be silently shadowed by it.
  "signup",
  "terms",
  "welcome",
  "workspaces",
]);

// ── Descriptor convention ───────────────────────────────────────────
// Agent-facing descriptions (knowledge entries/folders, ontology
// clusters) are capped at 300 chars: long enough for a useful preview,
// short enough that the MCP listings they stream into stay lean.
export const DESCRIPTION_MAX = 300;

// Knowledge-base descriptions are the exception: one per base (they
// never fan out across tree listings), so they get the same 2000-char
// budget as workspace/skill descriptions. The server zod and the MCP
// dopl_kb tool copy both advertise 2000 — keep every editor on this
// constant so the layers can't drift again (F-038 follow-up 3).
export const KB_BASE_DESCRIPTION_MAX = 2000;
