import "server-only";

/**
 * WHAT KIND OF LOCK IS ON THIS CREDENTIAL — the axis `apiKeyWorkspaceId` was
 * answering BY ACCIDENT, and the one this module makes explicit (F-336 / F-333,
 * Samuel's ruling 2026-08-27).
 *
 * 🔒 THE TWO AXES, AND KEEPING THEM APART IS THE WHOLE POINT.
 *   - **WHICH WORKSPACE** a credential may act in — `mcp_tokens.workspace_id`,
 *     surfaced as `apiKeyWorkspaceId`, enforced by `with-workspace-auth.ts`'s
 *     403 and `workspaces/server/segment.ts › withinKeyLock`. That is layer B1
 *     of the audience ceiling (INVARIANTS §4/§10) and NOTHING here widens it.
 *   - **WHICH ROWS WITHIN THAT WORKSPACE** — visibility (`private` vs
 *     `public`/`workspace`) plus, for knowledge, layer A's grant fence
 *     (`knowledge/server/service-audience.ts › resolveAgentAudience`).
 *
 * ⚠ THE DEFECT THIS EXISTS TO FIX. Every M-10 predicate read
 * `if (ctx.apiKeyWorkspaceId) return false` — a WORKSPACE fence used as a
 * VISIBILITY fence. That rule was written for a credential with **no single
 * human behind it** (the dropped `api_keys` table's workspace-scoped key: a CI
 * runner, a service account, shared between teammates). B1's container-locked
 * child credential is the opposite kind of thing: minted for ONE desktop
 * session, carrying the OPERATOR's own user id and the operator's own proved
 * membership, then NARROWED to one workspace. Refusing it the operator's own
 * private rows hid the operator's notes from the operator's own agent and made
 * the `agent_only` grant switch decoration — RULING 2's remedy could never fire,
 * because the visibility gate had already answered 404.
 *
 * 🔒 SO THE PREDICATE IS "IS THERE A PERSON BEHIND THIS CREDENTIAL?", NOT "IS IT
 * LOCKED?". A locked credential whose kind says a single human is behind it
 * reads exactly what that human reads — and is still fenced to one workspace by
 * B1, and still fenced to the container's GRANTED bases by layer A. A locked
 * credential of any OTHER kind keeps the original refusal, verbatim.
 *
 * ⚠ AND IT FAILS CLOSED, WHICH IS THE HALF THAT MATTERS FOR THE NEXT PRODUCER.
 * "Locked, kind unknown" ⇒ SHARED ⇒ today's refusal. There is exactly one
 * producer of a lock in the tree (`mcp-container-token.ts › issueContainerToken`,
 * the sole writer of `mcp_tokens.workspace_id` — re-derive:
 * `grep -rn 'workspace_id' src/shared/auth src/features/playground/server`), so
 * this could have been written as "locked ⇒ container session" and would be true
 * today. It is NOT written that way on purpose: a shared workspace credential
 * reintroduced tomorrow would inherit the WIDER rule silently, and the whole
 * reason M-10 exists is that case. A new lock kind has to name itself here
 * before it reads anybody's private rows.
 */

/**
 * The one lock kind minted today: a per-session child credential the desktop
 * mints when it spawns a session into a `kind='link'` container that has a PEER
 * in it. Stored in `mcp_tokens.workspace_lock_kind`.
 *
 * ⚠ THE STRING IS THE CONTRACT — it is written by
 * `mcp-container-token.ts › issueContainerToken`, constrained by the migration's
 * CHECK, and read back by `mcp-token-validate.ts`. Changing it is a migration.
 */
export const CONTAINER_SESSION_LOCK = "container_session";

/** The two fields every caller context carries for this decision. Structural on
 *  purpose: five feature contexts implement it without importing each other. */
export interface LockedCredentialLike {
  /** The workspace this credential is fenced to; null/absent = not fenced. */
  apiKeyWorkspaceId?: string | null;
  /** `mcp_tokens.workspace_lock_kind`. ⚠ Absent/unknown reads as SHARED. */
  apiKeyWorkspaceLockKind?: string | null;
}

/**
 * Does this credential stand for NOBODY IN PARTICULAR — i.e. may it be shared
 * between humans, so that it inherits no one person's reach?
 *
 * THE M-10 PREDICATE, and the only one the visibility gates may ask. Arms:
 *   - no lock                       → false (an ordinary session / device token:
 *                                     it is a person, and always was)
 *   - locked, `container_session`   → false (ONE person's session, narrowed)
 *   - locked, anything else or none → TRUE  (the original refusal, unchanged)
 */
export function isSharedCredential(ctx: LockedCredentialLike): boolean {
  if (!ctx.apiKeyWorkspaceId) return false;
  return ctx.apiKeyWorkspaceLockKind !== CONTAINER_SESSION_LOCK;
}
