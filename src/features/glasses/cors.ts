/**
 * CORS for the device-facing routes (`/api/glasses/device/*`, `/api/glasses/hey-even*`).
 *
 * ⚠ DEFENSE IN DEPTH, NOT THE GATE. Every device route authenticates by a
 * bearer credential (device token or Hey Even key) that a browser never sends
 * on its own, so a foreign origin gains nothing even if it is allowed. The
 * allowlist only keeps other pages from reading responses.
 *
 * The Even Hub WebView's production origin is not documented, so the list is
 * configuration: `GLASSES_PLUGIN_ORIGINS` (comma-separated exact origins; `*`
 * allows any). Unset → the local simulator origins below.
 */

export const DEFAULT_PLUGIN_ORIGINS = ["http://127.0.0.1:5180", "http://localhost:5180"] as const;

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
  if (origin && (allowed.includes("*") || allowed.includes(origin))) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
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
