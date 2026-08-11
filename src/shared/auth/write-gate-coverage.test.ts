/**
 * H-3 REGRESSION TRIPWIRE — the load-bearing guard.
 *
 * The OAuth write-scope gate lives in `withUserAuth` and classifies writes by
 * HTTP method, so a NEW write route is covered automatically *as long as it
 * funnels through one of the auth wrappers*. This test enforces that invariant
 * statically: every route.ts under `src/app/api` that exports a non-GET handler
 * must either
 *   (a) route through `withUserAuth` / `withWorkspaceAuth` / `withMcpAccess`
 *       (auto-gated by the method gate), or
 *   (b) appear on the explicit EXEMPT allowlist below, with a reason.
 *
 * So a new write route can't silently escape the gate, and a new exemption is
 * a conscious, reviewed choice. It mirrors the MCP-side parity tripwire
 * (packages/mcp-server/src/tools/parity.test.ts): the two gates — MCP
 * `WRITE_OPS` and the REST method gate — are independent and both must hold.
 *
 * It also pins the `writeScopeExempt` set to exactly the MCP liveness ping, so
 * a stray exemption on a real content-write route trips the build.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const API_ROOT = path.join(process.cwd(), "src/app/api");

/** All `route.ts` files under src/app/api, keyed by api-relative posix path. */
function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...routeFiles(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

function apiRel(full: string): string {
  return path.relative(API_ROOT, full).split(path.sep).join("/");
}

const NON_GET_EXPORT =
  /export\s+(?:const|async\s+function)\s+(POST|PUT|PATCH|DELETE)\b/;
const USES_WRAPPER = /\b(withUserAuth|withWorkspaceAuth|withMcpAccess)\b/;

/**
 * Non-GET routes that legitimately bypass the `withUserAuth` method gate.
 * Each carries its own auth model — keep this list minimal and reasoned.
 */
const EXEMPT: Record<string, string> = {
  "mcp/route.ts":
    "MCP JSON-RPC transport (authenticateMcpRequest). A read op arrives as a POST envelope; writes are scope-gated per-op by WRITE_OPS in the mcp-server. Must NOT be method-gated.",
  "oauth/token/route.ts": "OAuth AS token endpoint (PKCE) — authorization server, not resource server.",
  "oauth/revoke/route.ts": "OAuth AS revoke (RFC 7009) — token-authenticated, no user bearer.",
  "oauth/register/route.ts": "OAuth AS dynamic client registration — public per spec.",
  "oauth/authorize/route.ts": "OAuth AS authorize/consent endpoint.",
  "billing/webhook/route.ts": "Stripe webhook — authenticated by Stripe signature, not a user bearer.",
};

const files = routeFiles(API_ROOT);

describe("H-3 write-gate coverage", () => {
  it("finds a non-trivial set of API routes (walk sanity check)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("every non-GET route is auto-gated (uses a wrapper) or explicitly EXEMPT", () => {
    const escaped: string[] = [];
    for (const full of files) {
      const rel = apiRel(full);
      const src = readFileSync(full, "utf8");
      if (!NON_GET_EXPORT.test(src)) continue; // read-only route file
      if (EXEMPT[rel]) continue; // conscious exemption
      if (USES_WRAPPER.test(src)) continue; // auto-gated
      escaped.push(rel);
    }
    expect(
      escaped,
      `these non-GET routes neither route through an auth wrapper nor are on the EXEMPT allowlist — ` +
        `they would escape the OAuth write-scope gate:\n  ${escaped.join("\n  ")}`
    ).toEqual([]);
  });

  it("every EXEMPT entry still exists and still exports a non-GET handler", () => {
    for (const rel of Object.keys(EXEMPT)) {
      const full = path.join(API_ROOT, rel);
      const src = readFileSync(full, "utf8");
      expect(NON_GET_EXPORT.test(src), `${rel} no longer has a non-GET export`).toBe(true);
    }
  });

  /**
   * TWO routes, and both are MCP PLUMBING rather than content writes — that is
   * the property this pin protects. A `writeScopeExempt` on a route that
   * writes user data would let a `dopl.read`-only token mutate the workspace.
   *
   * The credit spend earns it for the reason the ping does: it is a POST whose
   * subject is the SESSION, not the workspace's content, and a READ-ONLY agent
   * still costs a credit per tool call — gating it on `dopl.write` would make
   * read-only sessions free and leave the meter lying.
   */
  it("the `writeScopeExempt` set is EXACTLY the MCP liveness ping + the credit spend", () => {
    const exemptRoutes = files
      .filter((f) => /writeScopeExempt:\s*true/.test(readFileSync(f, "utf8")))
      .map(apiRel)
      .sort();
    expect(exemptRoutes).toEqual([
      "mcp/credits/consume/route.ts",
      "user/mcp-status/route.ts",
    ]);
  });

  it("the `sessionOnly` set is exactly the destructive admin + credential-minting + consent routes", () => {
    const sessionOnlyRoutes = files
      .filter((f) => /sessionOnly:\s*true/.test(readFileSync(f, "utf8")))
      .map(apiRel)
      .sort();
    expect(sessionOnlyRoutes).toEqual(
      [
        // POST mints a long-lived device token — a background agent must never
        // be able to bootstrap a fresh 90-day credential for itself (Channels
        // v1.1 section E). DELETE revokes one (F-085), gated for the mirror
        // reason: a bearer that could revoke device tokens could kill the
        // credential its sibling agents (or the operator's other machines)
        // depend on, and could delete the token whose last_used_at records it.
        // Both methods are cookie-session only.
        "auth/mcp-device-token/route.ts",
        "billing/checkout/route.ts",
        // Channels v1.2 H-1. The consent gate exists to keep a HUMAN in the
        // loop on a spawned agent that is processing an untrusted teammate's
        // message with Bash and a device token on disk. If that agent could
        // reach these, it could self-approve its own outbound review
        // (PATCH /consent/[id]) or grant itself permanent standing consent
        // (POST /trust) and never be asked again. Cookie sessions — the web
        // UI and the desktop app — are unaffected.
        "channels/consent/[id]/route.ts",
        "channels/trust/route.ts",
        // C-12 (Samuel 2026-08-10). `PATCH /channels/[channelId]/members`
        // writes `agentToolProfile` and, since F-170 removed notify scope,
        // NOTHING ELSE — so the whole method is gated. The profile is a
        // CONTAINMENT control, not a preference: a spawned agent holding the
        // desktop's device token and a `full` (Bash-capable) session could
        // otherwise read its own bearer off disk and durably re-widen its own
        // profile after the operator tightened it. Same threat model as the two
        // routes above; the GET and the member add/remove on that file stay
        // ungated (reads decide nothing, and invites are a separate decision).
        "channels/[channelId]/members/route.ts",
        "billing/portal/route.ts",
        "billing/upgrade-to-team/route.ts",
        "oauth/grants/[id]/route.ts",
        "user/delete/route.ts",
        "workspaces/[workspaceSlug]/access-matrix/route.ts",
        "workspaces/[workspaceSlug]/invitations/[id]/route.ts",
        "workspaces/[workspaceSlug]/invitations/route.ts",
        "workspaces/[workspaceSlug]/join-link/route.ts",
        "workspaces/[workspaceSlug]/join-requests/[requestId]/route.ts",
        "workspaces/[workspaceSlug]/members/[userId]/route.ts",
        "workspaces/[workspaceSlug]/route.ts",
        "workspaces/[workspaceSlug]/teams/[teamId]/access/route.ts",
        "workspaces/[workspaceSlug]/teams/[teamId]/members/[userId]/route.ts",
        "workspaces/[workspaceSlug]/teams/[teamId]/members/route.ts",
        // DELETE drops the team, cascading its members and every resource grant
        // it carried. Added 2026-08-07: it was the one access-control write
        // without the gate, so a write-scoped bearer that could not remove a
        // single member could still delete the team wholesale. Deletes are
        // permanent now, and an agent token has no dialog to gate it — the same
        // invariant the MCP delete block holds on its own surface.
        "workspaces/[workspaceSlug]/teams/[teamId]/route.ts",
      ].sort()
    );
  });

  /**
   * THE SECOND GRANULARITY, PINNED THE SAME WAY (C-13, 2026-08-10).
   *
   * `sessionOnly` is a wrapper option and therefore per-METHOD. A route whose
   * one method carries several writes — only some of which an agent may
   * legitimately make — gates the FIELD instead, in the handler, via a
   * `SESSION_ONLY_FIELDS` constant. That gate is invisible to the pin above
   * (there is no `sessionOnly: true` in the file), so it gets its own, or the
   * tripwire would report a shrinking set as healthy.
   *
   * ONE route qualifies today. Adding a second is a conscious edit here.
   */
  it("the FIELD-level session gate is exactly the channel visibility write", () => {
    const fieldGated = files
      .filter((f) => /SESSION_ONLY_FIELDS/.test(readFileSync(f, "utf8")))
      .map(apiRel)
      .sort();
    expect(fieldGated).toEqual(["channels/[channelId]/route.ts"]);

    // The constant names `visibility` and the refusal actually consults the
    // caller type — a `SESSION_ONLY_FIELDS` that nothing reads would satisfy
    // the file list above while gating nothing.
    const src = readFileSync(
      path.join(API_ROOT, "channels/[channelId]/route.ts"),
      "utf8"
    );
    expect(src).toMatch(/SESSION_ONLY_FIELDS\s*=\s*\[\s*"visibility"\s*\]/);
    expect(src).toMatch(/auth\.agentTokenId/);
    expect(src).toMatch(/SESSION_REQUIRED/);
  });
});
