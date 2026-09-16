"use client";

/**
 * THE ARTIFACT READS — this channel's cards, and ONE card's folded run.
 *
 * ⚠ **THEY ARE A REAL SERVER LANE AND DELIBERATELY NOT THE TRANSCRIPT'S.** The
 * page a reader has loaded carries an `entries` envelope holding only the cards
 * that page happened to fold (`lib/message-window.ts › MessageWindow.artifacts`),
 * and a browse list built on it would wear the words "this channel's artifacts"
 * over whatever the scroll position bought — a control that lies about its own
 * completeness. The list read is bounded server-side and says when it clipped
 * (`constants.ts › CHANNEL_ARTIFACT_LIST_LIMIT`, INVARIANTS §9), which is the
 * property the envelope cannot have.
 *
 * ⚠ ONE PATH, TWO ARMS — `client/query-keys.ts › channelArtifactsPath`. The
 * `?artifact=<id>` variant registers its own cache entry under the same prefix
 * key, so the two reads share invalidation without sharing a response shape.
 *
 * ⚠ BOTH ARE DISABLED UNTIL THEIR SUBJECT EXISTS (`null` path): a face that is not
 * open asks for nothing, which is the same rule the Knowledge tab's reads keep.
 */

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { channelArtifactsPath } from "../client/query-keys";
import type { ChannelFoldedArtifact, ChannelMessage } from "../types";

/** Stable identity for the not-yet-loaded case (a fresh [] would churn memos). */
const NO_ARTIFACTS: ChannelFoldedArtifact[] = [];
const NO_MESSAGES: ChannelMessage[] = [];

/**
 * THIS CHANNEL'S CARDS, newest first, dissolved ones absent.
 *
 * ⚠ `truncated` IS CARRIED THROUGH, NEVER DROPPED: this is a surface that
 * presents itself as A LIST OF THE CHANNEL'S ARTIFACTS, and INVARIANTS §9 is
 * explicit that a cap rendering identically to an exhausted list is the bug.
 */
export function useChannelArtifacts(
  channelId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{
    artifacts: ChannelFoldedArtifact[];
    truncated?: boolean;
  }>(channelId ? channelArtifactsPath(channelId) : null, {
    workspaceId,
    keepPreviousData: true,
  });
  return {
    artifacts: query.data?.artifacts ?? NO_ARTIFACTS,
    truncated: query.data?.truncated === true,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * ONE CARD, OPENED — its members verbatim, in seq order, with their own seqs.
 *
 * ⚠ **THE BODIES COME FROM THE SERVER RATHER THAN FROM THE TRANSCRIPT IN HAND**,
 * and that is the difference between this face and the in-transcript card: the
 * transcript's card can only show the members that are on the loaded page and says
 * so (`artifact-card.tsx › artifactPartialLabel`), whereas an opened card is the
 * whole run up to the member ceiling.
 * ⚠ `truncated` HERE IS THE MEMBER CEILING (`repository-artifacts.ts ›
 * ARTIFACT_MEMBER_LIMIT`), a different bound from the list's — same rule, two
 * reads, and neither may be read as the other.
 */
export function useChannelArtifact(
  channelId: string | null,
  artifactId: string | null,
  workspaceId: string
) {
  const query = useApiQuery<{
    messages: ChannelMessage[];
    truncated?: boolean;
  }>(channelId && artifactId ? channelArtifactsPath(channelId) : null, {
    workspaceId,
    query: artifactId ? { artifact: artifactId } : undefined,
  });
  return {
    messages: query.data?.messages ?? NO_MESSAGES,
    truncated: query.data?.truncated === true,
    loading: query.isLoading,
    error: query.error,
  };
}
