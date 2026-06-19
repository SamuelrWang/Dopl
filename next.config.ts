import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Expose the Google OAuth client ID to the browser for Google One Tap. The
   * client ID is not a secret (One Tap embeds it in the page), so we alias the
   * existing server-side GOOGLE_CLIENT_ID into the NEXT_PUBLIC_ name the One Tap
   * component reads — no duplicate Vercel env needed. Empty when unset → One Tap
   * stays disabled.
   */
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID:
      process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "",
  },
  /**
   * Keep the workspace MCP packages external (require()'d from node_modules
   * at runtime) rather than bundled. They ship pre-compiled `dist/` and
   * `@dopl/mcp-server` reads its own package.json at runtime (version.ts),
   * which breaks if bundled. The remote MCP route (src/app/api/mcp) imports
   * `@dopl/mcp-server/factory`. NOTE: verify a clean Vercel build — symlinked
   * workspace packages must be traced into the serverless bundle.
   */
  serverExternalPackages: [
    "@dopl/mcp-server",
    "@dopl/client",
    "@modelcontextprotocol/sdk",
  ],
  /**
   * Serve OAuth/MCP discovery metadata at its spec path. A normal API route
   * (/api/oauth-protected-resource) backs it, rewritten from the well-known
   * path to sidestep Next's dot-directory routing ambiguity. Stage 3 adds the
   * authorization-server metadata the same way.
   */
  async rewrites() {
    return [
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-authorization-server",
        destination: "/api/oauth-authorization-server",
      },
    ];
  },
};

export default nextConfig;
