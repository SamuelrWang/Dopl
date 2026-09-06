import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { requireChannelId } from "@/shared/api/channel-route";
import { requireChannelKnowledgeContext } from "@/shared/api/channel-knowledge-lane";
import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import {
  armChannelForPersonalShelf,
  disarmChannelForPersonalShelf,
  isChannelArmed,
  type PersonalArmingCaller,
} from "@/shared/tenancy/personal-arming";

/**
 * 🔒 `/api/channels/{channelId}/personal-arming` — **THE SWITCH THAT LETS YOUR
 * OWN AGENTS IN THIS ROOM REACH YOUR PERSONAL SHELF** (task 11, design #1077,
 * approved #1080). GET reads YOUR row, PUT arms, DELETE disarms.
 *
 * ⚠ **EVERY VERB IS ABOUT THE CALLER'S OWN SHELF.** There is no owner in the
 * path or the body: the row is `(channel, caller)` and nothing here can be
 * pointed at somebody else, which is why the payload is a bare boolean rather
 * than a list a peer could read.
 *
 * ── The fences, in order ────────────────────────────────────────────────────
 *  1. `withWorkspaceAuth(..., {minRole:"guest"})` — the workspace floor, the
 *     same tripwire the guest knowledge lane uses: a peer standing in somebody
 *     else's container is a GUEST there and arms their own shelf like anyone.
 *  2. GET/PUT — `requireChannelKnowledgeContext`, which resolves the ref and
 *     REQUIRES membership (its `membership !== null` line), so a non-member gets
 *     the same 404 an unknown channel gets.
 *  3. `shared/tenancy/personal-arming.ts` — human-only, owner-keyed, and it
 *     re-checks membership on the write. Two fences, deliberately: this route is
 *     not the only door the service is meant to survive.
 *
 * 🔒 **DELETE DOES NOT TAKE FENCE 2, AND THAT IS THE RULE, NOT A GAP.** The RLS
 * delete policy carries no membership test because leaving a room must not
 * strand an armed row its owner can no longer close. Requiring a visible channel
 * here would re-impose exactly that. It takes the channel id as a UUID and
 * deletes the caller's own row; a caller can reach no other row with it.
 */
async function handleGet(_request: NextRequest, auth: WorkspaceAuthContext) {
  return respond(async () => {
    const ctx = await requireChannelKnowledgeContext(auth);
    return { armed: await isChannelArmed(callerFrom(auth), ctx.channelId) };
  });
}

async function handlePut(_request: NextRequest, auth: WorkspaceAuthContext) {
  return respond(async () => {
    const ctx = await requireChannelKnowledgeContext(auth);
    return await armChannelForPersonalShelf(callerFrom(auth), ctx.channelId);
  });
}

async function handleDelete(_request: NextRequest, auth: WorkspaceAuthContext) {
  return respond(async () => {
    const ref = requireChannelId(auth.params);
    // ⚠ A UUID OR NOTHING. Resolving a SLUG would need the channel read this
    // verb deliberately does not take; a departed member still knows the id.
    if (!isUuid(ref)) {
      throw new HttpError(404, "CHANNEL_NOT_FOUND", `Channel not found: ${ref}`);
    }
    return await disarmChannelForPersonalShelf(callerFrom(auth), ref);
  });
}

/** ⚠ THE TWO AXES, STATED, NEVER INFERRED — `credentialSubjectUserId` is whose
 *  reach the credential carries and `source` is who is asking. The service
 *  refuses on both; this only carries them. */
function callerFrom(auth: WorkspaceAuthContext): PersonalArmingCaller {
  return {
    userId: auth.userId,
    credentialSubjectUserId: auth.credentialSubjectUserId,
    // Same derivation the knowledge lane uses: an API key means an agent.
    source: auth.agentTokenId ? "agent" : "user",
  };
}

/** ⚠ `HttpError` PASSES THROUGH WITH ITS OWN STATUS — the 404 and the 403 are
 *  the answer, and a 500 here would turn a refusal into an outage. */
async function respond(run: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await run());
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.status }
      );
    }
    throw err;
  }
}

export const GET = withWorkspaceAuth(handleGet, { minRole: "guest" });
export const PUT = withWorkspaceAuth(handlePut, { minRole: "guest" });
export const DELETE = withWorkspaceAuth(handleDelete, { minRole: "guest" });
