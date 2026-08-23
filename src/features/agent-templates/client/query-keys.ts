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
 * Writes patch by the PREFIX key (`.all`), which reaches every workspace
 * variant a reader may have mounted without the writer having to enumerate
 * them.
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
