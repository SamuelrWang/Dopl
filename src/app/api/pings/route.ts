import { NextRequest, NextResponse } from "next/server";
import {
  withWorkspaceAuth,
  type WorkspaceAuthContext,
} from "@/shared/auth/with-workspace-auth";
import { parseJson, parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import {
  PingCreateSchema,
  PingListQuerySchema,
} from "@/features/channels/schema";
import {
  buildChannelContext,
  createPing,
  listPings,
} from "@/features/channels/server/service";

/**
 * SEND A PING — one agent telling exactly ONE recipient that it is done, has a
 * question, or is blocked (2026-09-01, `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **THE SENDER IS `ctx.userId` AND THERE IS NO BODY FIELD FOR IT**, and for the
 * two self-scoped recipient forms the RECIPIENT is `ctx.userId` too. That absence
 * is `agent-directions/route.ts`'s authorization story reused verbatim, and here
 * it is the whole loop brake: an agent cannot ping another member's agent because
 * there is no field with which to say so. `service-pings.test.ts` asserts the
 * absence rather than trusting review.
 *
 * ⚠ **NOT `sessionOnly`, DELIBERATELY** — the direct lane's ruling. The caller is
 * an agent token, an external session over MCP, which has no cookie and no
 * browser; gating on credential TYPE would make the op unreachable by the only
 * caller it exists for. **The bound is SCOPE, not credential type**: a POST needs
 * `dopl.write`, and the channel fence below is the real one.
 *
 * ⚠ `minRole` stays at the DEFAULT viewer floor. It is not the fence — the
 * service requires a MEMBERSHIP ROW, not merely readability, so a public channel
 * the caller never joined is refused. ⚠ Deliberately NOT `minRole: "guest"`:
 * nothing here needs the guest floor, and a route that took it would owe an entry
 * in `src/app/api/channels/guest-route-floor.test.ts`.
 *
 * 🔒 **A PING IS NOT A MESSAGE** and never touches `channel_messages`. It must not
 * fan out to the room, it must not end a channel `await` (it has no message `seq`
 * and can never consume that cursor), and it needs its own cursor space — the
 * three reasons in `20260907120000_channel_pings.sql`'s header.
 */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, PingCreateSchema);
    const ctx = buildChannelContext(auth);
    const ping = await createPing(ctx, input);
    // ⚠ 201: unlike a direction, a ping ALWAYS creates a row. There is no
    // `offline: true` arm here because there is nothing to be offline for — the
    // row is the record and it waits for whoever reads it next.
    return NextResponse.json({ ping }, { status: 201 });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

/**
 * THE INBOX CATCH-UP READ — what has been sent TO ME since `since`.
 *
 * ⚠ WHY IT EXISTS ALONGSIDE THE HOLD: the hold is the live path, and a client that
 * was asleep, reconnecting, or never armed one has nothing to resume from. This is
 * the same backstop the direction mailbox shipped with and the launch lane did not
 * (F-273). It is also what the "Needs you" card reads on mount.
 *
 * 🔒 **RECIPIENT-SCOPED IN THE SQL PREDICATE**, not in a branch above it, and
 * there is deliberately no `recipient` parameter: a ping targets one person, and a
 * read that could answer for somebody else would make the table a worse
 * `channel_messages`.
 */
async function handleGet(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const query = parseQuery(request.nextUrl.searchParams, PingListQuerySchema, [
      "since",
      "limit",
    ]);
    const ctx = buildChannelContext(auth);
    const pings = await listPings(ctx, query);
    return NextResponse.json({ pings });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withWorkspaceAuth(handleGet);
export const POST = withWorkspaceAuth(handlePost);
