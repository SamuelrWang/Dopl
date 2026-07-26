import { HttpError } from "@/shared/lib/http-error";
import { toChannelErrorResponse } from "@/features/channels/server/http-mapping";

/**
 * Route-layer helpers for the channels API: re-exports the feature error
 * mapper (so handlers import their catch helper from one place, mirroring
 * `chat-route`) and the dynamic-param extractor.
 */

export { toChannelErrorResponse };

export function requireChannelId(
  params: Record<string, string> | undefined
): string {
  const channelId = params?.channelId;
  if (!channelId) {
    throw new HttpError(
      400,
      "MISSING_CHANNEL_ID",
      "Route param channelId is required"
    );
  }
  return channelId;
}
