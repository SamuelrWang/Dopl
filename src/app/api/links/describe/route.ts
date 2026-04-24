import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/lib/auth/with-auth";
import { describeLink } from "@/features/ingestion/server/link-describer";

export const dynamic = "force-dynamic";

/**
 * POST /api/links/describe
 *
 * Returns lightweight self-description for a URL — the link's own
 * metadata (GitHub repo description, og:description on web pages,
 * arxiv abstract, etc.). Called by the `describe_link` MCP tool
 * during the two-entry offering protocol: the agent filters
 * `detected_links[]` locally, then invokes this per survivor to
 * get authoritative descriptions for the user-facing rationale.
 *
 * Scope: bounded 5s timeout per URL; no full extraction; no
 * following of links; no storage of results. Pure metadata fetch.
 */

const MAX_URL_LENGTH = 2_048;

const RequestSchema = z.object({
  url: z.string().url().max(MAX_URL_LENGTH),
});

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await describeLink(parsed.data.url);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[describe] endpoint threw:", message);
    return NextResponse.json(
      { error: "Describe failed", message },
      { status: 500 }
    );
  }
}

export const POST = withUserAuth(handlePost);
