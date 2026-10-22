/**
 * `/api/billing/change-plan` — the HTTP edge of the Pro ⇄ Max switch. The rules
 * are `features/billing/server/plan-change.test.ts`; this pins the edge: the
 * gates (POST is admin + interactive session, GET admin), the HOME-ONLY fence
 * refused before the service is reached, and body validation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { WorkspaceAuthContext } from "@/shared/auth/with-workspace-auth";
import { HttpError } from "@/shared/lib/http-error";

const AUTH: WorkspaceAuthContext = {
  userId: "user-1",
  credentialSubjectUserId: "user-1",
  workspaceId: "personal-1",
  workspaceSlug: "home",
  workspacePublicId: "ff00ff00ff00",
  role: "owner",
  apiKeyWorkspaceId: null,
  workspaceKind: "home",
};

interface GateOptions {
  minRole?: string;
  sessionOnly?: boolean;
}
const gates = vi.hoisted(() => ({ opts: [] as Array<GateOptions | undefined> }));

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (
    handler: (req: NextRequest, ctx: WorkspaceAuthContext) => Promise<Response>,
    opts?: GateOptions
  ) => {
    gates.opts.push(opts);
    return (req: NextRequest) => handler(req, AUTH);
  },
}));

vi.mock("@/features/billing/server/plan-change", () => ({
  changePersonalPlan: vi.fn(),
  getPlanChangeState: vi.fn(),
}));

import { GET, POST } from "./route";
import * as service from "@/features/billing/server/plan-change";

const mockService = vi.mocked(service);
type Handler = (r: NextRequest) => Promise<Response>;

function post(body: unknown) {
  return (POST as unknown as Handler)(
    new NextRequest("http://localhost/api/billing/change-plan", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}
const get = () =>
  (GET as unknown as Handler)(new NextRequest("http://localhost/api/billing/change-plan"));

beforeEach(() => {
  vi.clearAllMocks();
  AUTH.workspaceKind = "home";
  mockService.changePersonalPlan.mockResolvedValue({
    outcome: "upgraded",
    plan: "max",
    scheduledPlan: null,
    effectiveAt: null,
  });
  mockService.getPlanChangeState.mockResolvedValue({
    plan: "max",
    scheduledPlan: "pro",
    effectiveAt: "2026-11-08T00:00:00.000Z",
  });
});

describe("the gates", () => {
  it("GET is owner; POST is owner AND sessionOnly — money on a home space is the owner's alone", () => {
    // 2026-10-22 review: `owner`, not `admin` — a home space's only member is its
    // owner, and a route that moves money there should say so rather than lean on it.
    expect(gates.opts).toEqual([
      { minRole: "owner" },
      { minRole: "owner", sessionOnly: true },
    ]);
  });
});

describe("🔒 home spaces only", () => {
  it.each(["standard", "link"] as const)(
    "400s PLAN_NOT_FOR_CONTAINER on a %s container without reaching the service",
    async (kind) => {
      AUTH.workspaceKind = kind;
      const res = await post({ plan: "max" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("PLAN_NOT_FOR_CONTAINER");
      expect((await get()).status).toBe(400);
      expect(mockService.changePersonalPlan).not.toHaveBeenCalled();
      expect(mockService.getPlanChangeState).not.toHaveBeenCalled();
    }
  );
});

describe("POST", () => {
  it("switches to the requested personal plan and answers the outcome", async () => {
    const res = await post({ plan: "max" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      outcome: "upgraded",
      plan: "max",
      scheduledPlan: null,
      effectiveAt: null,
    });
    expect(mockService.changePersonalPlan).toHaveBeenCalledWith("personal-1", "max");
  });

  it.each([{ plan: "team" }, { plan: "solo" }, { plan: "free" }, { plan: "MAX" }, {}])(
    "400s an unsellable body %j",
    async (body) => {
      expect((await post(body)).status).toBe(400);
      expect(mockService.changePersonalPlan).not.toHaveBeenCalled();
    }
  );

  it("400s a body that is not JSON", async () => {
    expect((await post("not json")).status).toBe(400);
  });

  it("passes a service refusal through with its status and code", async () => {
    mockService.changePersonalPlan.mockRejectedValue(
      new HttpError(402, "PAYMENT_FAILED", "declined")
    );
    const res = await post({ plan: "max" });
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("PAYMENT_FAILED");
  });
});

describe("GET", () => {
  it("answers the queued change for the pane", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plan: "max",
      scheduledPlan: "pro",
      effectiveAt: "2026-11-08T00:00:00.000Z",
    });
  });
});
