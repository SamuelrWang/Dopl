import { NextResponse } from "next/server";
import { z } from "zod";
import { withUserAuth } from "@/shared/auth/with-auth";
import { withErrorHandler } from "@/shared/api/error-handler";
import { parseJson } from "@/shared/api/parse-json";
import { HttpError } from "@/shared/lib/http-error";
import { updateConnectionGrants } from "@/features/integrations/server/service";

const Body = z.object({
  workspace_ids: z.array(z.string().uuid()),
});

/**
 * PUT /api/integrations/connections/[connectionId]/grants
 *
 * Replace the connection's workspace grants list. Body
 * `{ workspace_ids: string[] }` — the new full set; we diff against
 * existing rows. Empty array effectively makes the connection
 * unusable from any workspace (deliberate: lets the user fully
 * "park" a connection without disconnecting).
 */
export const PUT = withUserAuth(
  withErrorHandler(
    "PUT /api/integrations/connections/[connectionId]/grants",
    async (req, ctx) => {
      const connectionId = ctx.params?.connectionId;
      if (!connectionId) throw HttpError.badRequest("Missing connection id");
      const input = await parseJson(req, Body);
      const result = await updateConnectionGrants({
        userId: ctx.userId,
        connectionId,
        workspaceIds: input.workspace_ids,
      });
      return NextResponse.json({
        granted_workspace_ids: result.grantedWorkspaceIds,
      });
    }
  )
);
