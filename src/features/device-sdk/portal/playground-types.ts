/** Wire shapes between the playground form and `POST /api/developers/playground`. Pure. */

export type HttpMethod = "GET" | "POST" | "DELETE";

export interface PlaygroundRun {
  request: {
    method: HttpMethod;
    /** `/v1/...` with query, as sent. */
    path: string;
    /** The Authorization header with the key masked (`Bearer sk_test_…abcd`). */
    authorization: string;
    idempotencyKey: string | null;
    body: unknown;
  };
  response: {
    status: number;
    requestId: string | null;
    durationMs: number;
    body: unknown;
  };
  /** The `dev_events` row the call wrote, or null (`GET /events` writes none). */
  event: unknown;
}

/** `sk_test_…` + its last 4: enough to tell keys apart, never enough to use one. */
export function maskKey(key: string): string {
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}
