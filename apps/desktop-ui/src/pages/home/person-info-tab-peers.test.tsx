import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { installBridge, ok } from "#/test-utils/bridge";
import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type { HomeChannelsPayload } from "@/features/home/types";
import {
  CHANNEL,
  CHANNEL_ID,
  CROWDED_CHANNEL,
  HOME,
  MEMBERS,
  THREADS,
  renderHome,
  routes,
  staleCachedChannel,
} from "./home-test-harness";

/**
 * THE HOME INFO TAB WITH MORE THAN TWO PEOPLE IN IT (Samuel's ruling,
 * 2026-08-26 — F-307's fix).
 *
 * ⚠ SPLIT OUT OF `person-info-tab.test.tsx`, WHICH WAS AT THE 500-LINE CAP
 * (INVARIANTS §1 — a file at the cap cannot absorb a case, let alone the
 * paragraph explaining one). The seam is a REASON TO CHANGE: that file is about
 * the CURATED CARD — removable built-ins, the discreet add, persistence through
 * the PATCH — and this one is about what the tab does as the ROSTER GROWS. Its
 * stub is deliberately READ-ONLY for the same reason: nothing here writes.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, not the component, exactly as the parent file
 * is — the header reads `HomeChannel` off the `/api/home/channels` cache, so a
 * direct mount would hand it a static prop and pass while the read was broken.
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

/** Serve the account surface with `home` as its channel payload. Read-only: the
 *  card never changes in this file, so there is no stored state to keep. */
function serve(home: HomeChannelsPayload): void {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (bare === "/api/home/channels") return Promise.resolve(ok(home));
      if (bare === "/api/channels") {
        return Promise.resolve(
          ok({ channels: [{ ...CHANNEL, infoCard: EMPTY_INFO_CARD }] })
        );
      }
      if (bare === `/api/channels/${CHANNEL_ID}/members`) {
        return Promise.resolve(ok(MEMBERS));
      }
      if (bare === `/api/channels/${CHANNEL_ID}/tasks`) {
        return Promise.resolve(ok(THREADS));
      }
      return (
        routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
      );
    }
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  installBridge({ apiRequest });
  serve(HOME);
});

describe("MORE THAN TWO people (Samuel, 2026-08-26 — F-307)", () => {
  const CROWDED: HomeChannelsPayload = {
    channels: [CROWDED_CHANNEL],
    pendingLinks: [],
  };

  it("titles the header by two names and counts the rest", async () => {
    serve(CROWDED);
    renderHome();
    // ⚠ SCOPED TO THE SURFACE, and the reason is a FEATURE: the list row and
    // this header both render `channelTitle`, so an unscoped query finds two.
    // The two faces of one channel agreeing is exactly the point of sharing the
    // presenter — see `home-rows.test.ts` for the title's own cases.
    const surface = await screen.findByTestId("channel-surface");

    expect(
      await within(surface).findByText("Priya Shah, Dana Ruiz +1")
    ).toBeInTheDocument();
  });

  it("replaces the header's email subline with the size of the room", async () => {
    // 🔒 THE DECISION, PINNED. One address under a title naming two OTHER people
    // reads as theirs. The addresses are in the roster below, beside the faces
    // they belong to.
    serve(CROWDED);
    renderHome();
    const surface = await screen.findByTestId("channel-surface");

    // ⚠ SCOPED TO THE HEADER'S OWN TEXT BLOCK (the title's parent), NOT to the
    // surface — because the address SHOULD still be on this tab, one section
    // down in the roster, beside the face it belongs to. That is the whole
    // decision: the email did not disappear, it moved somewhere it can be
    // attributed. An unscoped `queryByText(...).toBeNull()` would pass only by
    // also asserting the roster had lost it.
    const header = (
      await within(surface).findByText("Priya Shah, Dana Ruiz +1")
    ).parentElement as HTMLElement;

    expect(within(header).getByText("3 people")).toBeInTheDocument();
    expect(within(header).queryByText("priya@shahco.tax")).toBeNull();
    expect(within(surface).getByText("priya@shahco.tax")).toBeInTheDocument();
  });

  it("DROPS the Channel-info Email row above one peer, and keeps it at exactly one", async () => {
    // ⚠ The row was already absent on a SOLO channel for the mirror reason — it
    // answers a question nobody asked. With three members it answers the wrong
    // person. ⚠ NOT replaced by three Email rows: the card is curated and
    // capped, and the roster IS that list.
    serve(CROWDED);
    renderHome();
    await screen.findByTestId("channel-surface");
    await screen.findByText("Channel info");
    expect(screen.queryByText("Email")).toBeNull();

    serve(HOME);
    renderHome();
    expect(await screen.findByText("Email")).toBeInTheDocument();
  });

  it("still offers Add person — a fourth member joins the same way the third did", async () => {
    serve(CROWDED);
    renderHome();
    await screen.findByTestId("channel-surface");
    await screen.findByText("Members");

    expect(
      screen.getByRole("button", { name: "Add person" })
    ).toBeInTheDocument();
  });

  it("🔒 renders a STALE CACHE ENTRY as its single peer, not as a solo channel", async () => {
    // INVARIANTS §8. The key `peers` is DELETED — what the IndexedDB cache
    // actually serves on the first paint after this upgrade. Falling back to
    // "nobody" would paint the operator's channels as solo, which is FALSE;
    // falling back to `peer` is merely the pre-upgrade answer.
    serve({ channels: [staleCachedChannel()], pendingLinks: [] });
    renderHome();
    const surface = await screen.findByTestId("channel-surface");

    expect(await within(surface).findByText("Priya Shah")).toBeInTheDocument();
    expect(screen.queryByText("Just you")).toBeNull();
    // The one-peer surface is intact, Email row included.
    expect(await within(surface).findByText("Email")).toBeInTheDocument();
  });
});

