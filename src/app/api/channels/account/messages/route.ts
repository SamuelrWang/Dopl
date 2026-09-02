import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { parseQuery } from "@/shared/api/parse-json";
import { toChannelErrorResponse } from "@/shared/api/channel-route";
import { readAccountMessages } from "@/features/channels/server/service";
import { AccountMessagesQuerySchema } from "@/features/channels/schema";

/**
 * **THE ACCOUNT-WIDE MESSAGE READ** — new messages past one cursor across every
 * channel the caller is in, in every workspace and every home-channel container
 * (T21).
 *
 * ⚠ **ONE CURSOR IS LEGAL, AND THIS IS THE FACT IT RESTS ON:**
 * `channel_messages.seq` is `BIGINT GENERATED ALWAYS AS IDENTITY`
 * (`supabase/migrations/20260725120000_channels.sql`) — a TABLE-WIDE sequence,
 * not a per-workspace one. So ordering by `seq` interleaves every room of every
 * tenancy in true arrival order, and a caller who advances to the highest seq on
 * a page has provably seen everything below it EVERYWHERE.
 *
 * ⚠ **A PAGE, NEVER A HOLD.** The long-poll lives at `/api/channels/await`
 * (workspace-scoped) and stays there: a hold needs a re-proved membership set
 * per tick and a deadline struck before the first proof, and this route has
 * neither because it does not wait. Do not grow a `timeoutMs` here.
 *
 * ⚠ Same USER fence and same non-application of the container lock as its
 * sibling — see `./status/route.ts`'s header, which carries the whole argument.
 */
async function handleGet(
  request: NextRequest,
  { userId }: { userId: string }
): Promise<Response> {
  try {
    const { since, limit } = parseQuery(
      request.nextUrl.searchParams,
      AccountMessagesQuerySchema,
      ["since", "limit"]
    );
    const page = await readAccountMessages(userId, { since, limit });
    return NextResponse.json(page, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const GET = withUserAuth(handleGet);
