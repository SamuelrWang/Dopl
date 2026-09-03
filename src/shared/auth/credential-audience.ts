import "server-only";

/**
 * WHOSE REACH DOES THIS CREDENTIAL INHERIT — one of the TWO axes a credential
 * carries, and the one every M-10 visibility gate means to ask about.
 *
 * 🔒 THE TWO AXES, AND KEEPING THEM APART IS THE WHOLE POINT.
 *   - **WHICH CONTAINER** a credential may act in — `mcp_tokens.container_id`,
 *     surfaced as `apiKeyWorkspaceId`, enforced by `with-workspace-auth.ts`'s
 *     403 and `workspaces/server/segment.ts › withinKeyLock`. That is layer B1
 *     of the audience ceiling (INVARIANTS §4/§10) and NOTHING here widens it.
 *   - **WHOSE REACH** it inherits — `mcp_tokens.subject_user_id`, surfaced as
 *     {@link CredentialAxes.credentialSubjectUserId} and read ONLY through
 *     {@link isSharedCredential}. Combined, for knowledge, with layer A's grant
 *     fence (`knowledge/server/service-audience.ts › resolveAgentAudience`).
 *
 * ⚠ THE DEFECT THIS EXISTS TO FIX, AND ITS SECOND HALF. Every M-10 predicate
 * read `if (ctx.apiKeyWorkspaceId) return false` — a CONTAINER fence used as an
 * AUDIENCE fence (F-336/F-333). That rule was written for a credential with **no
 * single human behind it** (the dropped `api_keys` table's workspace-scoped key:
 * a CI runner, a service account, shared between teammates); B1's container
 * child credential is the opposite kind of thing, so refusing it the operator's
 * own private rows hid the operator's notes from the operator's own agent and
 * made the `agent_only` grant switch decoration. The 2026-08-27 fix added
 * `workspace_lock_kind` and asked a THREE-ARM question over the PAIR. That still
 * inferred a person from a lock: the fact the predicate wants was nowhere on the
 * row. **The row now states it** (`20260917120000_mcp_token_credential_axes`),
 * and the predicate is a null check.
 *
 * 🔒 SO THE QUESTION IS "IS THERE A PERSON BEHIND THIS CREDENTIAL?", AND IT NO
 * LONGER PASSES THROUGH "IS IT LOCKED?". The two axes are independent: a
 * credential may be fenced and personal (a container session — it reads that
 * one human's rows, still fenced to one container by B1 and to the container's
 * GRANTED bases by layer A), fenced and anonymous (a shared container key —
 * denied every private row), or unfenced and personal (an ordinary device
 * token).
 *
 * ⚠ AND IT STILL FAILS CLOSED, WHICH IS THE HALF THAT MATTERS FOR THE NEXT
 * PRODUCER. NULL = "nobody in particular" = today's refusal, so a credential
 * minted tomorrow that forgets to name its subject inherits nobody's reach
 * rather than the minter's. ⚠ THE FIELD IS REQUIRED, NOT OPTIONAL, ON PURPOSE:
 * this is the axis whose ABSENCE used to widen (`channels/server/service-shared.ts`
 * carried a docblock about exactly that), so every context that reaches a
 * visibility gate must STATE it and the typechecker is what collects them.
 */

/**
 * The one legacy lock kind, still dual-written by
 * `mcp-container-token.ts › issueContainerToken` and still the fallback
 * `mcp-access-token.ts › validateAccessToken` derives a subject from while
 * `mcp_tokens.workspace_lock_kind` exists.
 *
 * ⚠ RETIRES WITH THAT COLUMN, IN B13 — it is no longer read by any predicate.
 * Nothing may add a second value: a new kind of credential states its SUBJECT,
 * it does not name itself here.
 */
export const CONTAINER_SESSION_LOCK = "container_session";

/**
 * The audience axis every caller context carries. Structural on purpose: five
 * feature contexts implement it without importing each other.
 */
export interface CredentialAxes {
  /**
   * `mcp_tokens.subject_user_id` — the ONE human this credential acts as, or
   * `null` for a credential that may be passed between humans.
   *
   * ⚠ REQUIRED. A context that cannot say whose reach it carries has not
   * answered the question, and the answer must never be inferred from the
   * container axis (that inference is F-336).
   */
  credentialSubjectUserId: string | null;
}

/**
 * Does this credential stand for NOBODY IN PARTICULAR — i.e. may it be passed
 * between humans, so that it inherits no one person's reach?
 *
 * THE M-10 PREDICATE, and the only one the visibility gates may ask. ⚠ Falsy
 * rather than `=== null` deliberately: an absent or blank subject reaching this
 * from an untyped edge (a `.mjs` desktop test, a hand-built fixture) is "nobody
 * in particular" too, and that is the fail-closed reading.
 */
export function isSharedCredential(ctx: CredentialAxes): boolean {
  return !ctx.credentialSubjectUserId;
}
