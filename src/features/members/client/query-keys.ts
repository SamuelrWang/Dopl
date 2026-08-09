import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";
import type { TeamResourceType } from "@/features/teams/access-levels";

/**
 * The members console's URLs and the cache keys built from them, in one place —
 * so a write and the read it patches can never disagree about either.
 *
 * Before this, six read hooks and `teams-client.ts` each rebuilt
 * `/api/workspaces/${encodeURIComponent(slug)}/…` by hand, and the one cache
 * write that existed (`use-join-requests`) re-typed the tuple `[path,
 * undefined, undefined]` at the call site. That is the exact silent-no-op shape
 * `shared/api/query-keys.ts` exists to prevent: a key that drifts by one
 * character lands in an entry no observer is subscribed to, the screen does not
 * change, and nothing fails.
 *
 * WRITES PATCH BY THE PREFIX (`.all`). TanStack matches keys per array element,
 * and a writer does not know which workspace scope / query-param variants a
 * reader mounted — the roster is read by the full console AND by the settings
 * modal's members tab, which mount independently.
 *
 * SCOPED BY WORKSPACE SLUG BY CONSTRUCTION: every key embeds the slug in its
 * path, so a write that captured the slug at submit time cannot land in another
 * workspace's cache after a switch.
 */

export function workspacePath(slug: string, tail = ""): string {
  return `/api/workspaces/${encodeURIComponent(slug)}${tail}`;
}

export function membersPath(slug: string): string {
  return workspacePath(slug, "/members");
}

export function memberPath(slug: string, userId: string): string {
  return `${membersPath(slug)}/${encodeURIComponent(userId)}`;
}

/** Server-resolved effective access for one member — its own cache entry. */
export function memberAccessPath(slug: string, userId: string): string {
  return `${memberPath(slug, userId)}/access`;
}

export function invitationsPath(slug: string): string {
  return workspacePath(slug, "/invitations");
}

export function invitationPath(slug: string, invitationId: string): string {
  return `${invitationsPath(slug)}/${encodeURIComponent(invitationId)}`;
}

export function teamsPath(slug: string): string {
  return workspacePath(slug, "/teams");
}

export function teamPath(slug: string, teamId: string): string {
  return `${teamsPath(slug)}/${encodeURIComponent(teamId)}`;
}

export function teamMembersPath(slug: string, teamId: string): string {
  return `${teamPath(slug, teamId)}/members`;
}

export function teamMemberPath(
  slug: string,
  teamId: string,
  userId: string
): string {
  return `${teamMembersPath(slug, teamId)}/${encodeURIComponent(userId)}`;
}

export function teamAccessPath(slug: string, teamId: string): string {
  return `${teamPath(slug, teamId)}/access`;
}

export function accessMatrixPath(slug: string): string {
  return workspacePath(slug, "/access-matrix");
}

export function joinRequestsPath(slug: string): string {
  return workspacePath(slug, "/join-requests");
}

export function joinRequestPath(slug: string, requestId: string): string {
  return `${joinRequestsPath(slug)}/${encodeURIComponent(requestId)}`;
}

export function joinLinkPath(slug: string): string {
  return workspacePath(slug, "/join-link");
}

/** A grant target, as both the access endpoints spell it. */
export interface ResourceRef {
  resourceType: TeamResourceType;
  resourceId: string;
}

export const memberKeys = {
  members: (slug: string): ApiResourceKeys => apiResource(membersPath(slug)),
  memberAccess: (slug: string, userId: string): ApiResourceKeys =>
    apiResource(memberAccessPath(slug, userId)),
  invitations: (slug: string): ApiResourceKeys =>
    apiResource(invitationsPath(slug)),
  teams: (slug: string): ApiResourceKeys => apiResource(teamsPath(slug)),
  accessMatrix: (slug: string): ApiResourceKeys =>
    apiResource(accessMatrixPath(slug)),
  joinRequests: (slug: string): ApiResourceKeys =>
    apiResource(joinRequestsPath(slug)),
  joinLink: (slug: string): ApiResourceKeys => apiResource(joinLinkPath(slug)),
};
