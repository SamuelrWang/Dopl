// @vitest-environment jsdom
/**
 * The claim page's endings, on `join-link-card.test.tsx`'s pattern.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS THE DEEP LINK'S TARGET. A relationship lives
 * in a hidden `kind='link'` container the desktop rail filters out, so a handoff
 * naming that container's segment opens a workspace the app declines to list.
 * The only correct target is the account surface, `dopl://open/home`.
 *
 * ⚠ SINCE 2026-08-25 (`docs/specs/guest-web-channel.md`) a claim has a SECOND
 * ending: the web guest lane at `/c/<workspaceId>`, always on screen for the
 * claimer with no desktop app. Both endings are pinned here, and so is the line
 * between them: only a SUCCESSFUL claim offers either one.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LinkClaimCard } from "./claim-card";
import type { HomeLinkClaimResult } from "@/features/home/types";

const TOKEN = "b".repeat(64);
const HOME_DEEP_LINK = "dopl://open/home";
/** The web guest lane, built from the same factory the server payload is typed by. */
const webLane = (result = claimed(false)) => `/c/${result.channel.workspaceId}`;

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

/**
 * A CLAIM RESPONSE, IN THE SHAPE THE SERVER REALLY SENDS. ⚠ The stub here said
 * `{ relationship: {}, existing }` until 2026-08-25 — the key was renamed
 * `relationship` → `channel` on 2026-08-24 and nothing went red, because a
 * hand-written literal answers to no type. TYPING IT is the fix: the next
 * rename fails to COMPILE here rather than passing against a payload the
 * endpoint stopped sending.
 */
const claimed = (existing: boolean): HomeLinkClaimResult => ({
  channel: {
    workspaceId: "55555555-5555-4555-8555-555555555555",
    workspaceSegment: "dana-abc123def456",
    channelId: "66666666-6666-4666-8666-666666666666",
    name: "Dana",
    peers: [],
    peer: null,
    createdAt: "2026-08-25T00:00:00.000Z",
    lastMessageAt: null,
    lastMessagePreview: null,
    linkOut: null,
  },
  existing,
  bound: true,
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

/** Every rendered anchor pointing at the guest lane, whatever its label. */
function webLaneLinks() {
  return screen
    .queryAllByRole("link")
    .filter((el) => (el.getAttribute("href") ?? "").startsWith("/c/"));
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
    answer(claimed(false));
    renderCard();
    await clickConnect();

    expect(screen.getByText("You're connected to Dana.")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe(HOME_DEEP_LINK);
    expect(navigated).toBe(HOME_DEEP_LINK);
  });

  it("also offers the browser lane, at the claimed container's own id", async () => {
    answer(claimed(false));
    renderCard();
    await clickConnect();

    expect(
      screen
        .getByRole("link", { name: "open this channel in your browser" })
        .getAttribute("href")
    ).toBe(webLane());
  });

  it("says so when the pair already had a container", async () => {
    answer(claimed(true));
    renderCard();
    await clickConnect();
    expect(screen.getByText("You're already connected to Dana.")).toBeDefined();
  });

  // ⚠ `existing: true` is the SAME ending, so it gets the same two ways in —
  // a claimer who already had the channel is no likelier to have the app.
  it("gives an already-connected claimer both paths, not just the deep link", async () => {
    answer(claimed(true));
    renderCard();
    await clickConnect();

    expect(
      screen.getByRole("link", { name: "Open Dopl" }).getAttribute("href")
    ).toBe(HOME_DEEP_LINK);
    expect(
      screen
        .getByRole("link", { name: "open this channel in your browser" })
        .getAttribute("href")
    ).toBe(webLane(claimed(true)));
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
    // Nothing was claimed, so there is no container to browse to either.
    expect(webLaneLinks()).toHaveLength(0);
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
    expect(screen.queryByRole("link", { name: "Open Dopl" })).toBeNull();
    expect(webLaneLinks()).toHaveLength(0);
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

/**
 * ⚠ THIS FENCE NOW GUARDS *HOW* THE CARD NAVIGATES, NOT WHETHER IT MAY. Until
 * 2026-08-25 it stood for "no web destination exists"; the guest lane is that
 * destination, and the ruling that added it kept the rule. The lane is reached
 * by a plain `<a href>`, so the browser performs a full load and `/c/<id>`'s
 * own server-side auth and membership fence runs. A `router.push` would swap it
 * in client-side and skip that, so the card still imports no router.
 */
describe("the claim card reaches the web by anchor, never by router", () => {
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
