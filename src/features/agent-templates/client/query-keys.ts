import {
  apiPathKey,
  apiQueryKey,
  type ApiQueryKeyOpts,
  type ApiQueryParams,
  type ApiResourceKeys,
} from "@/shared/api/query-keys";
import type { TemplateShelf } from "../types";

/**
 * The feature's URLs and the cache keys built from them, in ONE module — so a
 * write and the read it patches cannot disagree about either (the channels
 * client's rule, `features/channels/client/query-keys.ts`).
 *
 * ⚠ Never hand-type the tuple at a call site. `useApiQuery` registers
 * `[path, workspaceId, query]`; a key that drifts by one character is a SILENT
 * no-op — the patch lands in an entry no observer is subscribed to, the screen
 * does not change, and nothing fails.
 *
 * ⚠ **WRITES ON THIS PATH PATCH THE `entry({workspaceId})` KEY, NOT THE `.all`
 * PREFIX — F-331, and it is the opposite of the tree's usual default.** The
 * prefix is right when a writer cannot know which VARIANTS of its own workspace
 * a reader mounted (`?include=archived`); it is WRONG here, because the variant
 * axis on this path is the WORKSPACE ITSELF and one surface mounts two of them
 * (the /home Agents tab: a channel container and the home workspace, side by
 * side). A prefix patch reaches both, so a template created in one appears
 * under the other. `useAgentTemplates` passes `{workspaceId, select}` and no
 * `query`, so `entry({workspaceId})` is `[path, workspaceId, undefined]` —
 * EXACTLY the tuple the read registers. See `../hooks/use-agent-template-writes.ts`
 * and INVARIANTS §8.
 */

export function agentTemplatesPath(): string {
  return "/api/agent-templates";
}

export function agentTemplatePath(templateId: string): string {
  return `${agentTemplatesPath()}/${encodeURIComponent(templateId)}`;
}

/**
 * The `query` half of the list read, for one shelf. ⚠ `undefined` (NOT `{}`) for
 * "both shelves" — that is what `useApiQuery` registers when no `query` is
 * passed, and `{}` would be a different tuple element and therefore a different
 * cache entry.
 */
export function templateListQuery(shelf?: TemplateShelf): ApiQueryParams {
  return shelf ? { shelf } : undefined;
}

export const agentTemplateKeys = {
  /**
   * The list read every section on the page renders from, for ONE shelf.
   * ⚠ `entry()` here IGNORES a caller-supplied `query` on purpose: the shelf
   * argument is the only variant axis this path has, and letting a call site
   * pass its own would put the two spellings back in two places.
   */
  list: (shelf?: TemplateShelf): ApiResourceKeys => {
    const path = agentTemplatesPath();
    const query = templateListQuery(shelf);
    return {
      path,
      all: apiPathKey(path),
      entry: (opts: ApiQueryKeyOpts = {}) =>
        apiQueryKey(path, { workspaceId: opts.workspaceId, query }),
    };
  },
};
