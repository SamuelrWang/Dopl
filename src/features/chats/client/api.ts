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
 * The feature's transport, as `useApiMutationWith` consumes it.
 *
 * The mutation layer is transport-injected precisely so a feature can hand it
 * the client it already had: every chat write driven through this one still
 * throws {@link ChatApiError}, so the `err instanceof ChatApiError` branch
 * that puts the server's own wording in the toast (the duplicate-folder 409,
 * the retention 402, the not-owner 403) survives the move off hand-rolled
 * awaits. A mutation wired straight to `apiRequest` would quietly degrade
 * every chats error to its fallback string.
 *
 * READS do NOT go through here. They are `useApiQuery` over `apiRequest`, and
 * their only consumer treats the error as a boolean ("show the retry line"),
 * so wrapping them would buy nothing and fork the transport.
 *
 * Paths live in `./query-keys.ts` beside the cache keys built from them, so a
 * write and the read it patches cannot disagree about the URL.
 */
export const chatRequest: ApiMutationRequestFn = request;
