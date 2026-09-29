import { HttpError } from "@/shared/lib/http-error";

/**
 * HTTP for the device-facing routes (`/api/glasses/device/*`, `/api/glasses/hey-even*`).
 *
 * CORS defaults to `Access-Control-Allow-Origin: *`, which is safe here: every
 * device route authenticates ONLY by a bearer credential the page itself must
 * hold and send, no cookie or ambient credential is ever read, and `*` forbids
 * credentialed requests anyway. The plugin WebView's production origin is
 * undocumented, so a narrower default would block the real plugin.
 * `GLASSES_PLUGIN_ORIGINS` (comma-separated exact origins) narrows it.
 */

const DEFAULT_PLUGIN_ORIGINS = ["*"] as const;

export function pluginOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.GLASSES_PLUGIN_ORIGINS;
  if (raw === undefined || raw.trim() === "") return [...DEFAULT_PLUGIN_ORIGINS];
  return raw
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function corsHeaders(request: Request, allowed: string[] = pluginOrigins()): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (allowed.includes("*")) headers["Access-Control-Allow-Origin"] = "*";
  else if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
  });
}

/** A JSON request body, or a 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "body must be JSON");
  }
}

/** The bearer value of an `Authorization` header, or null. */
export function bearerOf(request: Request): string | null {
  const value = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return value ? value : null;
}
