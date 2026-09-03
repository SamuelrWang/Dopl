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
        // ── APP-ONLY DELETION, GIVEN A FENCE (2026-09-02) ──────────────────
        // Every `_admin` tool in `packages/mcp-server` serves the sentence
        // "Deletion is app-only … there is no MCP path to it, for any role or
        // token" (`delete-policy.ts › deleteAdminDescription`), and until this
        // wave `gating.ts › opRefusal` was the ONLY thing making it true. That
        // guards ONE door: the MCP server reaches the app over LOOPBACK HTTP,
        // a `full`-profile session has Bash and its own `dopl_at_*` bearer, and
        // each route below was `minRole: "member"` and nothing else — so the
        // agent just told "no role, scope or argument changes that" could
        // delete the row anyway. Samuel's ruling: a rule an agent is TOLD must
        // have a fence in the code, not only in the prompt.
        // ⚠ Per-METHOD throughout — the GETs and PATCHes stay ungated on
        // purpose, because editing and rewriting are exactly what
        // `DELETE_REFUSAL` redirects an agent to instead. Gating them would
        // gate the capability the refusal advertises as the alternative.
        // ⚠ `minRole` is UNCHANGED: this adds a caller-type gate, it does not
        // raise the role floor. A member still deletes — in the app.
        // ⚠ THE OP→ROUTE MAP IS `app-only-delete-gate.test.ts`, which fails
        // when a NEW `_admin` delete op ships with no route on this list.
        "chats/[chatId]/route.ts",
        "chats/folders/[folderId]/route.ts",
        // ⚠ `folders-by-path` IS THE SECOND DOOR ONTO THE SAME TWO ACTS and
        // the one easiest to miss: its `?path=` resolves to a folder OR an
        // entry, so gating only the id-keyed routes above would have left both
        // refused ops reachable by name.
        "knowledge/bases/[baseId]/folders-by-path/route.ts",
        "knowledge/bases/[baseId]/route.ts",
        "knowledge/entries/[entryId]/route.ts",
        "knowledge/folders/[folderId]/route.ts",
        "ontology/clusters/[clusterId]/route.ts",
        "ontology/objects/[objectId]/route.ts",
        "skills/[skillSlug]/route.ts",
        // POST mints a CONTAINER-LOCKED child credential, DELETE revokes one
        // (2026-08-26, plan §4.4 B1). Sharper than its sibling below, because
        // the credential in question IS the audience ceiling's fence: a bearer
        // that could reach POST would ask for a lock on somewhere else, and one
        // that could reach DELETE would kill its own lock and re-run unlocked.
        "auth/mcp-container-token/route.ts",
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
        // PUT sets a (knowledge base, channel) GRANT (2026-08-26, Home
        // Knowledge Panels M1). Taken straight off `home/links` below: that
        // route is gated because minting a claim link HANDS CONTENT TO A
        // PERSON, and a grant at `visible` is the same line crossed from the
        // other side — it puts a whole knowledge base in front of every member
        // of a channel, GUESTS INCLUDED, and `guestWrite` additionally hands
        // that person a pen. A `full`-profile session has Bash, can read the
        // 90-day device token off disk, and would otherwise be one HTTP call
        // from widening its own operator's audience. ⚠ Per-METHOD: the GET on
        // that file stays ungated — reading which channels a base already
        // reaches decides nothing.
        "knowledge/bases/[baseId]/channel-grants/route.ts",
        // 🔒 R4 (2026-09-02, Desktop Agent default — Samuel may loosen). A PIN
        // decides what EVERY agent session launched in this workspace afterwards
        // is handed at startup (T81). The write reaches no person and changes no
        // audience, which is what the two routes argued before — and beside the
        // point: an agent token settling its own successors' standing context is
        // a machine editing what agents get told, with no operator at the
        // keyboard. Same shape, same precedent, as the grants route above.
        // ⚠ Per-METHOD is moot here — both verbs are writes and both are gated.
        "knowledge/bases/[baseId]/pin/route.ts",
        "knowledge/entries/[entryId]/pin/route.ts",
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
    expect(src).toMatch(
      /SESSION_ONLY_FIELDS\s*=\s*\[\s*"visibility",\s*"agentPosture",\s*"defaultResponderAgentName",?\s*\]/
    );
    expect(src).toMatch(/auth\.agentTokenId/);
    expect(src).toMatch(/SESSION_REQUIRED/);
  });

  /**
   * ⚠ THE FULL FIELD SET, PINNED SO AN EIGHTH LANDS UNGATED VISIBLY. The route's
   * field gate names `visibility`, `agentPosture` and
   * `defaultResponderAgentName`; the service derives the
   * MANAGE set by SUBTRACTION and leaves `infoCard` alone. Both are correct only
   * while the schema's fields are EXACTLY these seven — an eighth added to
   * `ChannelUpdateSchema` would silently inherit the loose (member) gate unless
   * somebody decides otherwise. This asserts the set against the real schema, so
   * that decision cannot be skipped. (A pin on a symbol is not a pin — INVARIANTS
   * §14 — so it reads the schema's own shape.)
   */
  it("ChannelUpdateSchema's fields are EXACTLY the seven gated ones", () => {
    // zod 4: `.refine()` adds a check to the same object type, so `.shape` is the
    // object's own field map (no ZodEffects wrapper to unwrap).
    expect(Object.keys(ChannelUpdateSchema.shape).sort()).toEqual(
      // ⚠ `agentPosture` JOINED ON 2026-09-02 (A9 — G6/G7) AND THIS GATE IS WHY
      // THE DECISION WAS MADE RATHER THAN INHERITED. It is SESSION-ONLY: it is
      // the CEILING on what a launched agent may be granted here, so an agent
      // credential able to raise it could widen its own successors' posture.
      // ⚠ `defaultResponderAgentName` JOINED ON 2026-09-02 (B4 — ruling B6) AND
      // IT IS SESSION-ONLY FOR `agentPosture`'s REASON, SHARPENED: it names the
      // agent that answers every UNADDRESSED human message in the room, so an
      // agent credential able to set it could nominate ITSELF and route the
      // room's unaddressed work to its own session. The gate made the decision
      // rather than letting it be inherited, which is what this case is for.
      [
        "agentPosture",
        "archived",
        "defaultResponderAgentName",
        "infoCard",
        "name",
        "topic",
        "visibility",
      ].sort()
    );
  });
});
