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
  openChannelRecord,
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

  /**
   * 🔒 **THE HEADER IS THE CHANNEL (Samuel, 2026-09-01).** These three cases
   * replace the ones that pinned the OPPOSITE — a header titled
   * "Priya Shah, Dana Ruiz +1" over that peer's email, and a Channel-info Email
   * row that appeared at exactly one member. Together they made the Info tab
   * turn into a member's profile the moment somebody joined.
   */
  it("titles the header by the CHANNEL, however many people are in it", async () => {
    serve(CROWDED);
    renderHome();
    // ⚠ SCOPED TO THE SURFACE: the list row and this header render the same
    // `channelTitle`, so an unscoped query finds two. The two faces of one
    // channel agreeing is the point — see `home-rows.test.ts` for the title's
    // own cases.
    const surface = await openChannelRecord();

    expect(
      await within(surface).findByText(CROWDED_CHANNEL.name)
    ).toBeInTheDocument();
    // The roster is not the heading, in either of its old forms.
    expect(within(surface).queryByText(/Priya Shah, Dana Ruiz/)).toBeNull();
    expect(within(surface).queryByText("3 people")).toBeNull();
  });

  it("keeps every member's address in the ROSTER and out of the header", async () => {
    // 🔒 THE DECISION, PINNED. An address belongs beside the face it belongs
    // to; in a header it reads as a fact about the channel.
    serve(CROWDED);
    renderHome();
    const surface = await openChannelRecord();

    // ⚠ SCOPED TO THE HEADER'S OWN BLOCK, NOT to the surface — because the
    // address SHOULD still be on this tab, one section down in the roster. An
    // unscoped `queryByText(...).toBeNull()` would pass only by ALSO asserting
    // the roster had lost it, which is the opposite of the ruling.
    const header = (
      await within(surface).findByText(CROWDED_CHANNEL.name)
    ).parentElement as HTMLElement;

    expect(within(header).queryByText("priya@shahco.tax")).toBeNull();
    expect(within(surface).getByText("priya@shahco.tax")).toBeInTheDocument();
  });

  it("has NO Channel-info Email row at ANY roster size", async () => {
    // ⚠ The row used to render at exactly ONE peer — absent on a solo channel
    // and dropped again above one — so the card gained and lost a stranger's
    // address as people came and went. It is gone at every size now. ⚠ NOT
    // replaced by N Email rows: the card is curated and capped, and the roster
    // IS that list.
    serve(CROWDED);
    renderHome();
    await openChannelRecord();
    await screen.findByText("Channel info");
    expect(screen.queryByText("Email")).toBeNull();

    serve(HOME);
    renderHome();
    await screen.findAllByText("Channel info");
    expect(screen.queryByText("Email")).toBeNull();
  });

  it("still offers Add person — a fourth member joins the same way the third did", async () => {
    serve(CROWDED);
    renderHome();
    await openChannelRecord();
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
    const surface = await openChannelRecord();

    // ⚠ THE ASSERTION MOVED TO THE ROSTER (2026-09-01). It used to be the
    // HEADER's title, which is the channel's name now whatever the cache holds
    // — so a title assertion would pass even if the merge had degraded to
    // "nobody". The roster is where the peers actually surface, and it is the
    // only place the fallback is observable.
    expect(await within(surface).findByText("Priya Shah")).toBeInTheDocument();
    expect(within(surface).getByText("priya@shahco.tax")).toBeInTheDocument();
  });
});

