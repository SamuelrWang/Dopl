/**
 * Centralized constants shared across multiple files.
 *
 * Only values that are duplicated in 2+ files belong here.
 * Single-use constants stay co-located with their consumers.
 */

// ── Ingestion limits ────────────────────────────────────────────────
export const MAX_LINK_DEPTH = parseInt(process.env.MAX_LINK_DEPTH || "3", 10);
export const MAX_CONTENT_FOR_CLAUDE = 100_000;
export const MAX_IMAGES_PER_ENTRY = 20;
export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

// ── Auth ────────────────────────────────────────────────────────────
export const API_KEY_PREFIX = "sk-sie-";

// ── Context budgets ─────────────────────────────────────────────────
export const CONTEXT_CHAR_BUDGET_PER_FIELD = 2000;

// ── Subscription / billing ──────────────────────────────────────────
export const FREE_INGESTION_LIMIT = 5;
export const CONTENT_PREVIEW_LENGTH = 500;

// ── Canvas storage keys ─────────────────────────────────────────────
export const CANVAS_STORAGE_KEY_PREFIX = "sie:canvas:state";
export const CANVAS_ACTIVE_USER_KEY = "sie:canvas:active-user";
