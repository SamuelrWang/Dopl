/**
 * THE CONTAINER-LOCKED CHILD CREDENTIAL — layer B1 of the audience ceiling
 * (plan §4.4, Samuel's RULING 4), and the only layer that binds the agent's own
 * process AND whatever it shells out to, because the lock rides the credential.
 *
 * The chain this suite walks, end to end, is FOUR hops that were never joined
 * before: `mcp_tokens.container_id` → `validateAccessToken` → `with-auth.ts`'s
 * `apiKeyWorkspaceId` → the gates that read it. ⚠ THE ROW CARRIES A SECOND,
 * INDEPENDENT AXIS — `mcp_tokens.subject_user_id`, WHOSE reach the credential
 * inherits, which is what the VISIBILITY gates read
 * (`credential-audience.ts › isSharedCredential`, F-336/F-333). The container
 * axis answers WHICH and nothing else. Until 2026-08-26 the third hop
 * did not exist at all (`with-auth.ts` never wrote the field, and the
 * `api_keys` table the whole chain was built for was dropped in
 * `20260609000000`), so INVARIANTS §4 called it "dead scaffolding; preserved".
 * It is a producer now, and these are its pins.
 *
 * ⚠ MUTATION-VERIFIED — counts in the milestone report.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { KnowledgeBase, KnowledgeContext } from "@/features/knowledge/types";

// ─── harness ────────────────────────────────────────────────────────────────

const state = vi.hoisted(() => ({
  /** What `validateAccessToken` answers for the bearer branch. */
  token: null as {
    userId: string;
    scopes: string[];
    tokenId: string;
    containerId: string | null;
    subjectUserId: string | null;
  } | null,
  /** Every `.eq/.is/.not/.select/.insert/.update` the minter issued. */
  ops: [] as { fn: string; args: unknown[] }[],
  /** Rows the terminal `.select()` answers with. */
  updateResult: [] as { id: string }[],
}));

vi.mock("./mcp-session", () => ({
  touchMcpStatus: vi.fn(),
  checkAndRecordRateLimitSubject: vi.fn(async () => true),
}));
vi.mock("./mcp-oauth", async () => {
  const actual =
    await vi.importActual<typeof import("./mcp-oauth")>("./mcp-oauth");
  return {
    ...actual,
    validateAccessToken: vi.fn(async () => state.token),
    isOAuthAccessToken: (t: string) => t.startsWith("dopl_at_"),
  };
});
vi.mock("@/features/analytics/server/mcp-events", () => ({ logMcpEvent: vi.fn() }));
vi.mock("@/features/analytics/server/system-events", () => ({
  logSystemEvent: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: null, error: null }) },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

/** A chainable Supabase double that RECORDS every call, so the guards on the
 *  revoke query can be asserted as calls rather than inferred from a result. */
function recorder() {
  const chain: Record<string, unknown> = {};
  for (const fn of ["eq", "is", "not", "in", "limit", "update", "upsert"]) {
    chain[fn] = (...args: unknown[]) => {
      state.ops.push({ fn, args });
      return chain;
    };
  }
  chain.insert = (...args: unknown[]) => {
    state.ops.push({ fn: "insert", args });
    return chain;
  };
  chain.select = (...args: unknown[]) => {
    state.ops.push({ fn: "select", args });
    return Object.assign(Promise.resolve({ data: state.updateResult, error: null }), {
      single: async () => ({ data: { id: "tok-new" }, error: null }),
    });
  };
  return {
    from: (table: string) => {
      state.ops.push({ fn: "from", args: [table] });
      return chain;
    },
  };
}

vi.mock("@/shared/supabase/admin", () => ({
  supabaseAdmin: () => recorder(),
}));

import { withUserAuth } from "./with-auth";
import {
  CONTAINER_CLIENT_NAME,
  issueContainerToken,
  revokeContainerTokens,
} from "./mcp-container-token";
import { canSeeBase } from "@/features/knowledge/server/service-shared";

const opsOf = (fn: string) => state.ops.filter((o) => o.fn === fn);
const insertedRow = () =>
  (opsOf("insert")[0]?.args[0] ?? {}) as Record<string, unknown>;

beforeEach(() => {
  state.token = null;
  state.ops = [];
  state.updateResult = [];
  vi.clearAllMocks();
});

// ─── the minter ─────────────────────────────────────────────────────────────

describe("issueContainerToken", () => {
  it("🔒 stores the LOCK on the token row", async () => {
    await issueContainerToken({ userId: "u-1", workspaceId: "ws-container" });

    expect(insertedRow().workspace_id).toBe("ws-container");
  });

  // 🔒 F-336/F-333. The lock says WHICH WORKSPACE; this says WHAT KIND OF LOCK,
  // and without it `credential-audience.ts › isSharedCredential` answers TRUE
  // and the operator's own agent is refused the operator's own private rows —
  // silently, and in the fail-CLOSED direction, so nothing errors and the only
  // tell is a 404 on a knowledge base the operator granted.
  it("🔒 stores the lock's KIND, which is what stops it being read as a SHARED key", async () => {
    await issueContainerToken({ userId: "u-1", workspaceId: "ws-container" });

    expect(insertedRow().workspace_lock_kind).toBe("container_session");
  });

  it("returns the token ONCE and stores only its hash", async () => {
    const out = await issueContainerToken({
      userId: "u-1",
      workspaceId: "ws-container",
    });

    expect(out.token.startsWith("dopl_at_")).toBe(true);
    expect(out.tokenId).toBe("tok-new");
    // The plaintext must not be anywhere in what was written.
    expect(JSON.stringify(insertedRow())).not.toContain(out.token);
    expect(typeof insertedRow().access_token_hash).toBe("string");
  });

  it("mints NO refresh token — a child credential is never renewed", async () => {
    await issueContainerToken({ userId: "u-1", workspaceId: "ws-container" });

    expect(insertedRow().refresh_token_hash).toBeNull();
    expect(insertedRow().refresh_expires_at).toBeNull();
  });

  it("carries a label DISTINCT from the device token's, so a re-mint cannot sweep it", async () => {
    // `issueDeviceToken` revoke-and-replaces on (user_id, client_id,
    // client_name). A shared label would make every device-token refresh kill
    // every live container session on the machine.
    await issueContainerToken({ userId: "u-1", workspaceId: "ws-container" });

    expect(insertedRow().client_name).toBe(CONTAINER_CLIENT_NAME);
    expect(insertedRow().client_name).not.toBe("Dopl Desktop CLI");
  });

  it("names NO container text in the label — a private room's name is not a credential label", async () => {
    await issueContainerToken({
      userId: "u-1",
      workspaceId: "ws-container",
    });

    expect(String(insertedRow().client_name)).not.toContain("ws-container");
  });
});

// ─── the revoker ────────────────────────────────────────────────────────────

describe("revokeContainerTokens", () => {
  it("🔒 can NEVER touch an unlocked credential — the operator's device token is safe", async () => {
    // The guard is `workspace_id IS NOT NULL` on the query itself. Without it a
    // `{userId}`-only sweep would revoke the 90-day device token every other
    // session on that machine depends on.
    await revokeContainerTokens({ userId: "u-1" });

    expect(opsOf("not")[0].args).toEqual(["workspace_id", "is", null]);
  });

  it("is always scoped to the caller's own user id", async () => {
    await revokeContainerTokens({ userId: "u-1", tokenId: "tok-7" });

    expect(opsOf("eq").some((o) => o.args[0] === "user_id" && o.args[1] === "u-1")).toBe(
      true,
    );
  });

  it("narrows by tokenId when given one", async () => {
    await revokeContainerTokens({ userId: "u-1", tokenId: "tok-7" });

    expect(opsOf("eq").some((o) => o.args[0] === "id" && o.args[1] === "tok-7")).toBe(
      true,
    );
  });

  it("narrows by workspaceId when given one — the container sweep", async () => {
    await revokeContainerTokens({ userId: "u-1", workspaceId: "ws-container" });

    expect(
      opsOf("eq").some(
        (o) => o.args[0] === "workspace_id" && o.args[1] === "ws-container",
      ),
    ).toBe(true);
  });

  it("skips rows already revoked, and answers 0 idempotently", async () => {
    state.updateResult = [];

    expect(await revokeContainerTokens({ userId: "u-1", tokenId: "gone" })).toBe(0);
    expect(opsOf("is").some((o) => o.args[0] === "revoked_at")).toBe(true);
  });

  it("reports how many rows it actually stamped", async () => {
    state.updateResult = [{ id: "a" }, { id: "b" }];

    expect(await revokeContainerTokens({ userId: "u-1", workspaceId: "ws" })).toBe(2);
  });
});

// ─── the producer: with-auth forwards the lock ──────────────────────────────

describe("🔒 the PRODUCER — `with-auth.ts` forwards the token's lock", () => {
  const echo = withUserAuth(async (_req, ctx) =>
    NextResponse.json({ apiKeyWorkspaceId: ctx.apiKeyWorkspaceId ?? null }),
  );
  const echoSubject = withUserAuth(async (_req, ctx) =>
    NextResponse.json({ subject: ctx.credentialSubjectUserId }),
  );
  const req = () =>
    new NextRequest("https://x.test/api/thing", {
      headers: { authorization: "Bearer dopl_at_child" },
    });

  it("a LOCKED credential arrives at the handler as `apiKeyWorkspaceId`", async () => {
    // This is the hop that did not exist before 2026-08-26. Without it every
    // gate downstream reads `null` and the fence is inert.
    state.token = {
      userId: "u-1",
      scopes: ["dopl.read", "dopl.write"],
      tokenId: "t",
      containerId: "ws-container",
      subjectUserId: "u-1",
    };

    const res = await echo(req(), { params: Promise.resolve({}) });

    expect(await res.json()).toEqual({ apiKeyWorkspaceId: "ws-container" });
  });

  it("an ORDINARY credential still arrives unlocked — no behaviour change", async () => {
    state.token = {
      userId: "u-1",
      scopes: ["dopl.read", "dopl.write"],
      tokenId: "t",
      containerId: null,
      subjectUserId: "u-1",
    };

    const res = await echo(req(), { params: Promise.resolve({}) });

    expect(await res.json()).toEqual({ apiKeyWorkspaceId: null });
  });

  // 🔒 THE FIFTH HOP (F-336). The container axis cannot answer a VISIBILITY
  // question; the SUBJECT axis is what the M-10 predicates read. Drop this
  // forward and every session reverts to being a shared credential.
  it("forwards the SUBJECT axis alongside the container axis", async () => {
    state.token = {
      userId: "u-1",
      scopes: ["dopl.read"],
      tokenId: "t",
      containerId: "ws-container",
      subjectUserId: "u-1",
    };

    const res = await echoSubject(req(), { params: Promise.resolve({}) });

    expect(await res.json()).toEqual({ subject: "u-1" });
  });

  it("forwards an ABSENT subject as null — the shared credential, unchanged", async () => {
    state.token = {
      userId: "u-1",
      scopes: ["dopl.read"],
      tokenId: "t",
      containerId: "ws-container",
      subjectUserId: null,
    };

    const res = await echoSubject(req(), { params: Promise.resolve({}) });

    expect(await res.json()).toEqual({ subject: null });
  });
});

// ─── the enforcement the lock switches on ───────────────────────────────────

/**
 * ⚠ THIS BLOCK WAS "the M-10 gates the LOCK lights up" AND THAT WAS THE F-336
 * DEFECT WRITTEN AS A TEST (corrected 2026-08-27, Samuel's ruling). The gates
 * are lit by the credential being SHARED — having no single human behind it —
 * and a lock is not evidence of that. What the lock lights up is the WORKSPACE
 * fence, which is pinned in `with-workspace-auth.test.ts` and is unchanged.
 */
describe("🔒 the M-10 gates a SHARED credential lights up", () => {
  function ctx(
    apiKeyWorkspaceId: string | null,
    credentialSubjectUserId: string | null = null,
  ): KnowledgeContext {
    return {
      workspaceId: "ws-container",
      userId: "u-1",
      role: "owner",
      source: "agent",
      apiKeyWorkspaceId,
      credentialSubjectUserId,
    };
  }
  const privateOwn = {
    id: "kb-private",
    visibility: "private",
    createdBy: "u-1",
  } as KnowledgeBase;
  const shared = { id: "kb-public", visibility: "public" } as KnowledgeBase;

  it("refuses a PRIVATE base to a credential with NO subject — the shared-key case", async () => {
    // The rule the gate encodes: a credential that may be passed between humans
    // must not read one person's private draft. An absent subject is exactly
    // that, and it is the fail-closed direction.
    expect(canSeeBase(ctx("ws-container"), privateOwn)).toBe(false);
  });

  it("🔒 ALLOWS it when the SUBJECT is the caller — F-336, and the whole ruling", async () => {
    // Same container, same workspace, same user id. The subject axis is the
    // only difference, and it is the difference between "a credential passed
    // between humans" and "the operator's own session, narrowed".
    expect(canSeeBase(ctx("ws-container", "u-1"), privateOwn)).toBe(true);
  });

  it("still allows a SHARED base either way", async () => {
    expect(canSeeBase(ctx("ws-container"), shared)).toBe(true);
    expect(canSeeBase(ctx("ws-container", "u-1"), shared)).toBe(true);
  });

  it("is unchanged for an UNFENCED credential — the caller's own private base is visible", async () => {
    expect(canSeeBase(ctx(null, "u-1"), privateOwn)).toBe(true);
  });

  // 🔒 THE MUTATION THAT MATTERS: the container axis must move NOTHING here.
  it("the container axis alone changes no answer, in either position", async () => {
    expect(canSeeBase(ctx("ws-container", "u-1"), privateOwn)).toBe(
      canSeeBase(ctx(null, "u-1"), privateOwn),
    );
    expect(canSeeBase(ctx("ws-container", null), privateOwn)).toBe(
      canSeeBase(ctx(null, null), privateOwn),
    );
  });
});
