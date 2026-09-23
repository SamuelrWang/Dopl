import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import type { ApiMutationRequestFn } from "@/shared/hooks/use-api-mutation";

/**
 * THE feature's transport, and nothing else.
 *
 * ⚠ NO PER-VERB WRAPPERS. Every write on this page is a `useApiMutation` config
 * that owns its request AND the cache patch the same draft produces
 * (`../hooks/use-agent-template-writes.ts`); a `createTemplate()` helper beside
 * them would be a SECOND place the body is built, and the two would drift the
 * first time a field was added. Whoever owns the cache owns the call — the
 * channels client's rule, for the same reason.
 *
 * ⚠ Paths and cache keys live in `./query-keys.ts`, never here.
 */

/** Domain error wrapper so the editor can put the server's own wording on screen. */
export class AgentTemplateApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AgentTemplateApiError";
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
      throw new AgentTemplateApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/**
 * The transport as `useApiMutationWith` consumes it.
 *
 * ⚠ MODULE-LEVEL so the reference is stable across renders — the hook memoizes
 * its options on it, and a fresh function each render rebuilds them every time.
 *
 * ⚠ Every write driven through this throws {@link AgentTemplateApiError}, so the
 * `err instanceof AgentTemplateApiError` branch that surfaces the server's
 * message keeps working. A mutation wired straight to `apiRequest` silently
 * degrades every error on this page to its fallback string.
 */
export const agentTemplateRequest: ApiMutationRequestFn = request;

/**
 * Human copy for anything a write threw.
 *
 * ⚠ DELETE MAY 403 FOR AN AGENT TOKEN (the route is session-only). This page is
 * always a session — the SPA authenticates with the user's session JWT — so that
 * branch is unreachable here and gets no special copy; a 403 that somehow
 * arrived would render the server's own sentence, which is the honest answer.
 */
export function agentTemplateErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof AgentTemplateApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
