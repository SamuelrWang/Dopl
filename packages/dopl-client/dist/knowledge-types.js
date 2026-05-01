"use strict";
/**
 * Domain types for the user's knowledge bases (Item 4).
 *
 * Mirrors `src/features/knowledge/types.ts` in the main app — kept in
 * sync by hand for now. If they ever drift, the API responses become
 * the source of truth.
 *
 * Distinct from `Pack`/`PackFile` types in this package: those are the
 * read-only Dopl knowledge packs (specialist verticals). These are the
 * user-authored, editable knowledge bases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
