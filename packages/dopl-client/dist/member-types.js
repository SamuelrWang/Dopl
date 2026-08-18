"use strict";
/**
 * Members / teams / access types — read-only mirrors of
 * `src/features/members/types.ts` and `src/features/teams/types.ts`.
 *
 * ⚠ `resourceType` is a plain string on purpose: the grant table grows new
 * resource kinds and keeps retired ones, and a read client must render an
 * unknown kind, not reject it.
 */
Object.defineProperty(exports, "__esModule", { value: true });
