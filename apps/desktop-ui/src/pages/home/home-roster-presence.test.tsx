import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { installBridge, USER_ID } from "#/test-utils/bridge";
import { openChannelRecord, renderHome, routes } from "./home-test-harness";

/**
 * 🔒 **THE OPERATOR IS ONLINE IN THEIR OWN HOME CHANNEL — F-723.**
 *
 * ⚠ **THIS WAS RED, AND IT WAS RED ON SCREEN.** `member-roster.tsx ›
 * MemberRoster` feeds `viewerUserId` to `view-model.ts › isPresentForViewer`,
 * whose override — *the viewer is present whenever THIS desktop app is the thing
 * rendering* — fires only when the viewer is known. /home's roster
 * mounted its OWN `useChannelMembers` and passed no
 * viewer, so the operator's row fell through to the `lastSeenAt` heartbeat and
 * read OFFLINE, in the one renderer where `isSpaRenderer()` is ever true. The
 * workspace channels page, on the same machine in the same second, showed them
 * online — because the shared Info tab has passed `index.currentUserId` since
 * 2026-09-08.
 *
 * ⚠ **THE FIXTURE IS THE DEFAULT ROSTER, DELIBERATELY** (`home-test-harness.tsx
 * › MEMBERS`): the operator carries `agentOnline: false` and `lastSeenAt: null`,
 * which is the ordinary state of a member whose own machine is the one asking.
 * A fixture that made them heartbeat-present would be green with the override
 * deleted, which is the whole failure mode here.
 *
 * ⚠ **`installBridge` IS WHAT MAKES `isSpaRenderer()` TRUE** — it installs
 * `window.dopl`, which is the only thing that predicate asks (`spa-bridge.ts`).
 * So this file needs no renderer mock: it IS the renderer, as far as the rule is
 * concerned.
 *
 * ⚠ **IT IS ITS OWN FILE** rather than a case in `home-info-tab.test.tsx`,
 * which sits within a hundred lines of the 500-line cap (§1) — and because the
 * subject outlived the /home body: the roster on screen here is the SHARED one
 * now (`channels/components/info-tab.tsx`), and the assertion did not have to
 * change when the composition under it was replaced wholesale.
 */

const apiRequest = vi.hoisted(() => vi.fn());

// ⚠ ONE STUB, SIX FILES (`surface-slot-fixtures.tsx`). It mints the surface's
// own reads — including the `index` that carries the viewer — so what reaches the
// tab here is what reaches it in the shipped app.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
);

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected request: ${path}`))
  );
  installBridge({
    apiRequest: (path: string, opts: BridgeRequestOpts = {}) =>
      apiRequest(path, opts),
    getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
});

describe("the home channel roster, F-723", () => {
  it("renders the OPERATOR as present while this desktop renderer is running", async () => {
    renderHome();
    await openChannelRecord();
    const roster = within(await screen.findByTestId("channel-members"));

    // The presence face is `AvatarWithPresence`'s ring and its title, which is
    // the same fact the partition reads — so asserting the title asserts the
    // side of the `Offline` rule the row landed on.
    expect(roster.getByTitle("Agent listening")).toBeTruthy();
  });

  it("still puts a PEER with no heartbeat under the Offline rule", async () => {
    // ⚠ THE NEGATIVE HALF, AND WITHOUT IT THE CASE ABOVE PASSES AGAINST A ROSTER
    // THAT SIMPLY CALLS EVERYBODY ONLINE. The override is about ONE row: the
    // viewer's. Everybody else is still the server's `agentOnline` verdict.
    renderHome();
    await openChannelRecord();
    const roster = within(await screen.findByTestId("channel-members"));

    expect(roster.getByText("Offline")).toBeTruthy();
    expect(roster.getAllByTitle("Agent offline")).toHaveLength(1);
  });
});
