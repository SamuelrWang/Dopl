import { NextRequest, NextResponse } from "next/server";
import { BuildRequestSchema } from "@/types/api";
import { buildComposite } from "@/lib/retrieval/builder";
import { withMcpCredits } from "@/lib/auth/with-auth";

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = BuildRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await buildComposite(
      parsed.data.brief,
      parsed.data.constraints
    );

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Build failed", message },
      { status: 500 }
    );
  }
}

export const POST = withMcpCredits("mcp_build", handlePost);
