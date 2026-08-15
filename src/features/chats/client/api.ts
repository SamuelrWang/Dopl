import { ApiError, apiRequest } from "@/shared/api/api-client";
import type { ApiRequestOpts } from "@/shared/api/api-envelope";
import type { ApiMutationRequestFn } from "@/shared/hooks/use-api-mutation";

/** Domain error wrapper so components can branch on `code`. */
export class ChatApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ChatApiError";
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
      throw new ChatApiError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/**
 * Transport for `useApiMutationWith`. ⚠ Writes MUST go through this, not raw
 * `apiRequest`: it throws {@link ChatApiError}, and the `err instanceof
 * ChatApiError` branch is what puts server wording in the toast (duplicate
 * folder 409, retention 402, not-owner 403). Reads stay on `useApiQuery`.
 * Paths live in `./query-keys.ts` beside the cache keys built from them.
 */
export const chatRequest: ApiMutationRequestFn = request;
