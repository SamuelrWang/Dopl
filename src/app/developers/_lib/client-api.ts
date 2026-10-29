/**
 * The portal's client calls to `/api/developers/*`. Same-origin, cookie session. A non-2xx answer
 * throws an Error carrying the server's own message (the route's `{ error: { message } }`), so a
 * component shows exactly what the server refused.
 */
export async function portalCall<T = unknown>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok) throw new Error(json?.error?.message ?? "Something went wrong. Try again.");
  return json as T;
}

export const errorText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
