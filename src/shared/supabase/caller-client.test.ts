/**
 * THE FLAG, THE CLAIMS AND THE FALLBACK — the three things that decide whether
 * a read meets a policy at all (Wave B B7).
 *
 * ⚠ WHAT THIS SUITE CANNOT DO is prove a policy refuses anything: that needs a
 * database, and this repo has no SQL executor (no pglite, no pg-mem, no `pg`
 * client — only PostgREST over HTTP). The refusal is proved two other ways:
 * `knowledge/server/rls-redteam.test.ts` reads the replayed policy TEXT out of
 * `supabase/migrations`, and its live half drives a real local Supabase when one
 * is configured.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { supabaseAdmin } from "./admin";
import {
  RLS_CALLER_SCOPED_READS_ENV,
  callerScopedClient,
  callerScopedReadsEnabled,
  readClient,
  __resetCallerClientCacheForTests,
} from "./caller-client";
import {
  CALLER_JWT_TTL_SECONDS,
  DOPL_CREDENTIAL_CLAIM,
  SUPABASE_JWT_SECRET_ENV,
  callerJwtClaims,
  signCallerJwt,
} from "./caller-jwt";
import { runWithCallerScope, getCallerScope, type CallerScope } from "./caller-scope";

const SESSION: CallerScope = {
  userId: "11111111-1111-4111-8111-111111111111",
  sharedCredential: false,
  credentialWorkspaceId: null,
};
const SHARED: CallerScope = {
  userId: SESSION.userId,
  sharedCredential: true,
  credentialWorkspaceId: "22222222-2222-4222-8222-222222222222",
};

afterEach(() => {
  vi.unstubAllEnvs();
  __resetCallerClientCacheForTests();
});

describe("the RLS_CALLER_SCOPED_READS flag", () => {
  it("is OFF when the variable is absent — the slice ships dark", () => {
    expect(callerScopedReadsEnabled({})).toBe(false);
  });

  it.each(["1", "true", "on", "ON", " true "])(
    "is ON for %o — an explicit spelling, nothing else",
    (raw) => {
      expect(callerScopedReadsEnabled({ [RLS_CALLER_SCOPED_READS_ENV]: raw })).toBe(true);
    }
  );

  it.each(["0", "false", "off", "", "yes", "banana"])(
    "stays OFF for %o — anything that is not a spelling of on",
    (raw) => {
      expect(callerScopedReadsEnabled({ [RLS_CALLER_SCOPED_READS_ENV]: raw })).toBe(false);
    }
  );

  it("is read per call, not captured at module load", () => {
    expect(callerScopedReadsEnabled()).toBe(false);
    vi.stubEnv(RLS_CALLER_SCOPED_READS_ENV, "1");
    expect(callerScopedReadsEnabled()).toBe(true);
  });
});

describe("readClient", () => {
  it("is the service-role client with the flag off, scope or no scope", () => {
    expect(readClient()).toBe(supabaseAdmin());
    runWithCallerScope(SESSION, () => {
      expect(readClient()).toBe(supabaseAdmin());
    });
  });

  it("stays the service-role client with the flag ON but no request scope — cron, ingestion, scripts", () => {
    vi.stubEnv(RLS_CALLER_SCOPED_READS_ENV, "1");
    vi.stubEnv(SUPABASE_JWT_SECRET_ENV, "test-jwt-secret");
    expect(getCallerScope()).toBeNull();
    expect(readClient()).toBe(supabaseAdmin());
  });

  it("is a caller-scoped client with the flag on inside a request", () => {
    vi.stubEnv(RLS_CALLER_SCOPED_READS_ENV, "1");
    vi.stubEnv(SUPABASE_JWT_SECRET_ENV, "test-jwt-secret");
    runWithCallerScope(SESSION, () => {
      expect(readClient()).not.toBe(supabaseAdmin());
    });
  });

  it("throws rather than silently falling back when the JWT secret is missing", () => {
    vi.stubEnv(RLS_CALLER_SCOPED_READS_ENV, "1");
    vi.stubEnv(SUPABASE_JWT_SECRET_ENV, "");
    runWithCallerScope(SESSION, () => {
      expect(() => readClient()).toThrow(SUPABASE_JWT_SECRET_ENV);
    });
  });
});

describe("the caller-scoped client cache", () => {
  it("reuses one client per caller", () => {
    vi.stubEnv(SUPABASE_JWT_SECRET_ENV, "test-jwt-secret");
    expect(callerScopedClient(SESSION)).toBe(callerScopedClient(SESSION));
  });

  it("🔒 does NOT reuse it across the credential axes — a shared credential is a different reader (F-336)", () => {
    vi.stubEnv(SUPABASE_JWT_SECRET_ENV, "test-jwt-secret");
    expect(callerScopedClient(SESSION)).not.toBe(callerScopedClient(SHARED));
  });
});

describe("the minted claims", () => {
  it("carries the caller as `sub` and the authenticated role — never service_role", () => {
    const claims = callerJwtClaims(SESSION, 1_000);
    expect(claims.sub).toBe(SESSION.userId);
    expect(claims.role).toBe("authenticated");
    expect(claims.exp).toBe(1_000 + CALLER_JWT_TTL_SECONDS);
  });

  it("🔒 states the credential axis both ways — this is the M-10 arm the policy reads", () => {
    expect(callerJwtClaims(SESSION, 0)[DOPL_CREDENTIAL_CLAIM]).toEqual({
      shared: false,
      workspace_id: null,
    });
    expect(callerJwtClaims(SHARED, 0)[DOPL_CREDENTIAL_CLAIM]).toEqual({
      shared: true,
      workspace_id: SHARED.credentialWorkspaceId,
    });
  });

  it("signs three base64url segments the payload of which round-trips", () => {
    const token = signCallerJwt(SESSION, { env: { [SUPABASE_JWT_SECRET_ENV]: "s" }, nowSeconds: 7 });
    const [header, payload, signature] = token.split(".");
    expect(token.split(".")).toHaveLength(3);
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual(
      callerJwtClaims(SESSION, 7)
    );
    expect(signature).not.toContain("=");
  });

  it("signs differently under a different secret — the signature is not decoration", () => {
    const a = signCallerJwt(SESSION, { env: { [SUPABASE_JWT_SECRET_ENV]: "a" }, nowSeconds: 7 });
    const b = signCallerJwt(SESSION, { env: { [SUPABASE_JWT_SECRET_ENV]: "b" }, nowSeconds: 7 });
    expect(a).not.toBe(b);
  });
});

describe("the caller scope", () => {
  it("reaches through awaits — a repository read is many frames below the wrapper", async () => {
    const seen = await runWithCallerScope(SESSION, async () => {
      await Promise.resolve();
      return getCallerScope();
    });
    expect(seen).toEqual(SESSION);
  });

  it("does not leak out of the request that set it", async () => {
    await runWithCallerScope(SESSION, async () => Promise.resolve());
    expect(getCallerScope()).toBeNull();
  });
});
