import "server-only";

/**
 * Base URL for the in-app MCP server's `/api/*` loopback calls (carries caller's credential).
 *
 * ⚠ Use the EXACT arrival host, NOT NEXT_PUBLIC_APP_URL: that env points at the apex
 * (usedopl.com), which 307s to www, and `fetch` DROPS Authorization across a host change —
 * 401ing every loopback call.
 */
export function appBaseUrl(request: Request): string {
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  }
  try {
    return new URL(request.url).origin;
  } catch {
    return process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  }
}
