import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import {
  issueContainerToken,
  revokeContainerTokens,
} from "@/shared/auth/mcp-container-token";

export const dynamic = "force-dynamic";

/**
 * THE CONTAINER-LOCKED CHILD CREDENTIAL (plan §4.4 B1, Samuel's RULING 4).
 *
 * POST — mint a credential that may act in ONE workspace and no other, for the
 * session the desktop is about to spawn there.
 * DELETE — revoke one at session end.
 *
 * 🔒 ⚠ `sessionOnly` GATES BOTH, AND IT IS THE SECURITY PROPERTY RATHER THAN A
 * COPY OF THE DEVICE ROUTE'S OPTIONS — the argument is that route's, applied to
 * a sharper case. On the MINT side: if a bearer could reach this, an agent
 * holding a LOCKED credential could ask for a credential locked to somewhere
 * else, which is the one move the whole layer exists to prevent. On the REVOKE
 * side: an agent could kill its own lock and then re-run under the operator's
 * unlocked device token. **A bearer must never operate the controls that govern
 * bearers**, and here the bearer in question is the fence itself.
 *
 * ⚠ THE POLICY LIVES IN THE DESKTOP, NOT HERE. This route will lock a session
 * to ANY workspace the caller is an active member of; it does not check that the
 * target is a shared link container. That is deliberate and it is safe in one
 * direction only: a lock can only ever REMOVE reach, so the worst a wrong call
 * produces is a credential that can do less than the caller already could.
 * `dopl-desktop-app/main/session-credential.js › shouldLockSession` is where
 * "kind='link' AND more than one active member" is decided, beside the roster it
 * already holds.
 */

const MintSchema = z.object({}).strict();

/**
 * ⚠ `withWorkspaceAuth` rather than `withUserAuth`, so the TARGET is resolved
 * and proved a membership by the wrapper (§4) instead of being read out of a
 * body this route would then have to verify itself. The desktop sends
 * `X-Workspace-Id`; a caller with no membership gets the wrapper's own 404/403
 * and never reaches the minter.
 *
 * ⚠ IT KEEPS THE WRAPPER'S `viewer` DEFAULT, AND THE FIRST DRAFT DID NOT — that
 * draft set `minRole: "guest"` reasoning that a guest peer's desktop should be
 * able to lock its own sessions too. That is the right INSTINCT and the wrong
 * conclusion, for two reasons. **Mechanically** it would make this the twentieth
 * entry in the guest-allowed route set — a NAMED, PINNED CONTRACT (§4A,
 * `guest-route-floor.test.ts`), which `sessionOnly` does not exempt a route
 * from. **Structurally** it would buy nothing: the guest tier IS the web lane
 * (`/c/{containerId}`, for a person with no desktop app), so no guest reaches a
 * desktop that spawns sessions; a peer who runs one was claimed at `member`,
 * which clears this default already. **Lowering a security-critical floor for a
 * caller class that structurally cannot arrive is a widening with no
 * beneficiary.** If guests ever gain a desktop, this becomes a real question and
 * the answer is to add the entry to that set deliberately, with the doc line.
 */
export const POST = withWorkspaceAuth(
  async (request: NextRequest, { userId, workspaceId }) => {
    // Body must be empty-or-`{}`: the target is the resolved workspace, and a
    // route that ALSO accepted one in the body would have two answers to the
    // only question that matters here.
    try {
      const raw = await request.json();
      if (raw !== null && !MintSchema.safeParse(raw).success) {
        return NextResponse.json(
          { error: "unexpected body — the target is the X-Workspace-Id header" },
          { status: 400 },
        );
      }
    } catch {
      // Empty / non-JSON body is the normal case.
    }
    const { token, tokenId, expiresAt } = await issueContainerToken({
      userId,
      workspaceId,
    });
    return NextResponse.json(
      { token, tokenId, expiresAt, workspaceId },
      // ⚠ A bearer credential must never be cached by any intermediary.
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { sessionOnly: true },
);

/**
 * The revoke half.
 *
 * ⚠ AT LEAST ONE SELECTOR IS REQUIRED — an empty body is a 400, never an
 * accidental revoke-every-session-on-this-machine. `revokeContainerTokens` is
 * additionally incapable of touching an UNLOCKED credential, so even a
 * selector-less call could not reach the operator's 90-day device token; the
 * 400 is about not killing the caller's own live siblings.
 *
 * ⚠ `withUserAuth`, NOT `withWorkspaceAuth`, and the asymmetry with POST is the
 * point: revocation must still work when the container is GONE. A workspace
 * deleted out from under a live session would make a workspace-scoped revoke
 * 404 and strand the credential until its TTL — the FK cascade covers the
 * deleted-container case at rest, and this covers the ordinary one.
 *
 * Idempotent: unknown or already-revoked is a quiet 200 `revoked: 0`.
 */
const RevokeSchema = z.object({
  tokenId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
});

export const DELETE = withUserAuth(
  async (request: NextRequest, { userId }) => {
    let raw: unknown = {};
    try {
      raw = (await request.json()) ?? {};
    } catch {
      raw = {};
    }
    const parsed = RevokeSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "tokenId and workspaceId must be uuids" },
        { status: 400 },
      );
    }
    const { tokenId, workspaceId } = parsed.data;
    if (!tokenId && !workspaceId) {
      return NextResponse.json(
        { error: "tokenId or workspaceId required" },
        { status: 400 },
      );
    }
    const revoked = await revokeContainerTokens({
      userId,
      tokenId,
      workspaceId,
    });
    return NextResponse.json(
      { ok: true, revoked },
      { headers: { "Cache-Control": "no-store" } },
    );
  },
  { sessionOnly: true },
);
