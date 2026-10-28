import { NextRequest, NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getHomeNeeds } from "@/features/home/server/service-needs";

interface Ctx {
  userId: string;
}

const SOURCE = "api/home/needs";

/**
 * GET — the /home Overview's Needs you: open decision cards the caller may answer and unresolved
 * tasks assigned to them, across their home channels. Fenced by the caller's own memberships
 * (`service-needs.ts › visibleHomeChannels`); takes no parameters. Its own read so a failure here
 * leaves the rest of the face standing.
 */
export const GET = withUserAuth(async (_request: NextRequest, { userId }: Ctx) => {
  try {
    const needs = await getHomeNeeds(userId);
    return NextResponse.json(needs, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return toHttpErrorResponse(SOURCE, err);
  }
});
