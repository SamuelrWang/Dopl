/**
 * `GET /api/billing/change-plan/preview` — the confirm dialog's amount
 * (2026-10-22 review). Pins the edge: owner-only, home-only before the service is
 * reached, `plan` validated, and the service's answer passed through.
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

const gate = vi.hoisted(() => ({ opts: undefined as unknown }));
vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth: (
    handler: (req: NextRequest, ctx: WorkspaceAuthContext) => Promise<Response>,
    opts?: unknown
  ) => {
    gate.opts = opts;
    return (req: NextRequest) => handler(req, AUTH);
  },
}));
vi.mock("@/features/billing/server/plan-change", () => ({
  previewPersonalUpgrade: vi.fn(),
}));

import { GET } from "./route";
import * as service from "@/features/billing/server/plan-change";

const mockService = vi.mocked(service);
const get = (qs: string) =>
  (GET as unknown as (r: NextRequest) => Promise<Response>)(
    new NextRequest(`http://localhost/api/billing/change-plan/preview${qs}`)
  );

beforeEach(() => {
  vi.clearAllMocks();
  AUTH.workspaceKind = "home";
  mockService.previewPersonalUpgrade.mockResolvedValue({ amountDue: 1601, currency: "usd" });
});

describe("the preview route", () => {
  it("is owner-only (read-only, so no session gate)", () => {
    expect(gate.opts).toEqual({ minRole: "owner" });
  });

  it("answers Stripe's amount for the named plan", async () => {
    const res = await get("?plan=max");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ amountDue: 1601, currency: "usd" });
    expect(mockService.previewPersonalUpgrade).toHaveBeenCalledWith("personal-1", "max");
  });

  it.each(["", "?plan=team", "?plan=MAX"])("400s an unsellable query %j", async (qs) => {
    expect((await get(qs)).status).toBe(400);
    expect(mockService.previewPersonalUpgrade).not.toHaveBeenCalled();
  });

  it("400s a non-home container before the service", async () => {
    AUTH.workspaceKind = "standard";
    expect((await get("?plan=max")).status).toBe(400);
    expect(mockService.previewPersonalUpgrade).not.toHaveBeenCalled();
  });

  it("passes a refusal through", async () => {
    mockService.previewPersonalUpgrade.mockRejectedValue(
      new HttpError(409, "NOT_AN_UPGRADE", "Only an upgrade is charged today.")
    );
    const res = await get("?plan=pro");
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_AN_UPGRADE");
  });
});
