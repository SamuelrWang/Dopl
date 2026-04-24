/**
 * POST /api/build — returns a client-side synthesis bundle.
 *
 * After the client-only-synthesis pivot this route no longer calls
 * Claude. It runs retrieval (embedding search) and returns the
 * pre-substituted builder prompt + the retrieved entries. The agent
 * (typically Claude Code via the `build_solution` MCP tool) runs the
 * prompt in its own context and produces the composite README +
 * agents.md for the user.
 *
 * Nothing is persisted — build_solution is a stateless synthesis helper.
 */

import { NextRequest, NextResponse } from "next/server";
import { BuildRequestSchema } from "@/types/api";
import { buildBuilderBundle } from "@/lib/retrieval/builder";
import { withMcpCredits } from "@/shared/auth/with-auth";

async function handlePost(
  request: NextRequest,
  { userId }: { userId: string }
) {
  try {
    const body = await request.json();
    const parsed = BuildRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const bundle = await buildBuilderBundle(
      parsed.data.brief,
      parsed.data.constraints,
      userId
    );

    return NextResponse.json(bundle);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Build failed", message },
      { status: 500 }
    );
  }
}

// Credit cost dropped from 5 → 1 (see CREDIT_COSTS.mcp_build): the only
// remaining server work is embedding-search retrieval; no LLM spend.
export const POST = withMcpCredits("mcp_build", handlePost);
