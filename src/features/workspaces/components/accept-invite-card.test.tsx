// @vitest-environment jsdom
/**
 * Accepting an invitation is a MEMBERSHIP, spent in the app. ⚠ Any in-app web
 * path here is 302'd to `/get-started` by the retirement map, so the accept
 * ends in the `dopl://open/{segment}` handoff. The invitation's own states
 * (dead, signed-out) are pinned so the new branch cannot swallow them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AcceptInviteCard } from "./accept-invite-card";

const TOKEN = "inv-token";
const SEGMENT = "acme-a1b2c3d4e5f6";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

type CardProps = Parameters<typeof AcceptInviteCard>[0];

const STATUS: CardProps["status"] = {
  workspace: { id: "ws-1", name: "Acme", slug: "acme", publicId: "a1b2c3d4e5f6" },
  inviter: { email: "dana@acme.test" },
  invitation: {
    id: "inv-1",
    workspaceId: "ws-1",
    email: "new@acme.test",
    invitedRole: "editor",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    acceptedAt: null,
    acceptedBy: null,
    revokedAt: null,
    invitedBy: "user-1",
  },
  expired: false,
  revoked: false,
  alreadyAccepted: false,
} as unknown as CardProps["status"];

let navigated: string | null;
let realLocation: PropertyDescriptor | undefined;

beforeEach(() => {
  navigated = null;
  realLocation = Object.getOwnPropertyDescriptor(window, "location");
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(value: string) {
        navigated = value;
      },
      get href() {
        return navigated ?? "http://localhost/";
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (realLocation) Object.defineProperty(window, "location", realLocation);
});

function answer(body: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response)
  );
}

function renderCard(overrides: Partial<CardProps> = {}) {
  return render(
    <AcceptInviteCard
      status={STATUS}
      token={TOKEN}
      needsAuth={false}
      {...overrides}
    />
  );
}

async function clickAccept() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Join Acme/ }));
  });
}

describe("a completed accept", () => {
  it("hands off to the desktop app on the workspace it just joined", async () => {
    answer({ workspaceSlug: "acme", workspacePublicId: "a1b2c3d4e5f6" });
    renderCard();
    await clickAccept();

    expect(screen.getByText("You've joined Acme.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe(`dopl://open/${SEGMENT}`);
    expect(navigated).toBe(`dopl://open/${SEGMENT}`);
  });

  it("drops the expiry line — an accepted invitation cannot reach it", async () => {
    answer({ workspaceSlug: "acme", workspacePublicId: "a1b2c3d4e5f6" });
    renderCard();
    expect(screen.getByText(/^Expires/)).toBeDefined();
    await clickAccept();
    expect(screen.queryByText(/^Expires/)).toBeNull();
  });
});

describe("the states the handoff must not swallow", () => {
  it("a dead invitation still explains itself and offers no handoff", () => {
    renderCard({
      status: { ...STATUS, revoked: true } as CardProps["status"],
    });
    expect(screen.getByText("This invitation has been revoked.")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Open Dopl" })).toBeNull();
  });

  it("a signed-out visitor still bounces through /login back to the invite", () => {
    renderCard({ needsAuth: true });
    expect(
      screen.getByRole("link", { name: "Sign in to accept" }).getAttribute("href")
    ).toBe(`/login?redirectTo=${encodeURIComponent(`/invite/${TOKEN}`)}`);
  });

  it("a failed accept surfaces the message and keeps the button", async () => {
    answer({ error: { message: "Invitation has expired" } }, false);
    renderCard();
    await clickAccept();
    expect(screen.getByText("Invitation has expired")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Open Dopl" })).toBeNull();
  });
});
