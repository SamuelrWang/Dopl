import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { parseJson } from "@/shared/api/parse-json";
import { hasActiveAccess, accessDeniedBody } from "@/features/billing/server/access";
import { PrepareFromIntegrationInputSchema } from "@/features/integrations/schema";
import { prepareFromIntegration } from "@/features/integrations/server/service";

/**
 * POST /api/ingest/prepare-from-integration
 *
 * Sibling of /api/ingest/prepare. Instead of fetching by URL, this
 * resolves a third-party object via the user's connected integration,
 * persists it as an entry + sources row, and returns the same shape
 * the agent already knows how to consume from prepare_ingest.
 *
 * The agent then runs the synthesis prompts and POSTs to the
 * unchanged /api/ingest/submit to commit. No new submit path.
 */
export const POST = withWorkspaceAuth(
  withErrorHandler(
    "POST /api/ingest/prepare-from-integration",
    async (req, ctx) => {
      const input = await parseJson(req, PrepareFromIntegrationInputSchema);

      const access = await hasActiveAccess(ctx.userId);
      if (!access.allowed) {
        return NextResponse.json(accessDeniedBody(access), { status: 402 });
      }

      const result = await prepareFromIntegration(
        {
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          provider: input.provider,
        },
        {
          objectId: input.object_id,
          kbId: input.kb_id,
          clusterId: input.cluster_id,
        }
      );
      return NextResponse.json(result);
    }
  ),
  { minRole: "viewer" }
);
