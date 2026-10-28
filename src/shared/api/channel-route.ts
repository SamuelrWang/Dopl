import { HttpError } from "@/shared/lib/http-error";
import { isUuid } from "@/shared/lib/id/uuid";
import { toChannelErrorResponse } from "@/features/channels/server/http-mapping";
import { findChannelWorkspaceForMember } from "@/features/channels/server/repository";

/** Route-layer helpers for the channels API: the feature error mapper (one
 *  import site for handlers) and the dynamic-param extractors. */

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
 * ⚠ The shape check is not cosmetic: `id` goes straight into a `uuid =` filter,
 * so a non-UUID reaches Postgres as a 22P02 cast failure — a 500 plus a
 * `system_events` row on EVERY such call. Malformed collapses to the SAME 404 a
 * missing/foreign id gets, so ids cannot be probed.
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

/** Extract + validate the `[threadId]` dynamic param. ⚠ Same rationale as
 *  `requireConsentId`. */
export function requireThreadId(
  params: Record<string, string> | undefined
): string {
  const threadId = params?.threadId;
  if (!threadId) {
    throw new HttpError(400, "MISSING_THREAD_ID", "Route param threadId is required");
  }
  if (!isUuid(threadId)) {
    throw new HttpError(404, "THREAD_NOT_FOUND", `Thread not found: ${threadId}`);
  }
  return threadId;
}

// ⚠ There is deliberately NO `requireAgentId`: the `[agentId]` route it guarded
// is deleted, and the surviving `GET .../agents` (historical attribution roster)
// takes no agent id.

/**
 * **THE CHANNEL NAMES ITS OWN CONTAINER** (2026-10-08) — `workspaceFromParams` for every
 * `/api/channels/[channelId]/…` route. A request that omits `X-Workspace-Id` resolves to the
 * channel's container (when the caller is a channel member) instead of the caller's home space,
 * where the channel is "not found" (every decision card outside the home space failed that way).
 * An explicit header or key lock still wins; a slug, a non-member or an unknown id derive nothing.
 * ⚠ `workspace-derivation-coverage.test.ts` pins every channel route on it: it asserts each
 * `withWorkspaceAuth` call under `/api/channels/[channelId]/**` names `workspaceFromParams:
 * channelWorkspace`, so a new channel route cannot quietly reopen the bug.
 */
export async function channelWorkspace(
  params: Record<string, string> | undefined,
  userId: string
): Promise<string | null> {
  const id = params?.channelId;
  return id && isUuid(id) ? findChannelWorkspaceForMember(id, userId) : null;
}
