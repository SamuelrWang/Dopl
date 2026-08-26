'use strict';

// session-audience.js — THE AUDIENCE CEILING'S DESKTOP BELT (plan §4.4 B2).
//
// ⚠ SPLIT OUT OF `main/session-profiles.js` (2026-08-26) under the hard 500-line cap, which that
// file was sitting exactly on. §1's rule applied literally: a file at the cap does not merely stop
// growing, it stops being CORRECTABLE — and this is a new REASON TO CHANGE for the gate rather
// than another line of an existing one. `session-own-outbound.js` and `session-own-launch.js` came
// off the same file for the same reason.
//
// WHAT IT DECIDES: an agent whose session is CONTAINER-ONLY — spawned into a `kind='link'`
// container that has a PEER in it — asked a dopl tool to act in a DIFFERENT workspace. This
// machine refuses to hand that call to the server.
//
// 🔒 IT IS A TRIPWIRE AND IT MUST NEVER BE DESCRIBED AS ANYTHING ELSE. It narrows what THIS
// machine's permission gate will pass. A `full` profile has Bash and the operator's 90-day device
// token is on disk, so an agent can issue the same call as plain HTTP and never come near
// `canUseTool`. The FENCES are elsewhere and both are outside this process: the container-locked
// CREDENTIAL (`session-credential.js` → `with-workspace-auth.ts`, which 403s a contradicting
// target) and the server-side AUDIENCE CEILING
// (`src/features/knowledge/server/service-audience.ts`, which 404s an ungranted base from DB
// facts alone). This belt exists so a well-behaved agent is stopped early and the operator can
// SEE it being stopped — `gateReason` gives the refusal a name — not because it contains anything.
//
// ⚠ WHY IT IS STEP 1.5 — AFTER THE HARD DENY, BEFORE EVERYTHING ELSE. Before `preApproved`,
// because a pre-approved tool is SHADOWED by the SDK's `allowedTools` and never reaches
// `canUseTool` at all, so a check placed after it would silently skip `dopl_search` and every
// other read on the pre-approved list. After the hard deny, because a hard-denied name must keep
// its own explanation: the two refusals are different sentences and an operator who cannot tell
// them apart cannot act on either.

// ─── BEGIN SESSION-AUDIENCE-PURE ───────────────────────────────────────────

/**
 * Is this call a dopl tool addressed at a workspace OTHER than the session's container?
 *
 * ⚠ FAIL-OPEN ON EVERYTHING IT CANNOT READ, and that is correct for a TRIPWIRE specifically.
 * No audience, a non-dopl tool, no `workspace` argument, a non-string one — all answer `false`
 * and fall through to the ordinary gate. A belt that guessed would deny calls the operator
 * expects to work, and it is not the thing standing between an agent and another workspace: the
 * credential is. ⚠ Do NOT "harden" this into a fail-closed check without moving the fence first;
 * that trade buys nothing and breaks the daily path.
 *
 * ⚠ AN ABSENT `workspace` ARG IS NOT A CROSS-WORKSPACE CALL. It means "the session default",
 * which under a locked credential IS the container — the server resolves it, and the MCP
 * directory lock (B3) has already stopped `list_workspaces` naming anything else.
 *
 * Pure: no I/O, no require, no `process`. `test/session-audience-ceiling.test.mjs` drives it and
 * the REAL `grantDecision` that calls it.
 */
function containerOnlyDenies(args, isDoplTool) {
  const a = args || {};
  if (a.audience !== 'container-only') return false;
  if (typeof isDoplTool === 'function' && !isDoplTool(a.toolName)) return false;
  const input = a.input;
  if (!input || typeof input !== 'object') return false;
  const asked = input.workspace;
  if (typeof asked !== 'string' || !asked.trim()) return false;
  const container = typeof a.workspaceId === 'string' ? a.workspaceId.trim() : '';
  if (!container) return false;
  return asked.trim() !== container;
}

/**
 * The audience a session runs under, from the roster the desktop already holds.
 *
 * `'container-only'` when the session's workspace is a link container with a PEER in it, and
 * `null` otherwise — a standard workspace, or a SOLO container, which is the operator's own
 * primary agent surface and is deliberately untouched by every layer of the ceiling.
 *
 * 🔒 ⚠ AN ABSENT `memberCount` READS AS CONTAINER-ONLY. `?? 0`, and ZERO IS NOT SOLO — §8's
 * stale-cached-field rule applied INVERTED, exactly as `session-credential.js ›
 * shouldLockSession` and `factory.ts › bootServer` apply it, and for the same reason: the field
 * is new on `GET /api/workspaces`, and the reflex fallback would quietly disarm the belt for the
 * whole release window in which a desktop runs against a server that predates it.
 *
 * ⚠ An absent `kind` reads as STANDARD (§4A's positive predicate), the opposite default. The two
 * are answers to different questions: an unknown KIND means probably not a container at all, an
 * unknown COUNT means a real container whose roster we could not read.
 */
function audienceFor(workspace) {
  if (!workspace || typeof workspace !== 'object') return null;
  if (workspace.kind !== 'link') return null;
  const members = typeof workspace.memberCount === 'number' ? workspace.memberCount : 0;
  return members === 1 ? null : 'container-only';
}

// ─── END SESSION-AUDIENCE-PURE ─────────────────────────────────────────────

module.exports = { containerOnlyDenies, audienceFor };
