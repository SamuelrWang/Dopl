import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
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

/**
 * Extract + validate the `[id]` dynamic param (consent request routes).
 *
 * The shape check is not cosmetic: `id` goes straight into a `uuid =` filter,
 * so a non-UUID reaches Postgres as a 22P02 cast failure — a generic 500 plus
 * a `system_events` error row on EVERY such call, which is a free way to
 * spam the health dashboard. Malformed collapses to the same 404 the service
 * returns for a missing / foreign id, so an id still can't be probed.
 */
export function requireConsentId(
  params: Record<string, string> | undefined
): string {
  const id = params?.id;
  if (!id) {
    throw new HttpError(400, "MISSING_CONSENT_ID", "Route param id is required");
  }
  if (!isUuid(id)) {
    throw new HttpError(
      404,
      "CONSENT_NOT_FOUND",
      `Consent request not found: ${id}`
    );
  }
  return id;
}

/**
 * Extract + validate the `[taskId]` dynamic param (task PATCH route). Same
 * rationale as `requireConsentId`: a non-UUID would reach Postgres as a 22P02
 * cast failure (a 500 + a `system_events` row on every such call), so a
 * malformed id collapses to the same 404 the service returns for a missing /
 * foreign id — the id still can't be probed.
 */
export function requireTaskId(
  params: Record<string, string> | undefined
): string {
  const taskId = params?.taskId;
  if (!taskId) {
    throw new HttpError(400, "MISSING_TASK_ID", "Route param taskId is required");
  }
  if (!isUuid(taskId)) {
    throw new HttpError(404, "TASK_NOT_FOUND", `Task not found: ${taskId}`);
  }
  return taskId;
}
