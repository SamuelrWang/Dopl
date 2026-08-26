/**
 * WRITE-GATE REGRESSION TRIPWIRE. Every `route.ts` under `src/app/api` exporting
 * a non-GET handler must either route through `withUserAuth` /
 * `withWorkspaceAuth` / `withMcpAccess` (auto-gated by the method gate) or
 * appear on the EXEMPT allowlist with a reason — so no write route silently
 * escapes and a new exemption is a reviewed choice.
 *
 * Mirrors the MCP-side parity tripwire
 * (packages/mcp-server/src/tools/parity.test.ts): MCP `WRITE_OPS` and the REST
 * method gate are independent and both must hold.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ChannelUpdateSchema } from "@/features/channels/schema";

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
 * Source with comments removed.
 *
 * ⚠ THE SET PINS BELOW ARE REGEXES OVER TEXT: a route whose DOCBLOCK quotes
 * `sessionOnly: true` stays on the list after the real option is deleted, and
 * the suite stays green. Stripping comments first makes the pin read the CODE.
 *
 * Deliberately naive (no string/regex-literal awareness) — over route files, an
 * option name inside a string literal would itself be the bug.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function code(file: string): string {
  return withoutComments(readFileSync(file, "utf8"));
}

/** Non-GET routes that legitimately bypass the method gate — each carries its
 *  own auth model. ⚠ Keep minimal and reasoned. */
const EXEMPT: Record<string, string> = {
  "mcp/route.ts":
    "MCP JSON-RPC transport (authenticateMcpRequest). A read op arrives as a POST envelope; writes are scope-gated per-op by WRITE_OPS in the mcp-server. Must NOT be method-gated.",
  "oauth/token/route.ts": "OAuth AS token endpoint (PKCE) — authorization server, not resource server.",
  "oauth/revoke/route.ts": "OAuth AS revoke (RFC 7009) — token-authenticated, no user bearer.",
  "oauth/register/route.ts": "OAuth AS dynamic client registration — public per spec.",
  "oauth/authorize/route.ts": "OAuth AS authorize/consent endpoint.",
  "billing/webhook/route.ts": "Stripe webhook — authenticated by Stripe signature, not a user bearer.",
  "playground/session/route.ts":
    "Anonymous playground provisioning — the audience has no account by definition. Per-IP rate-limited in the service; creates only its own throwaway guest user/workspace/token.",
  "playground/mcp/[token]/route.ts":
    "The /api/mcp transport under a URL-embedded bearer (desktop MCP clients cannot send headers). Delegates to mcp/route.ts, which authenticates via authenticateMcpRequest — same exemption rationale as mcp/route.ts.",
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

  /** ⚠ Both entries are MCP PLUMBING, not content writes — the property this
   *  pin protects. `writeScopeExempt` on a user-data write would let a
   *  `dopl.read`-only token mutate the workspace. */
  it("the `writeScopeExempt` set is EXACTLY the MCP liveness ping + the credit spend", () => {
    const exemptRoutes = files
      .filter((f) => /writeScopeExempt:\s*true/.test(code(f)))
      .map(apiRel)
      .sort();
    expect(exemptRoutes).toEqual([
      "mcp/credits/consume/route.ts",
      "user/mcp-status/route.ts",
    ]);
  });

  it("the `sessionOnly` set is exactly the destructive admin + credential-minting + consent routes", () => {
    const sessionOnlyRoutes = files
      .filter((f) => /sessionOnly:\s*true/.test(code(f)))
      .map(apiRel)
      .sort();
    expect(sessionOnlyRoutes).toEqual(
      [
        // DELETE hard-deletes an agent template (2026-08-22). Permanent — no
        // trash, no restore — and a `team`/`workspace` template may be what a
        // whole team spawns from, so the blast radius is other people's
        // tooling, not the caller's own row. An agent token has no confirm
        // dialog to gate it: the same argument the team DELETE and the thread
        // DELETE below carry. ⚠ Per-METHOD, and the OTHER TWO ARE THE POINT —
        // GET and PATCH on that file stay ungated, because an ORCHESTRATOR
        // AGENT LISTING AND EDITING TEMPLATES IS THE FEATURE. Narrowing this
        // route to `sessionOnly` wholesale would gate the thing it exists for.
        "agent-templates/[templateId]/route.ts",
        // POST mints a 90-day device token, DELETE revokes one — an agent must
        // never bootstrap a fresh credential for itself, nor kill the one its
        // siblings depend on.
        "auth/mcp-device-token/route.ts",
        // Cancel writes on our own route (no Stripe-hosted click-through).
        "billing/cancel/route.ts",
        "billing/checkout/route.ts",
        // The consent gate keeps a HUMAN in the loop. PATCH records the
        // operator's Send / Cancel on their OWN agent's drafted reply; reachable
        // by an agent token, a contained session reads its bearer off disk and
        // self-approves its reply out of the machine.
        // ⚠ `channels/trust/route.ts` STOOD BESIDE IT AND IS DELETED
        // (2026-08-22, Samuel). Standing consent ("always allow Alice's agent")
        // auto-allowed INBOUND requests, and the inbound lane is retired — the
        // two routes, `trust-service.ts`, the repository reads and the
        // `agent_trust_rules` table all go together
        // (`20260822140000_retire_inbound_consent_and_trust.sql`). ⚠ NARROWING THIS SET
        // IS THE EXACT MOVE THIS FILE EXISTS TO CATCH, so it is a deliberate
        // edit, and it is safe for ONE reason only: the route is GONE, not
        // ungated. If `src/app/api/channels/trust/` ever comes back, it comes
        // back with `sessionOnly` and comes back to this list first.
        "channels/consent/[id]/route.ts",
        // PATCH writes `agentToolProfile` and `favorite` (2026-08-19). The
        // profile is a CONTAINMENT control: a Bash-capable session could
        // otherwise read its own bearer off disk and durably re-widen its own
        // profile. The favourite is the operator's own sidebar shortcut list,
        // which an agent has no business writing either — so the second field
        // did NOT turn this into a field gate. GET and member add/remove on that
        // file stay ungated.
        "channels/[channelId]/members/route.ts",
        // DELETE hard-deletes a thread and cascades its whole transcript
        // (2026-08-21). Permanent, SHARED with the other party, and an agent
        // token has no confirm dialog to gate it — the same argument the team
        // DELETE below carries. ⚠ Per-METHOD: GET and the set-mode PATCH on that
        // file stay ungated.
        "channels/[channelId]/tasks/[taskId]/route.ts",
        // HOME CHANNELS (2026-08-23), same credential class as
        // `workspaces/[workspaceSlug]/join-link` above: POST mints the claim
        // URL, DELETE revokes it, and the claim SPENDS one — the outcome of
        // which is a workspace membership. GET on the links file stays ungated
        // (`sessionOnly` is per-method), so an agent can still read the
        // caller's own pending links.
        "home/link/[token]/claim/route.ts",
        "home/links/[linkId]/route.ts",
        "home/links/route.ts",
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
        // DELETE drops the team, cascading members and every resource grant.
        // Permanent, and an agent token has no dialog to gate it.
        "workspaces/[workspaceSlug]/teams/[teamId]/route.ts",
      ].sort()
    );
  });

  /**
   * ⚠ `sessionOnly` is a wrapper option, therefore per-METHOD. A route whose one
   * method carries several writes gates the FIELD instead, in the handler, via
   * `SESSION_ONLY_FIELDS` — invisible to the pin above (no `sessionOnly: true`
   * in the file), so it needs its own pin or a shrinking set reads as healthy.
   */
  it("the FIELD-level session gate is exactly the channel visibility write", () => {
    const fieldGated = files
      .filter((f) => /SESSION_ONLY_FIELDS/.test(code(f)))
      .map(apiRel)
      .sort();
    expect(fieldGated).toEqual(["channels/[channelId]/route.ts"]);

    // ⚠ A `SESSION_ONLY_FIELDS` that nothing reads would satisfy the file list
    // above while gating nothing.
    const src = readFileSync(
      path.join(API_ROOT, "channels/[channelId]/route.ts"),
      "utf8"
    );
    expect(src).toMatch(/SESSION_ONLY_FIELDS\s*=\s*\[\s*"visibility"\s*\]/);
    expect(src).toMatch(/auth\.agentTokenId/);
    expect(src).toMatch(/SESSION_REQUIRED/);
  });

  /**
   * ⚠ THE FULL FIELD SET, PINNED SO A SIXTH LANDS UNGATED VISIBLY. The route's
   * field gate names only `visibility`; the service derives the MANAGE set by
   * SUBTRACTION and leaves `infoCard` alone. Both are correct only while the
   * schema's fields are EXACTLY these five — a sixth added to
   * `ChannelUpdateSchema` would silently inherit the loose (member) gate unless
   * somebody decides otherwise. This asserts the set against the real schema, so
   * that decision cannot be skipped. (A pin on a symbol is not a pin — INVARIANTS
   * §14 — so it reads the schema's own shape.)
   */
  it("ChannelUpdateSchema's fields are EXACTLY the five gated ones", () => {
    // zod 4: `.refine()` adds a check to the same object type, so `.shape` is the
    // object's own field map (no ZodEffects wrapper to unwrap).
    expect(Object.keys(ChannelUpdateSchema.shape).sort()).toEqual(
      ["archived", "infoCard", "name", "topic", "visibility"].sort()
    );
  });
});
