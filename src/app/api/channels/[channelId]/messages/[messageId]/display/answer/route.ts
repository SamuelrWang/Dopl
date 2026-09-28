import { NextRequest, NextResponse } from "next/server";
import { withWorkspaceAuth, type WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { parseJson } from "@/shared/api/parse-json";
import { requireChannelId, toChannelErrorResponse } from "@/shared/api/channel-route";
import { buildChannelContext } from "@/features/channels/server/service";
import { withMessageSource } from "@/features/channels/server/message-source";
import { answerDisplay, DisplayAnswerSchema } from "@/features/glasses/core/screens/display-actions";

/** POST — answer a display's selectable list from the app (docs/specs/device-aware-messages.md). */
async function handlePost(request: NextRequest, auth: WorkspaceAuthContext) {
  try {
    const input = await parseJson(request, DisplayAnswerSchema);
    const ctx = await withMessageSource(buildChannelContext(auth), request);
    const result = await answerDisplay(ctx, requireChannelId(auth.params), auth.params?.messageId ?? "", input);
    return NextResponse.json(result);
  } catch (err) {
    return toChannelErrorResponse(err);
  }
}

// ⚠ A person's press: session only (an agent cannot answer for its operator); channel membership is the gate.
export const POST = withWorkspaceAuth(handlePost, { sessionOnly: true });
