import {
  apiPathKey,
  apiQueryKey,
  type ApiQueryKeyOpts,
  type ApiQueryParams,
  type ApiResourceKeys,
} from "@/shared/api/query-keys";
import type { IdentityShelf } from "../types";

/**
 * The feature's URLs and cache keys in one module, so a write and the read it patches agree.
 * Writes patch the `entry({workspaceId})` key, not the `.all` prefix: one surface mounts two
 * workspaces' lists, and a prefix patch would leak a row into the other (F-331, INVARIANTS §8).
 * The shelf is part of the key and must match between the read and the write hooks.
 */

export function agentIdentitiesPath(): string {
  return "/api/agent-identities";
}

export function agentIdentityPath(identityId: string): string {
  return `${agentIdentitiesPath()}/${encodeURIComponent(identityId)}`;
}

/** The list read's `query` for one shelf; "both shelves" is `undefined`, never `{}` (another cache entry). */
export function identityListQuery(shelf?: IdentityShelf): ApiQueryParams {
  return shelf ? { shelf } : undefined;
}

export const agentIdentityKeys = {
  /** The list read for one shelf; `entry()` ignores a caller `query` — the shelf is the only variant. */
  list: (shelf?: IdentityShelf): ApiResourceKeys => {
    const path = agentIdentitiesPath();
    const query = identityListQuery(shelf);
    return {
      path,
      all: apiPathKey(path),
      entry: (opts: ApiQueryKeyOpts = {}) =>
        apiQueryKey(path, { workspaceId: opts.workspaceId, query }),
    };
  },
};
