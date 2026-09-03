'use strict';

// THE CONTAINER-LOCKED CHILD CREDENTIAL, desktop half — layer B1 of the audience
// ceiling (plan §4.4, Samuel's RULING 4).
//
// 🔒 WHY A CREDENTIAL AND NOT A HEADER, RESTATED HERE BECAUSE THIS IS WHERE IT
// IS DECIDED. The other two layers of the ceiling are TRIPWIRES: the MCP
// directory lock (B3) narrows what `list_workspaces` and `workspace=` will do,
// and `session-profiles.js › grantDecision` step 1.5 (B2) narrows what this
// machine's gate will allow through. A `full` profile has Bash and the
// operator's 90-day device token is on disk, so an agent can step around both by
// issuing the loopback HTTP itself. What it CANNOT step around is which
// credential it holds: a token locked to one workspace is refused everywhere
// else by `with-workspace-auth.ts`, and everything the agent shells out to
// inherits the same token. The lock rides the credential.
//
// 🔒 WHAT THE MINT ACTUALLY BUYS, SINCE 2026-09-02 (wave B slice B3). The row it
// creates carries TWO INDEPENDENT AXES, not one lock with a kind bolted on:
//   container_id     WHICH container the session may act in. This is the fence.
//   subject_user_id  WHOSE reach it inherits — the OPERATOR's own id, because a
//                    session credential is one human's session, narrowed.
// Nothing on this side names either column: the desktop asks for a credential
// for `s.workspaceId` and the server decides both axes
// (`shared/auth/mcp-container-token.ts › issueContainerToken`). It is written
// here because the failure it prevents is invisible from here — a credential
// minted with a container and NO subject is the "shared key" case, and the
// operator's own agent would 404 on the operator's own private rows with
// nothing in this log saying why (F-336/F-333).
//
// ⚠ MINTED AT SPAWN, STAMPED ON THE SESSION, REVOKED AT SETTLE. It is stamped
// rather than fetched on demand for the reason `launchDepth` is: `buildSdkOptions`
// is SYNCHRONOUS and is re-entered by every spawn shape (fresh launch, parked
// resume, recreated shell, post-sign-in relaunch), so a value it needs must
// already be on the session object by then. That is also why the credential is
// NOT released on PARK — `session-park.js › resumeParked` re-enters
// `buildSdkOptions` with the same object, and a released credential would come
// back as a session that 401s on its first tool call with nothing to say why.
// Park keeps it; only `settle` gives it up. (The 24h TTL is the backstop for the
// case where `settle` never runs at all — a crash, a kill, a power cut.)

const { apiFetch } = require('./api');

const MINT_PATH = '/api/auth/mcp-container-token';
const MINT_TIMEOUT_MS = 8000;
// ⚠ Deliberately shorter than the mint's. Revocation runs inside `settle`, which
// is best-effort by construction and must never hold a teardown open — the TTL
// is the backstop if this call never lands.
const REVOKE_TIMEOUT_MS = 3000;

// ─── BEGIN SESSION-CREDENTIAL-PURE ─────────────────────────────────────────

/**
 * SHOULD this session's workspace get a locked credential?
 *
 * Exactly the condition layer A fences on, read from the desktop's own copy of
 * the workspace row: a `kind='link'` container that is NOT solo. A standard
 * workspace is untouched, and so is a SOLO container — that is the operator's
 * own primary agent surface, and there is no second audience in it to bound.
 *
 * 🔒 ⚠ AN ABSENT `memberCount` LOCKS. `?? 0`, and ZERO IS NOT SOLO. This is §8's
 * stale-cached-field rule applied in the INVERTED direction, deliberately: the
 * field is new on `GET /api/workspaces`, so a desktop running against a server
 * that predates it reads nothing — and the reflex fallback (treat unknown as the
 * permissive case) would silently unlock every container for exactly the release
 * window in which the two halves are out of step. Unknown = not solo = locked.
 * `factory.ts › bootServer` makes the same call for the same reason.
 *
 * ⚠ AN ABSENT `kind` READS AS STANDARD, which is the codebase's standing rule
 * (§4A, `isStandardWorkspace`'s positive spelling) and is the opposite default
 * from `memberCount`'s. The two are not inconsistent: an unknown KIND means this
 * is probably not a container at all, while an unknown COUNT is a real container
 * whose roster we could not read. Different questions, different safe answers.
 *
 * Pure — no I/O, no `require` beyond this file. `test/session-audience-ceiling.test.mjs`
 * drives it directly.
 */
function shouldLockSession(workspace) {
  if (!workspace || typeof workspace !== 'object') return false;
  if (workspace.kind !== 'link') return false;
  const members = typeof workspace.memberCount === 'number' ? workspace.memberCount : 0;
  return members !== 1;
}

// ─── END SESSION-CREDENTIAL-PURE ───────────────────────────────────────────

/**
 * The caller's workspace row, or null. One `GET /api/workspaces` — the same
 * UNFILTERED list `channel-listener.js` already fans over (§4A: that route
 * returns link containers on purpose, and must not be "fixed" to filter).
 */
async function findWorkspace(workspaceId) {
  if (!workspaceId) return null;
  try {
    const res = await apiFetch('/api/workspaces', { timeoutMs: MINT_TIMEOUT_MS });
    if (!res.ok) return null;
    const body = await res.json();
    const rows = Array.isArray(body && body.workspaces) ? body.workspaces : [];
    return rows.find((w) => w && w.id === workspaceId) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Mint and stamp, if this session's workspace calls for a lock. Idempotent per
 * session: a second call on an already-credentialled session is a no-op, so the
 * resume paths can call it without minting a second credential and orphaning the
 * first.
 *
 * ⚠ IT FAILS OPEN, AND THAT IS A DELIBERATE, NARROW CHOICE WITH A STATED
 * ARGUMENT. A mint that 500s, times out, or hits an older server leaves the
 * session running on the ordinary device token — i.e. as TRIPWIRE-ONLY, with
 * B3, B2 and layer A all still in force. Failing closed would mean refusing to
 * start the operator's agent because a credential endpoint was briefly down,
 * which trades a real, daily outage for a marginal gain over three surviving
 * layers — and layer A, the actual fence on the data, is server-side and
 * unaffected by anything that happens here. ⚠ It is logged every time, because
 * a fence that is silently absent is worse than one that is loudly absent.
 */
async function ensureContainerCredential(s, diag) {
  const log = typeof diag === 'function' ? diag : () => {};
  if (!s || s.containerToken) return s && s.containerToken ? s.containerToken : null;
  const workspace = await findWorkspace(s.workspaceId);
  if (!shouldLockSession(workspace)) return null;
  // 🔒 STAMP THE AUDIENCE BEFORE THE MINT, NOT AFTER — this is the input to B2's desktop belt
  // (`session-audience.js › containerOnlyDenies`, read by `session-io.js › grantArgs`), and the
  // two are INDEPENDENT layers that happen to share one workspace read. Stamping it after a
  // successful mint would disarm the belt on exactly the runs where the credential could not be
  // minted — i.e. wherever the fence is already weakest.
  s.audience = 'container-only';
  try {
    const res = await apiFetch(MINT_PATH, {
      method: 'POST',
      workspaceId: s.workspaceId,
      body: {},
      noStore: true,
      timeoutMs: MINT_TIMEOUT_MS,
    });
    if (!res.ok) {
      log('containerCredential: mint failed', res.status,
        '— this session runs on the device token, so the ceiling is TRIPWIRES ONLY for it');
      return null;
    }
    const body = await res.json();
    if (!body || typeof body.token !== 'string' || !body.token) {
      log('containerCredential: mint answered no token — running unlocked');
      return null;
    }
    s.containerToken = { token: body.token, tokenId: body.tokenId || null };
    log('containerCredential: session LOCKED to container', s.workspaceId);
    return s.containerToken;
  } catch (err) {
    log('containerCredential: mint threw —', (err && err.message) || err,
      '— running unlocked');
    return null;
  }
}

/**
 * Give the credential back. Best-effort in every direction: it never throws, it
 * never blocks teardown past its timeout, and it clears the session's stamp even
 * when the network call fails — because a stamp pointing at a credential we can
 * no longer revoke is worse than no stamp (the TTL will collect it).
 *
 * ⚠ `settle` is described in its own file as best-effort by construction: a disk
 * failure there must not leave a `claude` child un-aborted, and neither may a
 * network one. Everything here is inside a catch for that reason.
 */
async function releaseContainerCredential(s, diag) {
  const log = typeof diag === 'function' ? diag : () => {};
  const held = s && s.containerToken;
  if (!held) return 'none';
  s.containerToken = null;
  if (!held.tokenId) return 'none';
  try {
    const res = await apiFetch(MINT_PATH, {
      method: 'DELETE',
      body: { tokenId: held.tokenId },
      noStore: true,
      timeoutMs: REVOKE_TIMEOUT_MS,
    });
    if (!res.ok) {
      log('containerCredential: revoke failed', res.status, '— TTL will collect it');
      return 'failed';
    }
    const body = await res.json().catch(() => null);
    // ⚠ The route is IDEMPOTENT, so `res.ok` is not the answer — the `revoked`
    // COUNT is the discriminator, exactly as `mcp-config.js › revokeDeviceToken`
    // learned to read its own.
    return body && body.revoked > 0 ? 'revoked' : 'no-match';
  } catch (err) {
    log('containerCredential: revoke threw —', (err && err.message) || err);
    return 'failed';
  }
}

/** The bearer a spawn should present for this session, or '' for the default. */
function sessionBearer(s) {
  return s && s.containerToken && s.containerToken.token ? s.containerToken.token : '';
}

module.exports = {
  shouldLockSession,
  ensureContainerCredential,
  releaseContainerCredential,
  sessionBearer,
  MINT_PATH,
};
