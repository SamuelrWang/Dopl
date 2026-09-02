"use strict";
/**
 * THE SESSION PROJECTION — what `dopl_channel(op="read_sessions")` and the Agents
 * tab see of a member's live agents.
 *
 * ⚠ **HAND-MAINTAINED MIRRORS of `src/features/channels/types-sessions.ts`**,
 * which is the original and carries the argument for every field; this package
 * cannot import that tree (INVARIANTS §13). The HEALTH seven are one more file
 * along (`session-health-types.ts`) and are pinned across four sites by
 * `scripts/check-session-health-drift.ts`.
 *
 * ⚠ **ITS OWN FILE (§1 split, 2026-09-02)** because `channel-types.ts` reached the
 * 500-line cap. The seam is real rather than arithmetic: this changes when the
 * session projection changes, and it is a different contract from a channel's.
 */
Object.defineProperty(exports, "__esModule", { value: true });
