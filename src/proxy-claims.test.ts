/**
 * Q12 — THE SIGNATURE-VERIFICATION PROOF for the proxy's local auth check.
 *
 * `src/proxy.ts` swapped a per-request network `getUser()` for `getClaims()`.
 * That swap is only safe if `getClaims()` actually VERIFIES the token rather than
 * decoding it, so this suite drives the REAL `@supabase/ssr` / `auth-js` client
 * (nothing about the auth path is mocked — only the network is stubbed and
 * counted) against REAL ES256 keys generated with WebCrypto.
 *
 * What this project's tokens actually are (checked against prod on 2026-07-31):
 *   GET https://<ref>.supabase.co/auth/v1/.well-known/jwks.json
 *     → exactly one key: { alg: "ES256", kty: "EC", crv: "P-256", kid: … }
 *   and the publishable key is the new `sb_publishable_…` format, so no legacy
 *   HS256 shared secret remains. Asymmetric ⇒ auth-js takes the WebCrypto path.
 *
 * Pinned here:
 *   1. a well-formed ES256 token verifies with the JWKS fetch ONLY — never a
 *      `/auth/v1/user` round-trip;
 *   2. the JWKS is cached (`JWKS_TTL` = 10 min, process-wide), so steady-state
 *      request cost per page view is ZERO;
 *   3. a TAMPERED signature is REJECTED — the local path is not a decode;
 *   4. an HS256 / kid-less token degrades to the network `getUser()` instead of
 *      being trusted, which is why the swap is safe even mid-key-rotation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServerClient } from "@supabase/ssr";

const SUPABASE_URL = "https://proj-ref.supabase.co";
const ANON_KEY = "sb_publishable_test";

// ── JWT helpers (real WebCrypto, no library) ─────────────────────────────────

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function makeEs256Keys(kid: string) {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk = { ...pub, alg: "ES256", use: "sig", key_ops: ["verify"], ext: true, kid };
  return { privateKey: pair.privateKey, jwk };
}

/** Signs a real ES256 JWS (raw r||s signature — exactly the JWS ES256 encoding). */
async function signEs256(
  privateKey: CryptoKey,
  kid: string,
  payload: Record<string, unknown>
) {
  const head = b64urlJson({ alg: "ES256", typ: "JWT", kid });
  const body = b64urlJson(payload);
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(`${head}.${body}`)
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function claimsFor(sub: string, ttlSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub,
    aud: "authenticated",
    role: "authenticated",
    iss: `${SUPABASE_URL}/auth/v1`,
    iat: now,
    exp: now + ttlSeconds,
    session_id: "11111111-1111-1111-1111-111111111111",
  };
}

// ── Network stub: routes + counts every request auth-js makes ────────────────

type Counts = { jwks: number; user: number; token: number; other: number };

function stubNetwork(jwk: object) {
  const counts: Counts = { jwks: 0, user: 0, token: 0, other: 0 };
  const spy = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(
      typeof input === "object" && "url" in input ? input.url : input
    );
    if (url.includes("/.well-known/jwks.json")) {
      counts.jwks++;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/auth/v1/user")) {
      counts.user++;
      return new Response(JSON.stringify({ id: "network-user", aud: "authenticated" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("grant_type=refresh_token")) {
      counts.token++;
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    counts.other++;
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return counts;
}

/**
 * A client with a UNIQUE storage key per test. auth-js caches the JWKS in a
 * module-global keyed by storage key, so this isolates the cache per test and
 * makes the fetch counts order-independent.
 */
let clientSeq = 0;
function client() {
  clientSeq += 1;
  return createServerClient(SUPABASE_URL, ANON_KEY, {
    cookieOptions: { name: `sb-test-${clientSeq}-auth-token` },
    cookies: { getAll: () => [], setAll: () => {} },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1 + 2. Local verification, and it is cached ──────────────────────────────

describe("ES256 access token (what this project actually issues)", () => {
  it("verifies locally: one JWKS fetch, ZERO /auth/v1/user calls", async () => {
    const { privateKey, jwk } = await makeEs256Keys("kid-a");
    const counts = stubNetwork(jwk);
    const jwt = await signEs256(privateKey, "kid-a", claimsFor("user-42"));

    const { data, error } = await client().auth.getClaims(jwt);

    expect(error).toBeNull();
    expect(data?.claims.sub).toBe("user-42");
    expect(data?.header.alg).toBe("ES256"); // the asymmetric path, not HS256
    expect(counts.user).toBe(0); // ← the network call Q12 removed
    expect(counts.jwks).toBe(1);
    expect(counts.token).toBe(0);
  });

  it("caches the JWKS — the 2nd..Nth verification costs ZERO requests", async () => {
    const { privateKey, jwk } = await makeEs256Keys("kid-b");
    const counts = stubNetwork(jwk);
    const supabase = client();

    for (let i = 0; i < 25; i++) {
      const jwt = await signEs256(privateKey, "kid-b", claimsFor(`user-${i}`));
      const { data } = await supabase.auth.getClaims(jwt);
      expect(data?.claims.sub).toBe(`user-${i}`);
    }

    // 25 page views, 1 request total. Under the old getUser() this was 25
    // requests × ~5 Postgres queries each.
    expect(counts.jwks).toBe(1);
    expect(counts.user).toBe(0);
  });
});

// ── 3. It is verification, not a decode ──────────────────────────────────────

describe("forged / tampered tokens are rejected locally", () => {
  it("a tampered signature fails — and does NOT silently fall back to the network", async () => {
    const { privateKey, jwk } = await makeEs256Keys("kid-c");
    const counts = stubNetwork(jwk);
    const jwt = await signEs256(privateKey, "kid-c", claimsFor("user-1"));
    const [h, p, s] = jwt.split(".");
    const flipped = `${s.slice(0, -4)}${s.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;

    const { data, error } = await client().auth.getClaims(`${h}.${p}.${flipped}`);

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(counts.user).toBe(0); // fails closed; never asks the server for a second opinion
  });

  it("a re-signed payload under an ATTACKER key fails (kid must match the JWKS)", async () => {
    const { jwk } = await makeEs256Keys("kid-d"); // the server's key
    const attacker = await makeEs256Keys("kid-d"); // different key, same kid
    const counts = stubNetwork(jwk);
    const forged = await signEs256(
      attacker.privateKey,
      "kid-d",
      claimsFor("victim-user")
    );

    const { data, error } = await client().auth.getClaims(forged);

    expect(data).toBeNull();
    expect(error).toBeTruthy();
    expect(counts.user).toBe(0);
  });

  /**
   * THE TRAP, and the reason `proxy.ts` wraps `getClaims()` in try/catch.
   *
   * `validateExp` (auth-js `lib/helpers.ts`) throws a PLAIN `Error`, not an
   * `AuthError`. `getClaims()` only converts `isAuthError(e)` into
   * `{ data: null, error }` — anything else it RE-THROWS at the caller. So an
   * expired (or `exp`-less) token does not return "no session", it EXPLODES.
   *
   * `getSession()` normally refreshes 90s before expiry so this stays unreachable
   * — but it keys off the stored `expires_at`, so a session blob whose
   * `expires_at` is absent or disagrees with the token's own `exp` (clock skew, a
   * hand-rolled cookie, a partially-written blob) reaches it. Unwrapped in
   * middleware, that is a 500 on EVERY server-rendered page — the exact shape of
   * the 2026-07-31 incident. `getUser()` could never do this; the swap could.
   */
  it("an expired token THROWS a plain Error (not an auth error) — must be caught", async () => {
    const { privateKey, jwk } = await makeEs256Keys("kid-e");
    const counts = stubNetwork(jwk);
    const jwt = await signEs256(privateKey, "kid-e", claimsFor("user-1", -60));

    await expect(client().auth.getClaims(jwt)).rejects.toThrow("JWT has expired");
    expect(counts.user).toBe(0);
    expect(counts.jwks).toBe(0); // rejected before the key is even looked up
  });

  it("a token with no exp claim THROWS too (same trap)", async () => {
    const { privateKey, jwk } = await makeEs256Keys("kid-g");
    stubNetwork(jwk);
    const noExp: Record<string, unknown> = { ...claimsFor("user-1") };
    delete noExp.exp;
    const jwt = await signEs256(privateKey, "kid-g", noExp);

    await expect(client().auth.getClaims(jwt)).rejects.toThrow("Missing exp claim");
  });
});

// ── 4. The documented degradation path ───────────────────────────────────────

describe("symmetric / kid-less tokens degrade to the network check", () => {
  it("an HS256 token falls back to getUser() instead of being trusted", async () => {
    const { jwk } = await makeEs256Keys("kid-f");
    const counts = stubNetwork(jwk);
    // No `kid`, symmetric alg — auth-js cannot verify locally.
    const head = b64urlJson({ alg: "HS256", typ: "JWT" });
    const body = b64urlJson(claimsFor("user-legacy"));
    const legacy = `${head}.${body}.${Buffer.from("not-a-real-mac").toString("base64url")}`;

    const { data, error } = await client().auth.getClaims(legacy);

    // The server vouched for it, so the claims come back — but note it COST a
    // network call. This is why the project's asymmetric (ES256) keys are the
    // load-bearing precondition for Q12's request diet: a rollback to a shared
    // secret would silently restore the per-request GoTrue call.
    expect(error).toBeNull();
    expect(data?.claims.sub).toBe("user-legacy");
    expect(counts.user).toBe(1);
  });
});
