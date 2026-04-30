/**
 * Centralized constants shared across multiple files.
 *
 * Only values that are duplicated in 2+ files belong here.
 * Single-use constants stay co-located with their consumers.
 */

// ── Ingestion limits ────────────────────────────────────────────────
export const MAX_LINK_DEPTH = parseInt(process.env.MAX_LINK_DEPTH || "3", 10);
export const MAX_CONTENT_FOR_CLAUDE = 100_000;
// Ceiling on the `gathered_content` string returned by /api/ingest/prepare.
// Depth-0 sources (primary README / extracted text) are always kept; higher-
// depth followed-link sources are dropped from the tail once the budget is hit.
// 300K keeps a 200K-context agent comfortable with room for prompts + system.
export const GATHERED_CONTENT_MAX = 300_000;
export const MAX_IMAGES_PER_ENTRY = 20;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ── Chat attachment limits ──────────────────────────────────────────
export const MAX_CHAT_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10MB per file
export const MAX_CHAT_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_CHAT_MESSAGE_SIZE = 25 * 1024 * 1024; // 25MB total per send
export const ALLOWED_CHAT_ATTACHMENT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
] as const;

// ── Auth ────────────────────────────────────────────────────────────
export const API_KEY_PREFIX = "sk-dopl-";

// ── Context budgets ─────────────────────────────────────────────────
export const CONTEXT_CHAR_BUDGET_PER_FIELD = 2000;

// ── Subscription / billing ──────────────────────────────────────────
export const FREE_INGESTION_LIMIT = 5;
export const CONTENT_PREVIEW_LENGTH = 500;

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
  "community",
  "design",
  "docs",
  "e",
  "entries",
  "invite",
  "login",
  "pricing",
  "privacy",
  "settings",
  "signup",
  "terms",
  "welcome",
  "workspaces",
]);
