import { userFacingMessage } from "@/shared/api/user-facing-message";
import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import type { ApiMutationRequestFn } from "@/shared/hooks/use-api-mutation";

/**
 * The feature's transport only. No per-verb wrappers: each write's mutation config owns its request
 * and its cache patch (`../hooks/use-agent-identity-writes.ts`); paths and keys are `./query-keys.ts`.
 */

/** Domain error wrapper so the editor can put the server's own wording on screen. */
export class AgentIdentityApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AgentIdentityApiError";
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
      throw new AgentIdentityApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/**
 * The transport as `useApiMutationWith` consumes it — module-level so the reference is stable, and
 * throwing {@link AgentIdentityApiError} so the server's wording reaches the screen.
 */
export const agentIdentityRequest: ApiMutationRequestFn = request;

/** Human copy for anything a write threw — the server's own 4xx sentence when there is one. */
export function agentIdentityErrorMessage(err: unknown, fallback: string): string {
  return userFacingMessage(err, fallback);
}
