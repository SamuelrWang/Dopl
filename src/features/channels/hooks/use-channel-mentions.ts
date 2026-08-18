"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import type { ChannelMention } from "../types";
import { channelMentionsPath } from "../client/query-keys";

/**
 * THE TAGS INBOX's read: every message of the selected channel that tags ME,
 * newest first, with my own read-state on each row.
 *
 * ⚠ THE UNREAD COUNT IS NOT HERE. The badge is client-side arithmetic over
 * `mentions` (wiring plan Phase 6, decision 3) — a hook-level count would be a
 * second derivation of the same set, and two derivations of one number is how
 * the badge and the list come to disagree.
 *
 * ⚠ `truncated` SURVIVES THE CLIENT BOUNDARY (INVARIANTS §9). The inbox is a
 * record nothing leaves, so the ceiling is real; the list component says so.
 * `use-channel-threads.ts` dropped this field for a while on the grounds that
 * its consumer looked rows up by id — this one LISTS, so it never could.
 *
 * The path comes from `client/query-keys.ts`, the same builder the mark-read
 * write patches by, so the two ends cannot name the entry differently.
 */
const selectMentions = (body: {
  mentions: ChannelMention[];
  truncated?: boolean;
}) => ({
  mentions: body.mentions ?? [],
  truncated: body.truncated === true,
});

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_MENTIONS: ChannelMention[] = [];

export function useChannelMentions(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<
    { mentions: ChannelMention[]; truncated?: boolean },
    { mentions: ChannelMention[]; truncated: boolean }
  >(channelId ? channelMentionsPath(channelId) : null, {
    workspaceId,
    select: selectMentions,
    keepPreviousData: true,
    // Paired with `use-channel-messages` / `use-channel-threads` and for the
    // same reason (F-163): realtime refetches only the SELECTED channel, so a
    // cached entry for the channel you switch back to has nothing scheduled to
    // correct it. This read must also agree with the transcript beside it — a
    // fresh transcript under a stale inbox shows a tinted mention the Tags row
    // does not count.
    staleTime: 0,
  });
  return {
    mentions: query.data?.mentions ?? NO_MENTIONS,
    /** ⚠ The read came back AT its ceiling, which counts as clipped. The list
     *  says so; a cap that renders like an exhausted list is the bug. */
    truncated: query.data?.truncated ?? false,
    loading: query.isLoading,
    refetch: query.refetch,
  };
}
