"use client";

import {
  patchCache,
  useApiMutationWith,
  type MutationGate,
} from "@/shared/hooks/use-api-mutation";
import { toast } from "@/shared/ui/toast";
import { ChannelApiError, channelRequest } from "../client/api";
import {
  CHANNEL_CONSENT_PATH,
  CHANNEL_TRUST_PATH,
  channelKeys,
  channelMembersPath,
} from "../client/query-keys";
import {
  addTrustRuleRow,
  dropConsentRequest,
  removeTrustRuleRow,
  setToolProfile,
  type ChannelsCache,
  type ConsentCache,
  type TrustCache,
} from "../lib/optimistic-cache";
import type {
  AgentToolProfile,
  AgentTrustRule,
  ChannelConsentRequest,
  ChannelMember,
} from "../types";

/**
 * The channel writes that were ALREADY optimistic, moved off their
 * hand-rolled override records and onto the shared mutation layer.
 *
 * Each of them used to keep a `Record<id, value>` in `useState`, render the
 * server value THROUGH that lens, and delete the entry in a `finally` — so
 * success revealed the refetched value and failure reverted. It is the correct
 * pattern, implemented by hand once per write, and it cost a state atom, a
 * lens memo and a cleanup block each. They now patch the QUERY CACHE, which
 * every reader already reads, so the lenses are gone and there is one
 * optimistic idiom in the feature instead of several.
 *
 * What each write's optimistic patch has to say is now the whole of it:
 * tool-profile sets one field on one channel row (in both the archived and
 * unarchived list variants — `.all` is a prefix key); trust adds or removes a
 * rule row; a consent decision drops the request, because the inbox holds only
 * `pending` rows and dropping it IS the decided state.
 *
 * There were FOUR of these until 2026-08-08, when notify scope was removed
 * from the product (F-170) — its mutation, its cache patch and its bell
 * popover went together.
 */

export interface PreferenceWritesParams {
  workspaceId: string;
  currentUserId: string;
  gate: MutationGate;
}

function failed(err: unknown, fallback: string) {
  toast({ title: err instanceof ChannelApiError ? err.message : fallback });
}

export interface ToolProfileDraft {
  channelId: string;
  profile: AgentToolProfile;
}
export interface TrustDraft {
  userId: string;
  trusted: boolean;
}
export interface ConsentDraft {
  id: string;
  decision: "allow" | "deny";
}

export function useChannelPreferenceWrites({
  workspaceId,
  currentUserId,
  gate,
}: PreferenceWritesParams) {
  const toolProfile = useApiMutationWith<
    ToolProfileDraft,
    { member: ChannelMember }
  >(channelRequest, {
    request: (draft) => ({
      path: channelMembersPath(draft.channelId),
      method: "PATCH",
      workspaceId,
      body: { agentToolProfile: draft.profile },
    }),
    optimistic: (draft) =>
      patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
        setToolProfile(cache, draft.channelId, draft.profile)
      ),
    invalidate: () => [channelKeys.list().all],
    settleWith: gate,
    onError: (err) => failed(err, "Couldn't update agent tools"),
  });

  const trust = useApiMutationWith<TrustDraft, { rule?: AgentTrustRule }>(
    channelRequest,
    {
      request: (draft) => ({
        path: CHANNEL_TRUST_PATH,
        method: draft.trusted ? "POST" : "DELETE",
        workspaceId,
        body: { trustedUserId: draft.userId },
      }),
      optimistic: (draft) =>
        patchCache<TrustCache>(channelKeys.trust().all, (cache) =>
          draft.trusted
            ? addTrustRuleRow(cache, {
                trustedUserId: draft.userId,
                operatorUserId: currentUserId,
                workspaceId,
              })
            : removeTrustRuleRow(cache, draft.userId)
        ),
      invalidate: () => [channelKeys.trust().all],
      settleWith: gate,
      onError: (err) => failed(err, "Couldn't update trust"),
    }
  );

  const consent = useApiMutationWith<
    ConsentDraft,
    { request: ChannelConsentRequest }
  >(channelRequest, {
    request: (draft) => ({
      path: `${CHANNEL_CONSENT_PATH}/${encodeURIComponent(draft.id)}`,
      method: "PATCH",
      workspaceId,
      body: { decision: draft.decision },
    }),
    optimistic: (draft) =>
      patchCache<ConsentCache>(channelKeys.consent().all, (cache) =>
        dropConsentRequest(cache, draft.id)
      ),
    invalidate: () => [channelKeys.consent().all],
    settleWith: gate,
    onError: (err) => failed(err, "Couldn't record decision"),
  });

  return { toolProfile, trust, consent };
}
