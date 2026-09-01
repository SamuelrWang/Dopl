import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, bridgeCalls, installBridge } from "#/test-utils/bridge";
import {
  LINK_OUT,
  LINK_WORKSPACE_ID,
  SEVEN_DAYS_MS,
  SOLO_CHANNEL,
  openChannelRecord,
  openChannels,
  renderHome,
  routes,
  withHome,
} from "./home-test-harness";

/**
 * /home — THE INVITATION LIFECYCLE: minting a link on a channel, revoking one,
 * and the two-state rule that an invitation already out replaces the act.
 *
 * ⚠ SPLIT OUT OF `index.test.tsx` ON 2026-09-01, when that suite crossed the
 * 500-line cap again (`eslint.config.mjs › max-lines`, an error over
 * `apps/*​/src/**`) — the same pressure that produced `home-test-harness.tsx`
 * in the first place, answered the same way. The seam is a real one: this file
 * changes when the LINK mechanics do, `index.test.tsx` when the page's shape
 * does. Both read the one harness, so there is still exactly one `HOME`.
 *
 * ⚠ THE SURFACE STUB IS PER-FILE, NOT IN THE HARNESS — `vi.mock` is hoisted and
 * its factory may not close over module imports. The harness says so at its
 * head; 12 lines of stub is cheaper than a hoisting trap.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: (props: {
      slots?: {
        infoTab?: (ctx: {
          gate: { begin: () => void; end: () => void };
        }) => React.ReactNode;
      };
    }) => (
      <div data-testid="channel-surface">
        {props.slots?.infoTab?.({ gate: { begin: () => {}, end: () => {} } })}
      </div>
    ),
  })
);

describe("home link lifecycle", () => {
  beforeEach(() => {
    // ⚠ `restoreMocks` resets implementations, NOT the recorded calls of a
    // hoisted `vi.fn()` — and this suite inspects requests.
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

  it("mints a link with the picked window as an absolute future instant", async () => {
    // ⚠ FROM THE CHANNEL'S OWN Info tab (2026-08-25), not the page header: the
    // act belongs to the container it binds to. (A SOLO channel is used here
    // because it has no open link — the two-state rule, not a capacity one.)
    apiRequest.mockImplementation(
      withHome({ channels: [SOLO_CHANNEL], pendingLinks: [] })
    );
    renderHome();
    await openChannelRecord();

    fireEvent.click(screen.getByRole("button", { name: "Add person" }));
    // ⚠ `find`, not `get`: Add person opens a `StandardDialog` since
    // 2026-08-27 (it was a Popover, which rendered synchronously), and
    // `ModalShell` mounts a FRAME after `open` flips so it can animate in.
    const create = await screen.findByRole("button", { name: "Create link" });
    const before = Date.now();
    fireEvent.click(create);

    await waitFor(() => {
      const mint = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/home/links" && c.opts.method === "POST"
      );
      expect(mint).toBeDefined();
      const body = mint?.opts.body as {
        expiresAt: string;
        workspaceId: string;
        maxUses?: number;
      };
      // ⚠ THE LINK IS BOUND to the selected channel's container — an unbound
      // mint is not a thing any more, and `maxUses` is not a field the client
      // may send: a bound link admits ONE named person by construction.
      expect(body.workspaceId).toBe(LINK_WORKSPACE_ID);
      expect(body.maxUses).toBeUndefined();
      // The picker's default: 7 days. The WINDOW is relative; what leaves is an
      // instant, because that is what the route validates.
      const delta = Date.parse(body.expiresAt) - before;
      expect(delta).toBeGreaterThan(SEVEN_DAYS_MS - 5_000);
      expect(delta).toBeLessThan(SEVEN_DAYS_MS + 5_000);
    });
  });

  it("revokes a pending link and re-reads the list", async () => {
    renderHome();
    await openChannels();

    fireEvent.click(screen.getByText("Link out"));
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      const revoke = bridgeCalls(apiRequest).find(
        (c) => c.path === "/api/home/links/link-1"
      );
      expect(revoke?.opts.method).toBe("DELETE");
    });
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).filter((c) => c.path === "/api/home/channels")
          .length
      ).toBeGreaterThan(1)
    );
  });

  it("wears the Link out chip and offers Revoke where Add person was", async () => {
    // ⚠ ONE SECTION, TWO STATES, and this is the rule that SURVIVED the member
    // cap's retirement. An invitation already out IS the answer to "add a
    // person": a container may hold at most one OPEN link at a time, so
    // offering the act again would mint over a URL already sent.
    apiRequest.mockImplementation(
      withHome({
        channels: [{ ...SOLO_CHANNEL, linkOut: LINK_OUT }],
        pendingLinks: [],
      })
    );
    renderHome();
    await openChannelRecord();

    // TWICE, and both are load-bearing: the chip names it on the ROW, where you
    // scan for it, and the section heading names it INSIDE the channel, where
    // you act on it.
    expect(screen.getAllByText("Link out")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add person" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      const revoke = bridgeCalls(apiRequest).find(
        (c) => c.path === `/api/home/links/${LINK_OUT.id}`
      );
      expect(revoke?.opts.method).toBe("DELETE");
    });
    // Revoking re-reads the channels; the chip clears with the payload, never
    // by a cache edit here.
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).filter((c) => c.path === "/api/home/channels")
          .length
      ).toBeGreaterThan(1)
    );
  });
});
