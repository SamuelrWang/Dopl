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
// ⚠ Route-level composition (the permitted shape): the account payload folds in
// HOME's legacy unbound links; §1 forbids `channels → home`, so the fold lives here.
import { createHomeChannel } from "@/features/home/server/service-writes";
import { listMyPendingLinks } from "@/features/home/server/service-reads";

/**
 * 🔒 The one channel-list resource, `?scope=container|account` (R-26 (b)). The
 * projection lives in `channels/server/service-list.ts`; this file owns the FENCE:
 * - `container` — `withWorkspaceAuth` at guest (§4A, §2B); the real gate is the
 *   per-channel membership fence in the service, the floor is a tripwire.
 * - `account` — `withUserAuth`: `withWorkspaceAuth` 400s a 2+-membership caller
 *   (§4) and hides `kind='link'` containers (§4A). The fence is the USER.
 *
 * 🔒 B1 (`apiKeyWorkspaceId`) must be applied on the account arm (R3) — no wrapper
 * upstream enforces the credential's lock, and it is the only narrowing.
 *
 * ⚠ `GET /api/channels/account/status` stays separate: it answers what NEEDS you,
 * not what the rows are. Fences pinned by `route-scope-fence.test.ts`.
 */

async function handleContainerGet(
  _request: NextRequest,
  auth: WorkspaceAuthContext
) {
  try {
    const channels = await listChannels(buildChannelContext(auth));
    // ⚠ No `pendingLinks` key here, never `[]` (§9 precedent): `[]` would claim
    // "asked, none open" for a response that was not account-scoped.
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
 * POST `?scope=account` — a solo `kind='link'` container plus one private channel.
 * ⚠ Deliberately NOT `sessionOnly` (Samuel, 2026-08-24): a channel you are alone in
 * reaches nobody. `POST /api/home/links` (reaches a person) is the gated one.
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
 * ⚠ Scope is parsed BEFORE auth because it chooses the wrapper. Safe: a closed
 * two-value enum over no identifier; a bad one 400s for everyone alike.
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
