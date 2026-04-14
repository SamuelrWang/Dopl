import { NextRequest, NextResponse } from "next/server";
import { BuildRequestSchema } from "@/types/api";
import { buildComposite } from "@/lib/retrieval/builder";
import { withSubscriptionAuth } from "@/lib/auth/with-auth";
import type { SubscriptionTier } from "@/lib/billing/subscriptions";

async function handlePost(
  request: NextRequest,
  { tier }: { userId: string; tier: SubscriptionTier }
) {
  // Build Solution is pro-only
  if (tier === "free") {
    return NextResponse.json(
      {
        error: "pro_required",
        message:
          "Build Solution is a Pro feature. Upgrade to compose custom solutions from the knowledge base.",
        upgrade_url: "/settings/billing",
      },
      { status: 402 }
    );
  }

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

export const POST = withSubscriptionAuth(handlePost);
