import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import type { ApiMutationRequestFn } from "@/shared/hooks/use-api-mutation";
import { channelPath, channelsPath } from "./query-keys";
import type { Channel, ChannelMember, ChannelVisibility } from "../types";

/** Domain error wrapper so components can branch on `code`. */
export class ChannelApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ChannelApiError";
  }
}

type RequestOpts = Pick<
  ApiRequestOpts,
  "workspaceId" | "body" | "method" | "query" | "expectedUpdatedAt"
>;

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, opts);
  } catch (err) {
    if (err instanceof ApiError) {
      throw new ChannelApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/**
 * The feature's transport, as `useApiMutationWith` consumes it.
 * ⚠ Every write driven through this still throws {@link ChannelApiError}, so the
 * `err instanceof ChannelApiError` branch that puts the server's own wording in
 * the toast keeps working. A mutation wired straight to `apiRequest` silently
 * degrades every channels error to its fallback string.
 */
export const channelRequest: ApiMutationRequestFn = request;

// ⚠ Paths live in `./query-keys.ts` beside the cache keys built from them, so a
// write and the read it patches cannot disagree about the URL. The re-export that
// stood here had no importer — callers take `channelPath` from `./query-keys`
// directly, which is the shorter path to the same rule.

/**
 * Create-channel body: normal (`name`, …) OR direct (`direct: true` +
 * `memberUserId`). The server dedups a repeat DM and returns the existing one.
 */
export type ChannelCreateBody =
  | {
      name: string;
      slug?: string;
      topic?: string;
      visibility?: ChannelVisibility;
      direct?: false;
    }
  | { direct: true; memberUserId: string };

export async function createChannel(
  body: ChannelCreateBody,
  workspaceId: string
): Promise<Channel> {
  const data = await request<{ channel: Channel }>(channelsPath(), {
    method: "POST",
    body,
    workspaceId,
  });
  return data.channel;
}

// ⚠ NO `postMessage` wrapper and no `PostMessageBody`. `POST /messages` is driven
// by the SEND MUTATION (`hooks/use-thread-writes.ts`), which owns the request
// shape because it owns the cache patch the same draft produces. A wrapper is a
// second place to build the body and a second thing to keep in step with
// `clientMsgId`. Whoever owns the cache owns the call.
//
// ⚠ AND NO `updateChannel` / `deleteChannel` EITHER, for exactly that reason —
// both stood here until 2026-08-20 with no importer. `PATCH` and `DELETE` on a
// channel are driven by `hooks/use-channel-lifecycle-writes.ts`, which builds them
// from `channelRequest` + `channelPath` because it owns the cache patches they
// produce. They were a second route to two endpoints this file's own rule says
// belong to the mutation, and `ChannelPatch` went with them.

export async function addChannelMember(
  channelId: string,
  userId: string,
  workspaceId: string
): Promise<ChannelMember> {
  const data = await request<{ member: ChannelMember }>(
    channelPath(channelId, "/members"),
    { method: "POST", body: { userId }, workspaceId }
  );
  return data.member;
}

export async function removeChannelMember(
  channelId: string,
  userId: string,
  workspaceId: string
): Promise<void> {
  await request<void>(channelPath(channelId, "/members"), {
    method: "DELETE",
    body: { userId },
    workspaceId,
  });
}

// NO MEMBER-PREFERENCE WRAPPERS. `PATCH /members` (notify scope, agent tool profile) is driven
// by `hooks/use-channel-preference-writes.ts`, for the reason above — those two writes are
// optimistic, so their request and their cache patch are one decision.

// ─── Threads ────────────────────────────────────────────────────────
//
// THE CLIENT BOUNDARY: wire/storage name `task` == domain name `thread`. The
// route segment (`/tasks`) and the response envelope keys (`tasks` / `task`)
// are STORAGE names and stay put — renaming them means a migration plus every
// read and write path. Every function below hands the rest of the web a
// `thread`.

// NO `listChannelThreads` WRAPPER. `GET /tasks` is read by `use-channel-threads.ts` through
// `useApiQuery`, which owns the cache key; the bare wrapper here had no caller and would have
// been a read the cache never sees. Same reasoning as the agents roster below.

// NO `createChannelThread` / `closeChannelThread` / `reopenChannelThread` WRAPPERS either.
// `POST /tasks` and `PATCH /tasks/[taskId]` are the thread half of `use-thread-writes.ts`:
// the create carries the `clientMsgId` that makes a resend return the ALREADY-created thread
// instead of double-spawning the responder's window, and the close/reopen patches the thread
// row that IS the transcript's status overlay. Neither is expressible as a bare call.

// NO `setChannelThreadMode` WRAPPER. `PATCH {op:"set_mode"}` is an MCP/desktop act — the web
// thread panel offers close and reopen and nothing else — so the wrapper had no caller. The
// route and `@dopl/client.setChannelThreadMode` are untouched.

// ─── Agents ─────────────────────────────────────────────────────────
//
// NO WRAPPERS, and that is the whole entry. `POST /agents` (summon) and
// `PATCH /agents/[agentId]` (rename / set_status / disengage) had one each, and
// the routes are gone with named agents (rollback §1).
//
// One route survives, `GET /api/channels/[channelId]/agents -> { agents }`, the
// historical attribution roster — and ⚠ **it has NO CLIENT CALLER since the v2
// cutover (2026-08-18)**: `use-channel-agents.ts` was its only one and went with
// `channel-transcript.tsx`, the surface that rendered the handles. Filed as
// F-218. It still has no wrapper here, and adding one would not give it a
// reader; a read that bypasses `useApiQuery` is a read the cache never sees.

// ─── Consent ────────────────────────────────────────────────────────

// NO `listConsentRequests` WRAPPER — the consent inbox is a `useApiQuery` read like the
// rosters, so the cache owns the key; only the DECIDE write goes through here.

// NO `decideConsent` WRAPPER — `PATCH /consent/[id]` is a preference write like the two above,
// and dropping the row from the inbox cache IS the decided state.

// ─── Trust ──────────────────────────────────────────────────────────

// NO `listTrustRules` WRAPPER — same reason as the consent inbox: the standing rules are a
// `useApiQuery` read, and only the add / delete writes go through here.

// NO `addTrustRule` / `removeTrustRule` WRAPPERS — same: `hooks/use-channel-preference-writes.ts`
// adds or removes the rule ROW in the cache, so it builds the request beside the patch.
