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
  channelKeys,
  channelMembersPath,
} from "../client/query-keys";
import {
  dropConsentRequest,
  setFavorite,
  setToolProfile,
  setUnaddressedResponder,
  type ChannelsCache,
  type ConsentCache,
  type MembersCache,
} from "../lib/optimistic-cache";
import type { UnaddressedResponderSetting } from "../lib/agent-mentions";
import type {
  AgentToolProfile,
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
 * unarchived list variants — `.all` is a prefix key); a consent decision drops
 * the request, because the inbox holds only `pending` rows and dropping it IS
 * the decided state.
 *
 * ⚠ THE COUNT IS THREE AND IT HAS MOVED TWICE — read the returns, not this
 * paragraph. It was four until 2026-08-08, when notify scope left the product
 * (F-170); four again from 2026-08-19, when the channel FAVOURITE joined on the
 * tool profile's own route (`PATCH /members`, whose schema carries `favorite`);
 * **three since 2026-08-22, when TRUST was deleted** with the inbound consent
 * lane it was the standing-consent shortcut for (Samuel). Its mutation, its
 * `addTrustRuleRow` / `removeTrustRuleRow` cache patch, `useTrustRules` and the
 * `/api/channels/trust` client path went together, exactly as notify scope's set
 * did.
 */

/**
 * ⚠ `currentUserId` LEFT THIS SHAPE ON 2026-08-22, and its absence is the point.
 * Its ONLY reader was the trust mutation's optimistic row — `addTrustRuleRow`
 * needed an `operatorUserId` to build a valid `AgentTrustRule` — and trust went
 * with the inbound consent lane. None of the three surviving writes has any
 * business knowing WHO the caller is: `toolProfile` and `favorite` write
 * `ctx.userId`'s own membership row with no member field in the body, and
 * `consent` is CAS'd against a row already scoped to `(operator, workspace)`.
 * **Do not add it back for convenience** — a hook that takes an identity it does
 * not use invites a caller to point a write at somebody else.
 */
export interface PreferenceWritesParams {
  workspaceId: string;
  gate: MutationGate;
}

function failed(err: unknown, fallback: string) {
  toast({ title: err instanceof ChannelApiError ? err.message : fallback });
}

export interface ToolProfileDraft {
  channelId: string;
  profile: AgentToolProfile;
}
/**
 * ⚠ **NO MEMBER IN THE DRAFT, ON `FavoriteDraft`'s TERMS** (2026-09-07, items 10 and 11): the
 * route writes `ctx.userId`'s row and `ChannelMemberSelfUpdateSchema` carries no member field,
 * so there is nothing here for a caller to point somewhere else — and the optimistic patch
 * finds the viewer's row through the DTO's own privacy scrub rather than an id.
 *
 * ⚠ **THE DESIRED STATE, never a toggle verb** — two clicks racing must converge.
 */
export interface UnaddressedResponderDraft {
  channelId: string;
  setting: UnaddressedResponderSetting;
}
export interface ConsentDraft {
  id: string;
  decision: "allow" | "deny";
}
/** ⚠ The DESIRED state, never a "toggle" verb: two clicks racing must converge
 *  on the same answer, and a flip-relative write cannot. */
export interface FavoriteDraft {
  channelId: string;
  favorite: boolean;
}

export function useChannelPreferenceWrites({
  workspaceId,
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

  /**
   * FAVOURITE / UN-FAVOURITE the caller's own membership row.
   *
   * ⚠ NO MEMBER IN THE BODY, deliberately: the route writes `ctx.userId`'s row
   * and the schema carries no member field, so there is nothing here for a
   * caller to point somewhere else.
   *
   * ⚠ NO `coldKeys` (INVARIANTS §8 rule 1). The one surface this write feeds —
   * the sidebar's Favorites section — is a partition of the SAME channel list
   * the toggle was rendered from, so the cache is warm by construction: there is
   * no bookmark button to press on a channel list that never loaded.
   */
  const favorite = useApiMutationWith<FavoriteDraft, { member: ChannelMember }>(
    channelRequest,
    {
      request: (draft) => ({
        path: channelMembersPath(draft.channelId),
        method: "PATCH",
        workspaceId,
        body: { favorite: draft.favorite },
      }),
      optimistic: (draft) =>
        patchCache<ChannelsCache>(channelKeys.list().all, (cache) =>
          setFavorite(cache, draft.channelId, draft.favorite)
        ),
      invalidate: () => [channelKeys.list().all],
      settleWith: gate,
      onError: (err) => failed(err, "Couldn't update favourites"),
    }
  );

  /**
   * **WHO ANSWERS THE CALLER'S OWN UNADDRESSED MESSAGES HERE** (2026-09-07, Samuel's ruling on
   * items 10 and 11) — the per-member replacement for the room-wide default responder.
   *
   * ⚠ **IT IS ON `PATCH /members` RATHER THAN `PATCH /channels/[id]`, WHICH IS THE RULING AND
   * NOT A ROUTING CHOICE.** The old field was a MANAGER's decision about everybody; this one is
   * a member's decision about themselves, so it rides the route whose schema carries no member
   * identifier at all. ⚠ It also inherits that route's `sessionOnly: true` — the protection the
   * deleted field had as a `SESSION_ONLY_FIELDS` entry is kept, not dropped: an agent
   * credential still cannot set who answers its operator's untagged messages.
   *
   * ⚠ **IT PATCHES THE ROSTER, NOT THE CHANNEL LIST**, unlike the two writes above — the value
   * lives on the member row, and it is the roster the composer's recipient line reads. That is
   * also why the paint is worth having: the line must stop naming an agent the instant "No one"
   * is chosen, or the control and the prediction contradict each other on screen.
   */
  const unaddressedResponder = useApiMutationWith<
    UnaddressedResponderDraft,
    { member: ChannelMember }
  >(channelRequest, {
    request: (draft) => ({
      path: channelMembersPath(draft.channelId),
      method: "PATCH",
      workspaceId,
      body: { unaddressedResponder: draft.setting },
    }),
    optimistic: (draft) =>
      patchCache<MembersCache>(channelKeys.members(draft.channelId).all, (cache) =>
        setUnaddressedResponder(cache, draft.setting)
      ),
    invalidate: (draft) => [channelKeys.members(draft.channelId).all],
    settleWith: gate,
    onError: (err) => failed(err, "Couldn't update who answers you"),
  });

  /**
   * SEND OR CANCEL an outbound draft — the CAS'd `PATCH /consent/[id]`.
   *
   * ⚠ ITS INBOUND CALLERS ARE GONE (Samuel, 2026-08-22). The transcript card's
   * Decline / Launch agent pair, `thread-consent.tsx › ThreadAwaitingStrip` and
   * the Inbox's inbound rows all fired this mutation against an INBOUND row;
   * that lane is retired. The mutation itself is unchanged and is NOT
   * kind-scoped — the wire shape is the server's, `"allow"` / `"deny"` are the
   * same two values, and its callers only ever hand it an outbound id because
   * that is all any of them read.
   *
   * ⚠ THE SURFACES MOVED AGAIN ON 2026-08-25 (Samuel — INVARIANTS §6). The Inbox
   * pane is DELETED; the mutation's callers are now `thread-consent.tsx ›
   * ThreadSendBox` (Send / Cancel, on the thread) and the work stream's held-draft
   * card (`channels-v2/agent-stream.tsx › SentToChannelBox`), which sends `"allow"`
   * ONLY — Samuel's ruling gives that card one button. **`"deny"` is deliberately
   * still on this mutation and on the route**: the send box is the surviving
   * Cancel, and the desktop cancels its own row when a park closes the tool call.
   */
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

  // ⚠ THE COUNT IS FOUR SINCE 2026-09-07 — read the return, not the header paragraph.
  return { toolProfile, favorite, unaddressedResponder, consent };
}
