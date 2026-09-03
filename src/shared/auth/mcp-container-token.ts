import "server-only";
import {
  ACCESS_PREFIX,
  MCP_SCOPES,
  randToken,
  sha256,
} from "@/shared/auth/mcp-oauth";
import { CONTAINER_SESSION_LOCK } from "@/shared/auth/credential-audience";
import {
  DEVICE_CLIENT_ID,
  DEVICE_CLIENT_NAME,
} from "@/shared/auth/mcp-credential";
import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * THE CONTAINER-LOCKED CHILD CREDENTIAL — layer B1 of the audience ceiling
 * (plan §4.4, Samuel's RULING 4), and the only part of the ceiling that binds
 * something the agent's own PROCESS cannot step around.
 *
 * 🔒 WHY THE CREDENTIAL AND NOT A HEADER. `X-Workspace-Id`, `X-Dopl-Runtime`
 * and `X-Dopl-Session-Id` are documented NON-authorization signals: a `full`
 * profile has Bash and the operator's 90-day device token is on disk, so an
 * agent can issue any loopback HTTP the operator could, with any headers it
 * likes. That is why the MCP directory lock (B3) and the desktop grant gate
 * (B2) are TRIPWIRES — they narrow one path each. A lock on the TOKEN ROW is
 * different in kind: whatever the agent does, and whatever it shells out to, all
 * of it can only present the credential it was handed. **The fence rides the
 * credential.**
 *
 * ⚠ THAT SENTENCE ENDED *"and that credential cannot name another workspace"*
 * UNTIL 2026-08-26, AND IT WAS TRUE OF ONE OF THE TWO AUTH FAMILIES. The lock is
 * enforced by `with-workspace-auth.ts` (403 `API_KEY_WORKSPACE_MISMATCH`); the
 * OTHER family — `withUserAuth` + `workspaces/server/segment.ts ›
 * resolveApiWorkspace` — had ZERO references to `apiKeyWorkspaceId`, so a locked
 * credential could `POST /api/boot` with no segment to learn the operator's home
 * workspace id and canonical segment, then reach the 19 route files under
 * `/api/workspaces/[workspaceSlug]/**`. The comparison now lives in
 * `resolveWorkspaceSegmentForUser` as well, beside the role floor the guest wave
 * put there for the same reason, and
 * `workspaces/server/api-workspace-floor.test.ts` scans the family so a route
 * that forgets to thread it cannot ship quietly. **A property that holds in one
 * wrapper is not a property of the credential** — that is the general lesson,
 * and it is why this paragraph stays after the fix.
 *
 * ⚠ A CHILD CREDENTIAL IS NEVER MORE THAN ITS PARENT. It is minted for the
 * CALLER's own user id, under the caller's own membership, with the same scopes
 * a device token carries — and then NARROWED to one workspace. There is no
 * input to this module that widens anything; the worst a misuse achieves is a
 * credential that can do less than the one the caller already holds.
 *
 * 🔒 ⚠ THE ROW CARRIES TWO INDEPENDENT AXES SINCE 2026-09-02
 * (`20260917120000_mcp_token_credential_axes`): `container_id` says WHICH
 * container this credential may act in, `subject_user_id` says WHOSE reach it
 * inherits. This minter sets both, because a container session is BOTH fenced
 * AND personal — and the two used to be one field, which is the defect the next
 * paragraph records.
 *
 * 🔒 ⚠ IT LIT UP THE M-10 VISIBILITY GATES TOO UNTIL 2026-08-27, AND THAT WAS
 * THE DEFECT F-336/F-333 RECORD. This paragraph used to argue that a credential
 * existing BECAUSE a peer is in the room is "a key shared between humans", so
 * `knowledge/server/service-shared.ts › canSeeBase` and its four siblings were
 * right to refuse it every PRIVATE row — the caller's own included. **It is not
 * that kind of credential.** It is minted for ONE session, carries the
 * OPERATOR's user id and the operator's own proved membership, and is then
 * narrowed; a shared workspace key stands for nobody in particular. Reading the
 * lock as a VISIBILITY answer hid the operator's notes from the operator's own
 * agent AND made the `agent_only` grant unreachable — the visibility gate 404'd
 * before layer A's grant row was ever consulted, so RULING 2's remedy could not
 * fire. `workspace_lock_kind` is the fix: this row says which kind it is, and
 * `credential-audience.ts › isSharedCredential` is the one predicate that reads
 * it. **The workspace lock itself is untouched** — B1 is still the fence, still
 * 403s a contradicting target in both auth families, and layer A still refuses
 * every base the operator did not grant into the container.
 *
 * ⚠ LIVES HERE RATHER THAN IN `mcp-oauth.ts` for the reason
 * `features/playground/server/token.ts` gives: that file sits against the
 * 500-line cap. The hash/rand/prefix primitives are imported FROM it, so the row
 * stays `validateAccessToken`-compatible by construction.
 */

/**
 * Child-credential TTL — a BACKSTOP, not the lifetime. The desktop revokes at
 * session end (`session-teardown.js › settle`); this is what expires the row
 * when the desktop never gets to, because it crashed, lost power, or was killed.
 *
 * ⚠ It must comfortably outlast a session, or a long-running agent loses its
 * credential mid-turn and every subsequent tool call 401s with nothing to say
 * why. A session's own ceiling is the 12h abandonment bound (§11), so this is
 * twice that.
 */
export const CONTAINER_TOKEN_TTL_S = 60 * 60 * 24;

/**
 * The label these rows carry in "Connected apps" and in the identity surfaces.
 *
 * ⚠ A FIXED CONSTANT, NEVER THE CONTAINER'S NAME OR SLUG. `client_name` is
 * rendered into identity copy (§10), and a container's name is member-typed text
 * belonging to a private relationship — putting it in a credential label would
 * leak a room's name into every surface that lists credentials. The workspace it
 * is locked to is already on the row, as a uuid, where the fence reads it.
 *
 * ⚠ DISTINCT FROM `DEVICE_CLIENT_NAME`, and that matters mechanically:
 * `mcp-oauth.ts › issueDeviceToken` revoke-and-replaces on
 * `(user_id, client_id, client_name)`, so a device-token re-mint must not sweep
 * away the live container credentials beside it.
 */
export const CONTAINER_CLIENT_NAME = "Dopl Desktop (container session)";

export interface ContainerToken {
  token: string;
  tokenId: string;
  expiresAt: string;
}

/**
 * Mint a credential that may act in `workspaceId` and in NO other workspace.
 *
 * ⚠ THE CALLER MUST HAVE PROVED MEMBERSHIP ALREADY. This function does not
 * check it, and the route that calls it resolves the workspace through
 * `withWorkspaceAuth` (which proves an active membership) before it gets here.
 * That is not a hole: a lock only ever REMOVES reach, so a token naming a
 * workspace the user is not in would be a token that can do nothing at all —
 * membership is still required on every request the credential makes. The
 * membership proof is at the route because a useless credential is a confusing
 * failure, not because it would be a dangerous one.
 *
 * ⚠ NO REFRESH TOKEN, deliberately. A child credential is not renewed: it dies
 * with its session or it expires. A refresh token would outlive both and would
 * be one more thing to revoke.
 *
 * ⚠ Returns the token ONCE — only the hash is stored — plus its `tokenId`, which
 * is what the desktop keeps so it can revoke exactly this row at session end
 * without a label match.
 */
export async function issueContainerToken(input: {
  userId: string;
  workspaceId: string;
}): Promise<ContainerToken> {
  const db = supabaseAdmin();
  // `mcp_tokens.client_id` is a NOT NULL FK to `oauth_clients` — the reserved
  // device client row must exist first (`ensureDeviceClient`'s pattern). These
  // rows sit under the DEVICE client on purpose: `describeCredential` keys on
  // `client_id` (§10), and `kind: "device"` is the truthful classification for
  // a credential a desktop minted for a session it is about to run.
  const { error: clientError } = await db.from("oauth_clients").upsert(
    {
      client_id: DEVICE_CLIENT_ID,
      client_name: DEVICE_CLIENT_NAME,
      redirect_uris: [],
    },
    { onConflict: "client_id", ignoreDuplicates: true },
  );
  if (clientError) throw clientError;

  const accessToken = randToken(ACCESS_PREFIX);
  const expiresAt = new Date(
    Date.now() + CONTAINER_TOKEN_TTL_S * 1000,
  ).toISOString();
  const { data, error } = await db
    .from("mcp_tokens")
    .insert({
      user_id: input.userId,
      client_id: DEVICE_CLIENT_ID,
      access_token_hash: sha256(accessToken),
      refresh_token_hash: null,
      scopes: [...MCP_SCOPES],
      access_expires_at: expiresAt,
      refresh_expires_at: null,
      client_name: CONTAINER_CLIENT_NAME,
      // 🔒 AXIS 1 — WHICH CONTAINER. Everything else on this row is an
      // ordinary device token.
      container_id: input.workspaceId,
      // 🔒 AXIS 2 — WHOSE REACH. The OPERATOR's own id, because that is what
      // this credential is: one human's session, narrowed. Leaving it null
      // would make the row a SHARED container credential and the operator's own
      // agent would 404 on the operator's own private rows, grant or no grant
      // (F-336/F-333). ⚠ It may only ever be `user_id` — the migration's
      // `mcp_tokens_subject_is_owner_check` makes anything else unstorable.
      subject_user_id: input.userId,
      // ⚠ DUAL-WRITTEN FOR ONE RELEASE, AND THE PAIR IS PINNED BY
      // `mcp_tokens_axes_agree_check`: an older app instance still reading the
      // legacy pair must see the same two facts. B13 deletes these two lines
      // with the columns.
      workspace_id: input.workspaceId,
      workspace_lock_kind: CONTAINER_SESSION_LOCK,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { token: accessToken, tokenId: (data as { id: string }).id, expiresAt };
}

/**
 * Revoke container-locked credentials. Returns how many rows this call actually
 * stamped.
 *
 * ⚠ ALWAYS SCOPED TO `userId`, whichever selector is used — the caller may only
 * revoke its own credentials, exactly as `revokeDeviceTokens` insists.
 *
 * ⚠ `workspace_id IS NOT NULL` IS ON EVERY BRANCH, and it is a guard rather than
 * a filter: without it a `{ userId }`-only call would sweep away the operator's
 * 90-day DEVICE token as well, which is the credential every other session on
 * that machine depends on. This function may only ever touch child credentials.
 *
 * ⚠ Idempotent. Revoking an unknown or already-revoked token is a quiet `0`, not
 * an error — session teardown is best-effort by construction (`settle`'s own
 * discipline) and must never throw on a second pass.
 */
export async function revokeContainerTokens(input: {
  userId: string;
  tokenId?: string;
  workspaceId?: string;
}): Promise<number> {
  const db = supabaseAdmin();
  let query = db
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    // ⚠ STILL THE LEGACY COLUMN, DELIBERATELY, UNTIL B13. It is dual-written
    // and `mcp_tokens_axes_agree_check` keeps it equal to `container_id`, so it
    // selects the same rows — and unlike `container_id` it is present on a
    // database this wave's migration has not reached, where a filter naming a
    // missing column would make teardown revoke NOTHING and silently strand
    // every child credential until its TTL.
    .not("workspace_id", "is", null)
    .is("revoked_at", null);
  if (input.tokenId) query = query.eq("id", input.tokenId);
  if (input.workspaceId) query = query.eq("workspace_id", input.workspaceId);
  const { data, error } = await query.select("id");
  if (error) throw error;
  return (data ?? []).length;
}
