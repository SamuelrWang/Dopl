import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse, channelWorkspace } from "@/shared/api/channel-route";
import { buildChannelContext } from "@/features/channels/server/service";
import { DisplaySaveSchema, saveDisplayTemplate } from "@/features/display/server/answer";

/** POST `{name?}` — save a message's display as one of the caller's glasses templates. */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, DisplaySaveSchema);
    const result = await saveDisplayTemplate(
      buildChannelContext(auth),
      requireChannelId(auth.params),
      auth.params?.messageId ?? "",
      input
    );
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

export const POST = withWorkspaceAuth(handlePost, { workspaceFromParams: channelWorkspace });
