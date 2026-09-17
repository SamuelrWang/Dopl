import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelInfoTabContext } from "@/features/channels/components/channel-surface";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { USER_ID, installBridge, ok } from "#/test-utils/bridge";
import { fixtureSearchFetcher } from "@/features/search/search-fixtures";
import { openChannels, renderHome, routes } from "./home-test-harness";

/**
 * 🔒 **THE /home HEADER FIELD OPENS THE SEARCH POPUP AND NARROWS NOTHING (Samuel,
 * 2026-09-17:** *"right now, during search, it just filters by channel name, and
 * it like removes channel on the left sidebar. that doesnt make sense, it should
 * be a pop up like this."*).
 *
 * ⚠ **ITS OWN FILE BECAUSE `index.test.tsx` SITS AT THE 500-LINE CAP**
 * (`eslint.config.mjs › max-lines`, an error over `apps/*​/src/**`) — these two
 * cases pushed it to 518. One file per reason to change (INVARIANTS §1): this one
 * changes when the popup's HOST WIRING does, `index.test.tsx` when the page's
 * layout or its reads do.
 *
 * ⚠ **THE ENDPOINT IS ANSWERED BY THE FIXTURE TABLE, THROUGH THE REAL CLIENT.**
 * The page mounts `search-client.ts › apiSearchFetcher` for real; what this file
 * stubs is the BRIDGE under it (`window.dopl.apiRequest`, as every /home suite
 * does), and the body it hands back is `search-fixtures.ts`'s own — so the rows
 * are stated once and the request path under test is the shipped one.
 *
 * ⚠ **THE CARD'S OWN BEHAVIOUR IS NOT HERE** — the debounce, the arrow order, the
 * sanitiser and the recents are `src/features/search/components/search-popup.test.tsx`
 * and `› use-search.test.ts`, over a stub fetcher. What this file pins is the two
 * things only the PAGE can answer: that the column no longer narrows, and where a
 * row lands.
 */

/** ⚠ THE SAME MOCK EVERY /home SUITE INSTALLS — `window.dopl.apiRequest`, not
 *  `fetch` (the page reads over both clients; the harness carries why). */
const apiRequest = vi.hoisted(() => vi.fn());

/** ⚠ THE CHANNELS SURFACE IS STUBBED, exactly as `index.test.tsx` stubs it: it is
 *  the channels feature's tree and is covered there. */
vi.mock("@/features/channels/components/channel-surface-standalone", async () => {
  const { infoTabContext } = await import("./surface-slot-fixtures");
  return {
    StandaloneChannelSurface: (props: {
      channel: { id: string };
      slots?: { infoTab?: (ctx: ChannelInfoTabContext) => React.ReactNode };
    }) => (
      <div data-testid="channel-surface" data-channel={props.channel.id}>
        {props.slots?.infoTab?.(infoTabContext())}
      </div>
    ),
  };
});

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation((path: string, opts: BridgeRequestOpts = {}) => {
    const [route, qs] = path.split("?");
    if (route === "/api/search") {
      const params = new URLSearchParams(qs ?? "");
      return fixtureSearchFetcher({
        q: params.get("q") ?? "",
        scope: "account",
        signal: new AbortController().signal,
      }).then(ok);
    }
    return (
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected request: ${path}`))
    );
  });
  installBridge({
    apiRequest: (path: string, opts: BridgeRequestOpts = {}) => apiRequest(path, opts),
    getAuthState: () => Promise.resolve({ signedIn: true, userId: USER_ID }),
    onAuthState: () => () => {},
    openExternal: () => Promise.resolve({ ok: true }),
  });
  globalThis.localStorage?.clear();
});

/** ⚠ `LIST_CELL` is the header's list-width cell, escaped for `closest` — the
 *  pill is a PAGE control and must not sit inside it (Samuel, 2026-09-15). */
const LIST_CELL = ".w-\\[var\\(--home-list-w\\)\\]";

describe("/home's search field", () => {
  /**
   * 🔒 **TYPING OPENS THE SEARCH POPUP AND LEAVES THE LIST ALONE (Samuel,
   * 2026-09-17:** *"right now, during search, it just filters by channel name,
   * and it like removes channel on the left sidebar. that doesnt make sense, it
   * should be a pop up like this."*). This case REPLACES "searching filters the
   * list by name and email" — the narrowing it asserted is deleted, and what
   * stands in its place is the absence of it.
   */
  it("🔒 typing leaves the list alone and opens the popup", async () => {
    renderHome();
    await openChannels();

    // 🔒 ALWAYS EXPANDED (Samuel, 2026-09-13): no toggle, the field is reachable
    // at once and reads "Search…".
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Search…");
    // 🔒 AND IT IS A PAGE CONTROL, NOT THE COLUMN'S HEAD (Samuel, 2026-09-15:
    // "move the search bar back") — it spent one revision in the list-width cell.
    expect(screen.getByLabelText("Search").closest(LIST_CELL)).toBeNull();

    const field = screen.getByLabelText("Search");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "nobody-at-all" } });

    // ⚠ THE CARD ARRIVES (debounce + the fetch), and the ROWS ARE STILL THERE —
    // a query that matches no channel used to empty this column.
    expect(await screen.findByRole("listbox", { name: "Search results" })).toBeInTheDocument();
    expect(screen.getAllByText("Priya Shah").length).toBeGreaterThan(0);
    expect(screen.getByText("Link out")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });

  /**
   * 🔒 **AND TAKING A ROW OPENS WHAT IT NAMES — THIS PAGE'S ANSWER TO THE
   * POPUP'S `onNavigate` (2026-09-17).** On /home a jump is a SELECTION PLUS A
   * FACE and never a route (`use-activity-jump.ts` carries why: a home channel
   * lives in a container, and containers have no page), so a KNOWLEDGE hit is
   * observable as the Knowledge face being raised from wherever the operator was.
   * ⚠ The rows are the FIXTURE table's while `GET /api/search` is built
   * (`@/features/search/search-fixtures`); what is pinned here is the mapping,
   * which does not change when the real fetcher replaces it.
   */
  it("🔒 a Knowledge hit raises the Knowledge face", async () => {
    renderHome();
    await openChannels();

    const field = screen.getByLabelText("Search");
    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "orchestrator" } });

    fireEvent.click(await screen.findByText("Desktop Orchestrator Protocol"));
    await screen.findByRole("tab", { name: "Knowledge", selected: true });
  });

});
