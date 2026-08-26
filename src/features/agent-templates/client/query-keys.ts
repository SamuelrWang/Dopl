import { apiResource, type ApiResourceKeys } from "@/shared/api/query-keys";

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

export const agentTemplateKeys = {
  /** The list read every section on the page renders from. */
  list: (): ApiResourceKeys => apiResource(agentTemplatesPath()),
};
