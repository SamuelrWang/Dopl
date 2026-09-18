import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import {
  withUserAuth,
  type RouteContextArg,
} from "@/shared/auth/with-auth";
import { parseJson, parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  buildChannelContext,
  createChannel,
  listAccountChannels,
  listChannels,
} from "@/features/channels/server/service";
import {
  ChannelCreateSchema,
  ChannelListQuerySchema,
} from "@/features/channels/schema";
import { HomeChannelCreateSchema } from "@/features/home/schema";
// ⚠ **ROUTE-LEVEL COMPOSITION, WHICH IS THE PERMITTED SHAPE.** The account
// payload folds the caller's LEGACY unbound links, which are the HOME feature's
// (`channel_links` with no container). §1 forbids `channels → home`, so the fold
// happens HERE — the same place the channel-knowledge lane composes two features.
import { createHomeChannel } from "@/features/home/server/service-writes";
import { listMyPendingLinks } from "@/features/home/server/service-reads";

/**
 * 🔒 **THE ONE CHANNEL-LIST RESOURCE — `?scope=container|account`** (R-26 (b),
 * 2026-09-17). The projection and the ruling are `channels/server/service-list.ts`;
 * what this file decides is the FENCE, which is the only thing that may differ per
 * scope:
 *
 * - `container` — `withWorkspaceAuth` at `minRole: "guest"`. A guest reaches the
 *   LISTING (§4A, §2B); the real gate is the per-channel membership fence in the
 *   service, and the workspace floor is only a tripwire.
 * - `account` — `withUserAuth`, and it **could not be `withWorkspaceAuth`**: that
 *   wrapper resolves exactly ONE workspace and answers 400 `WORKSPACE_REQUIRED` to
 *   a caller with 2+ standard memberships (§4) — precisely the caller this scope
 *   exists for — and it filters `kind='link'` containers out of auto-targeting
 *   (§4A). **The fence is the USER**, as it is for `GET /api/channels/account/status`.
 *
 * 🔒 **B1 — `ctx.apiKeyWorkspaceId` — IS APPLIED ON THE ACCOUNT ARM AND HAS TO BE
 * (R3).** A container-locked credential's lock is a property of the CREDENTIAL and
 * `withWorkspaceAuth` 403s on it everywhere else; this arm does not use that
 * wrapper, so nothing upstream enforces it. There is no caller-supplied scoping
 * parameter, so the lock is the only thing that can narrow this answer.
 *
 * ⚠ **`GET /api/channels/account/status` STAYS AND ANSWERS A DIFFERENT QUESTION** —
 * what NEEDS you, not what the ROWS are. Folding them would give one handler two
 * payload shapes and two ceilings.
 *
 * Fences pinned by `route-scope-fence.test.ts`.
 */

async function handleContainerGet(
  _request: NextRequest,
  auth: WorkspaceAuthContext
) {
  try {
    const channels = await listChannels(buildChannelContext(auth));
    // ⚠ **NO `pendingLinks` KEY HERE, NEVER `[]`** — an absent param yields an
    // absent key (§9's `channelGrants` precedent). `[]` would assert "asked, none
    // open" where the truth is "this response was not account-scoped".
    return NextResponse.json({ channels });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleAccountGet(
  _request: NextRequest,
  {
    userId,
    apiKeyWorkspaceId,
  }: { userId: string; apiKeyWorkspaceId?: string | null }
) {
  try {
    const [{ channels, truncated }, pendingLinks] = await Promise.all([
      listAccountChannels(userId, apiKeyWorkspaceId ?? null),
      listMyPendingLinks(userId),
    ]);
    return NextResponse.json(
      { channels, pendingLinks, truncated },
      // ⚠ Per-caller and volatile by construction — never cacheable.
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

async function handleContainerPost(
  request: NextRequest,
  auth: WorkspaceAuthContext
) {
  try {
    const input = await parseJson(request, ChannelCreateSchema);
    const channel = await createChannel(buildChannelContext(auth), input);
    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * POST `?scope=account` — "New channel": a solo `kind='link'` CONTAINER plus one
 * private channel inside it.
 *
 * ⚠ **DELIBERATELY NOT `sessionOnly`** (Samuel, 2026-08-24), matching
 * `POST /api/workspaces`: an agent token may mint a channel it is alone in,
 * because that reaches nobody. `POST /api/home/links` — which reaches a PERSON —
 * is the session-gated one.
 */
async function handleAccountPost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const input = await parseJson(request, HomeChannelCreateSchema);
    return NextResponse.json(await createHomeChannel(userId, input), {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

const containerGet = withWorkspaceAuth(handleContainerGet, { minRole: "guest" });
const accountGet = withUserAuth(handleAccountGet);
const containerPost = withWorkspaceAuth(handleContainerPost, {
  minRole: "member",
});
const accountPost = withUserAuth(handleAccountPost);

/**
 * ⚠ **THE SCOPE IS PARSED BEFORE AUTH, AND IT MUST BE** — it is what CHOOSES the
 * wrapper, so it cannot be read inside one. That is safe because it leaks nothing:
 * the value is a closed two-member enum over no identifier, and a bad one answers
 * 400 to an unauthenticated caller exactly as it does to a member.
 */
function scopeOf(request: NextRequest) {
  return parseQuery(request.nextUrl.searchParams, ChannelListQuerySchema, [
    "scope",
  ]).scope;
}

type WrappedHandler = (
  request: NextRequest,
  context: RouteContextArg
) => Promise<Response | NextResponse>;

function dispatch(
  request: NextRequest,
  context: RouteContextArg,
  container: WrappedHandler,
  account: WrappedHandler
): Promise<Response | NextResponse> {
  let scope: "container" | "account";
  try {
    scope = scopeOf(request);
  } catch (err) {
    return Promise.resolve(toChannelErrorResponse(err));
  }
  return (scope === "account" ? account : container)(request, context);
}

export function GET(request: NextRequest, context: RouteContextArg) {
  return dispatch(request, context, containerGet, accountGet);
}

export function POST(request: NextRequest, context: RouteContextArg) {
  return dispatch(request, context, containerPost, accountPost);
}
