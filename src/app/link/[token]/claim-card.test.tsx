// @vitest-environment jsdom
/**
 * The claim page's endings, on `join-link-card.test.tsx`'s pattern.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS THE DEEP LINK'S TARGET. A relationship lives
 * in a hidden `kind='link'` container the desktop rail filters out, so a handoff
 * naming that container's segment opens a workspace the app declines to list.
 * The only correct target is the account surface, `dopl://open/home`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LinkClaimCard } from "./claim-card";

const TOKEN = "b".repeat(64);
const HOME_DEEP_LINK = "dopl://open/home";

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

function renderCard(
  over: Partial<Parameters<typeof LinkClaimCard>[0]> = {}
) {
  return render(
    <LinkClaimCard
      creatorName="Dana"
      dead={false}
      token={TOKEN}
      needsAuth={false}
      {...over}
    />
  );
}

async function clickConnect() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Connect with/ }));
  });
}

describe("signed out", () => {
  it("bounces through /login and back to this claim link", () => {
    renderCard({ needsAuth: true });
    expect(
      screen.getByRole("link", { name: "Connect" }).getAttribute("href")
    ).toBe(`/login?redirectTo=${encodeURIComponent(`/link/${TOKEN}`)}`);
  });
});

describe("ready to claim", () => {
  it("names the creator, and a nameless one stays nameless", () => {
    renderCard();
    expect(
      screen.getByRole("heading", { name: "Dana invites you to connect" })
    ).toBeDefined();

    cleanup();
    renderCard({ creatorName: null });
    expect(
      screen.getByRole("heading", { name: "Someone invites you to connect" })
    ).toBeDefined();
  });

  it("claims, then hands off to the desktop HOME surface", async () => {
    answer({ relationship: {}, existing: false });
    renderCard();
    await clickConnect();

    expect(screen.getByText("You're connected to Dana.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe(HOME_DEEP_LINK);
    expect(navigated).toBe(HOME_DEEP_LINK);
  });

  it("says so when the pair already had a container", async () => {
    answer({ relationship: {}, existing: true });
    renderCard();
    await clickConnect();
    expect(screen.getByText("You're already connected to Dana.")).toBeDefined();
  });
});

describe("dead links", () => {
  it("offers no claim button and no deep link when the link arrives dead", () => {
    renderCard({ dead: true });
    expect(
      screen.getByRole("heading", { name: "This link is no longer available" })
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: /Connect with/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Dopl" })).toBeNull();
    expect(navigated).toBeNull();
  });

  it("collapses a 410 mid-claim into the same ending", async () => {
    answer(
      { error: { code: "LINK_UNAVAILABLE", message: "This link is no longer available" } },
      false
    );
    renderCard();
    await clickConnect();

    expect(
      screen.getByRole("heading", { name: "This link is no longer available" })
    ).toBeDefined();
    expect(navigated).toBeNull();
  });
});

describe("failure", () => {
  it("surfaces a self-claim in the server's own words, button still usable", async () => {
    answer(
      { error: { code: "LINK_SELF_CLAIM", message: "You cannot claim your own link" } },
      false
    );
    renderCard();
    await clickConnect();

    expect(screen.getByText("You cannot claim your own link")).toBeDefined();
    expect(screen.getByRole("button", { name: /Connect with/ })).toBeDefined();
  });
});

describe("the claim card may not navigate the retired website", () => {
  const source = () =>
    readFileSync(
      path.join(process.cwd(), "src/app/link/[token]/claim-card.tsx"),
      "utf8"
    );

  // ⚠ Asserts the IMPORT, not the call — a card that cannot reach
  // `next/navigation` has no `router.push` to regress into.
  it("binds no router at all", () => {
    expect(source()).not.toMatch(/from "next\/navigation"/);
  });
});
