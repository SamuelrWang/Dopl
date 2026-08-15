// @vitest-environment jsdom
/**
 * The join page's endings. ⚠ The load-bearing assertion is NEGATIVE: this card
 * must never push an SPA path — `/{slug}-{publicId}` is 302'd to
 * `/get-started` by `website-retirement.ts › retirementRedirect`. Pinned as a
 * SOURCE assertion because an absent `router.push` cannot be observed by
 * rendering (idiom: `channels/components/go-public-dialog.test.tsx`).
 *
 * `requested` / `already_pending` get no deep link: membership does not exist
 * until an admin approves, and `POST /api/boot` is membership-scoped and
 * fail-closed, so the app would open on a 404 card.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JoinLinkCard } from "./join-link-card";

const TOKEN = "a".repeat(64);
const SEGMENT = "acme-a1b2c3d4e5f6";

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

function renderCard(needsAuth = false) {
  return render(
    <JoinLinkCard
      workspaceName="Acme"
      inviterName="Dana"
      inviterEmail="dana@acme.test"
      token={TOKEN}
      needsAuth={needsAuth}
    />
  );
}

async function clickRequest() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Request to join/ }));
  });
}

describe("signed out", () => {
  it("still bounces through /login and back to this join link", () => {
    renderCard(true);
    expect(
      screen.getByRole("link", { name: "Join workspace" }).getAttribute("href")
    ).toBe(`/login?redirectTo=${encodeURIComponent(`/join/${TOKEN}`)}`);
  });
});

describe("already_member — which is also the approved-request moment", () => {
  it("hands off to the desktop app instead of routing to a retired URL", async () => {
    answer({
      outcome: "already_member",
      workspaceSlug: "acme",
      workspacePublicId: "a1b2c3d4e5f6",
    });
    renderCard();
    await clickRequest();

    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe(`dopl://open/${SEGMENT}`);
    expect(navigated).toBe(`dopl://open/${SEGMENT}`);
  });
});

describe("pending", () => {
  it("offers NO deep link, and says approval comes before the app can open it", async () => {
    answer({ outcome: "requested", workspaceName: "Acme" });
    renderCard();
    await clickRequest();

    expect(screen.queryByRole("link", { name: "Open Dopl" })).toBeNull();
    expect(navigated).toBeNull();
    expect(screen.getByText(/Request sent to the Acme admins/)).toBeDefined();
    expect(screen.getByText(/approve you before you can open/)).toBeDefined();
  });

  it("distinguishes a request already on file from a fresh one", async () => {
    answer({ outcome: "already_pending", workspaceName: "Acme" });
    renderCard();
    await clickRequest();
    expect(screen.getByText(/already with an admin/)).toBeDefined();
  });
});

describe("failure", () => {
  it("surfaces the server's message and leaves the button usable", async () => {
    answer({ error: { message: "This join link is no longer valid" } }, false);
    renderCard();
    await clickRequest();
    expect(screen.getByText("This join link is no longer valid")).toBeDefined();
    expect(screen.getByRole("button", { name: /Request to join/ })).toBeDefined();
  });
});

describe("neither join card may navigate the retired website", () => {
  const read = (file: string) =>
    readFileSync(
      path.join(process.cwd(), "src/features/workspaces/components", file),
      "utf8"
    );

  it("binds no router at all — there is nothing left to push a web path with", () => {
    // ⚠ Asserts the IMPORT, not the call: a card that cannot reach
    // `next/navigation` has no `router.push` to regress into, and prose about
    // the old bug may still mention the call.
    for (const file of ["join-link-card.tsx", "accept-invite-card.tsx"]) {
      expect(read(file), file).not.toMatch(/from "next\/navigation"/);
    }
  });

  it("renders the shared handoff panel rather than a private copy of it", () => {
    for (const file of ["join-link-card.tsx", "accept-invite-card.tsx"]) {
      expect(read(file), file).toMatch(/<DesktopHandoffPanel/);
    }
  });
});
