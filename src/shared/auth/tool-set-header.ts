/**
 * `X-Dopl-Tool-Set` (else `?tools=`, for clients that cannot set headers) — which tool NAMES a
 * connection wants. A naming choice, never an authorization signal: every set runs the same gates.
 * Passed verbatim; `@dopl/mcp-server › tool-manifest.ts › resolveToolSet` owns the vocabulary and
 * the default, so it is not restated here.
 */

export const TOOL_SET_HEADER = "x-dopl-tool-set";

export function readToolSetClaim(request: Request): string | undefined {
  const header = request.headers.get(TOOL_SET_HEADER);
  if (header !== null) return header;
  try {
    return new URL(request.url).searchParams.get("tools") ?? undefined;
  } catch {
    return undefined;
  }
}
