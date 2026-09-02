"use strict";
/**
 * Domain types for the ACCOUNT-WIDE channel reads — one answer across every
 * workspace AND every home-channel container the caller belongs to.
 *
 * ⚠ Mirrors `src/features/channels/server/service-account.ts` — hand-synced,
 * like `home-types.ts` and `agent-template-types.ts`. No drift gate covers this
 * pair; both halves move in ONE change.
 *
 * 🔒 **`workspaceId` ON EVERY ROW IS THE POINT OF THESE TYPES.** A page that
 * spans tenancies is unusable without saying which tenancy each row came from —
 * it is the handle every other tool takes as `workspace=`, and for a home
 * channel it is the CONTAINER id, which no listing publishes (INVARIANTS §4A).
 *
 * ⚠ **THESE ARE NOT A WORKSPACE LISTING AND MUST NOT BE RENDERED AS ONE.** A row
 * whose `workspaceId` names a `kind='link'` container is a HOME CHANNEL to the
 * operator; a surface that calls it a workspace has advertised a container as a
 * tenancy, which §4A forbids everywhere.
 */
Object.defineProperty(exports, "__esModule", { value: true });
