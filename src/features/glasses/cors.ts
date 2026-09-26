/**
 * CORS for the device-facing routes (`/api/glasses/device/*`, `/api/glasses/hey-even*`).
 *
 * DEFAULT `Access-Control-Allow-Origin: *`, and that is safe here: every device
 * route authenticates ONLY by a bearer credential (device token, Hey Even key,
 * pairing poll secret) that the page itself must hold and send. No cookie or
 * ambient credential is ever read, and `*` forbids credentialed requests anyway,
 * so a foreign origin gains nothing it did not already have. The Even Hub
 * WebView's production origin is undocumented, so a narrower list would block
 * the real plugin. `GLASSES_PLUGIN_ORIGINS` (comma-separated exact origins) is
 * an optional override for defense in depth.
 */

export const DEFAULT_PLUGIN_ORIGINS = ["*"] as const;

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
