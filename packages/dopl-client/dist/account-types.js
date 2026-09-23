"use strict";
/**
 * Account-wide channel reads across every workspace and home-channel container. Hand-mirrors
 * `src/features/channels/server/service-account.ts` (no drift gate). `workspaceId` on every row is the
 * point: for a home channel it is the container id, published nowhere else (INVARIANTS §4A) — and
 * these rows are not a workspace listing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
