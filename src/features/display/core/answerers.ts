import { mentionedUserIdsOf } from "@/features/channels/lib/mentions";

/**
 * **WHO MAY ANSWER A DISPLAY** (spec §3.2) — the members the message TAGGED (the server-stamped
 * mention set, caller-unsettable), else its author account. Samuel's 2026-08-31 escalation ruling,
 * now for every display. ⚠ DELIBERATELY NOT `to_user_id`: addressing a member starts THEIR agent;
 * an @-tag is an inbox fact and starts nobody. One rule for the server's 403 and the UI's buttons.
 */
export function answerersOf(
  metadata: Record<string, unknown> | null | undefined,
  authorUserId: string | null | undefined
): string[] {
  const tagged = mentionedUserIdsOf(metadata);
  if (tagged.length > 0) return tagged;
  return authorUserId ? [authorUserId] : [];
}
