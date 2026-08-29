import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge, ok } from "#/test-utils/bridge";
import type { HomeChannelsPayload } from "@/features/home/types";
import type { ChannelInfoCard } from "@/features/channels/info-card";
import {
  CHANNEL,
  CHANNEL_ID,
  HOME,
  LINK_OUT,
  MEMBERS,
  SERIES,
  SOLO_CHANNEL,
  THREADS,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * THE HOME INFO TAB, END TO END THROUGH THE REAL PAGE (Samuel's four items,
 * 2026-08-25): removable Channel-info rows, the discreet add affordance, the
 * Members section with Add person beneath it, and Thread activity.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, NOT THE COMPONENT. The tab renders the card off
 * `Channel.infoCard`, which arrives from the `/api/channels` cache — so the
 * write's optimistic patch, its reconcile and its invalidate all have to land
 * in that entry for a row to actually leave the screen. A direct mount would
 * hand the component a static prop and pass while every one of those was
 * broken.
 *
 * ⚠ THE SERVER STUB IS STATEFUL, and that is what makes "persists" a real word
 * here: the PATCH stores the card and the very next `/api/channels` read serves
 * it back. Against a stub that always answered with the shipped card, the
 * write's own `invalidate` would restore every row the operator removed — the
 * exact regression this suite exists to catch.
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

/** The stored card — the stub's whole database. */
let stored: ChannelInfoCard;

/**
 * Serve the account surface with `home` as its channel payload and `members` as
 * the roster, and PERSIST whatever the info-card PATCH sends.
 */
function serve(
  home: HomeChannelsPayload,
  members: typeof MEMBERS = MEMBERS,
  /** Hold the info-card PATCH open until this resolves — the only way to prove
   *  an assertion ran while the write was still in flight. */
  holdPatch?: Promise<void>
): void {
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (bare === "/api/home/channels") return Promise.resolve(ok(home));
      if (bare === "/api/channels") {
        return Promise.resolve(
          ok({ channels: [{ ...CHANNEL, infoCard: stored }] })
        );
      }
      if (bare === `/api/channels/${CHANNEL_ID}/members`) {
        return Promise.resolve(ok(members));
      }
      if (bare === `/api/channels/${CHANNEL_ID}/tasks`) {
        return Promise.resolve(ok(THREADS));
      }
      if (bare === `/api/channels/${CHANNEL_ID}` && opts.method === "PATCH") {
        const body = (opts.body ?? {}) as { infoCard?: ChannelInfoCard };
        if (body.infoCard) stored = body.infoCard;
        const answer = () => ok({ channel: { ...CHANNEL, infoCard: stored } });
        return holdPatch ? holdPatch.then(answer) : Promise.resolve(answer());
      }
      return (
        routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
      );
    }
  );
}

/** The last body the info-card PATCH sent, or null. */
function lastCardSent(): ChannelInfoCard | null {
  const patches = bridgeCalls(apiRequest).filter(
    (call) =>
      call.path.split("?")[0] === `/api/channels/${CHANNEL_ID}` &&
      call.opts.method === "PATCH"
  );
  const body = patches.at(-1)?.opts.body as
    | { infoCard?: ChannelInfoCard }
    | undefined;
  return body?.infoCard ?? null;
}

/** A solo container's roster: the operator, alone. */
const SOLO_MEMBERS = { members: [MEMBERS.members[0]] };

const SOLO_HOME: HomeChannelsPayload = {
  channels: [SOLO_CHANNEL],
  pendingLinks: [],
};

beforeEach(() => {
  // ⚠ `mockReset`, not `restoreMocks`. Vitest's `restoreMocks` clears
  // IMPLEMENTATIONS and leaves the recorded CALLS — and `lastCardSent()` reads
  // calls, so without this every test inherits the previous one's PATCH and
  // "wrote nothing" is unfalsifiable.
  apiRequest.mockReset();
  stored = { hidden: [], rows: [] };
  installBridge({ apiRequest });
  serve(HOME);
});

describe("Channel info — removable rows", () => {
  it("the × removes a built-in row OPTIMISTICALLY, and it stays removed across the refetch", async () => {
    // ⚠ THE PATCH IS HELD OPEN. Everything asserted before `release()` happened
    // with the write still in flight, so it can only be the optimistic patch —
    // a plain `waitFor` would pass on the reconcile a network hop later, and
    // the × would read as broken for that whole hop.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve(HOME, MEMBERS, held);

    renderHome();
    await screen.findByTestId("channel-surface");
    expect(await screen.findByText("Email")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Email from this card" })
    );

    await waitFor(() => expect(screen.queryByText("Email")).toBeNull());
    expect(lastCardSent()).toEqual({ hidden: ["email"], rows: [] });

    // Now let the server answer, and let the write's own `invalidate` re-read
    // `/api/channels` — the half that only passes if the server KEPT it.
    release();
    await waitFor(() =>
      expect(
        bridgeCalls(apiRequest).filter((c) => c.path === "/api/channels").length
      ).toBeGreaterThan(1)
    );
    expect(screen.queryByText("Email")).toBeNull();
    // The rows it did NOT name are untouched — an × is one row, not a reset.
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Last activity")).toBeInTheDocument();
  });

  it("removes a row that is already hidden without re-sending it", async () => {
    // ⚠ HIDING IS IDEMPOTENT (`info-card.ts › hideBuiltInRow`), so a card that
    // arrives with `email` hidden renders no Email row and no × for one.
    stored = { hidden: ["email"], rows: [] };
    serve(HOME);
    renderHome();
    await screen.findByTestId("channel-surface");
    await screen.findByText("Created");
    expect(screen.queryByText("Email")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove Email from this card" })
    ).toBeNull();
  });
});

describe("Channel info — the discreet add", () => {
  it("is present but INVISIBLE until the section is hovered", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    const add = await screen.findByTestId("info-card-add");
    // ⚠ CLASS ASSERTIONS, because jsdom applies no stylesheet: the contract is
    // that the wrapper rests at zero opacity and is lifted by the SECTION's
    // hover (`group/infocard`) or by focus landing inside it — never that it is
    // absent from the tree, which would cost a reflow when it appeared.
    expect(add.className).toContain("opacity-0");
    expect(add.className).toContain("group-hover/infocard:opacity-100");
    expect(add.className).toContain("focus-within:opacity-100");
    // The hover group it waits for is the ROW LIST, not the whole tab.
    expect(add.closest(".group\\/infocard")).not.toBeNull();
  });

  it("adds a custom item in place and persists it", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    fireEvent.click(await screen.findByText("Add item"));

    fireEvent.change(screen.getByLabelText("Item label"), {
      target: { value: "Phone" },
    });
    fireEvent.change(screen.getByLabelText("Item value"), {
      target: { value: "+1 555 0101" },
    });
    fireEvent.keyDown(screen.getByLabelText("Item value"), { key: "Enter" });

    await waitFor(() => expect(lastCardSent()?.rows).toHaveLength(1));
    expect(lastCardSent()?.rows[0]).toMatchObject({
      label: "Phone",
      value: "+1 555 0101",
    });
    expect(await screen.findByText("Phone")).toBeInTheDocument();
    expect(screen.getByText("+1 555 0101")).toBeInTheDocument();
  });

  it("ESCAPE cancels the draft and writes nothing", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    fireEvent.click(await screen.findByText("Add item"));
    fireEvent.change(screen.getByLabelText("Item label"), {
      target: { value: "Phone" },
    });
    fireEvent.keyDown(screen.getByLabelText("Item label"), { key: "Escape" });

    await waitFor(() => expect(screen.queryByLabelText("Item label")).toBeNull());
    expect(lastCardSent()).toBeNull();
    expect(screen.queryByText("Phone")).toBeNull();
  });

  it("edits an existing custom item in place, keeping its id", async () => {
    stored = { hidden: [], rows: [{ id: "row-1", label: "Phone", value: "old" }] };
    serve(HOME);
    renderHome();
    await screen.findByTestId("channel-surface");

    fireEvent.click(await screen.findByRole("button", { name: "Edit Phone" }));
    fireEvent.change(screen.getByLabelText("Item value"), {
      target: { value: "+1 555 0202" },
    });
    fireEvent.keyDown(screen.getByLabelText("Item value"), { key: "Enter" });

    await waitFor(() => expect(lastCardSent()?.rows[0].value).toBe("+1 555 0202"));
    // ⚠ THE ID SURVIVES AN EDIT. A new id per save would make the row a new row
    // — the × would target something that no longer exists, and the list would
    // reorder under the cursor.
    expect(lastCardSent()?.rows).toHaveLength(1);
    expect(lastCardSent()?.rows[0].id).toBe("row-1");
  });

  it("removes a custom item with the same × the built-ins carry", async () => {
    stored = { hidden: [], rows: [{ id: "row-1", label: "Phone", value: "x" }] };
    serve(HOME);
    renderHome();
    await screen.findByTestId("channel-surface");
    await screen.findByText("Phone");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Phone from this card" })
    );
    await waitFor(() => expect(lastCardSent()).toEqual({ hidden: [], rows: [] }));
    await waitFor(() => expect(screen.queryByText("Phone")).toBeNull());
  });
});

describe("Members", () => {
  /**
   * ⚠ THE ROW IS THE CHANNELS PAGE'S ROW, and these are the marks the
   * home-local copy was missing when Samuel saw it (*"I don't know why you're
   * making it different"*): the EMAIL subline and the role pill. Both surfaces
   * render `channels-v2/member-roster.tsx › MemberRoster`, so a regression here
   * is a change to that shared component and shows up on both pages at once.
   */
  it("renders the channels-page row — name, EMAIL and role — for a peer channel", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    const roster = await screen.findByTestId("channel-members");

    expect(within(roster).getByText("Sam Wang")).toBeInTheDocument();
    expect(within(roster).getByText("Priya Shah")).toBeInTheDocument();
    // The subline the first pass dropped.
    expect(within(roster).getByText("sam@usedopl.com")).toBeInTheDocument();
    expect(within(roster).getByText("priya@shahco.tax")).toBeInTheDocument();
    // The role chip a channel roster carries (INVARIANTS §5).
    expect(within(roster).getByText("Owner")).toBeInTheDocument();
    expect(within(roster).getByText("Member")).toBeInTheDocument();
  });

  it("shows a Guest pill for a peer who claimed a guest link (channel role is member)", async () => {
    // ⚠ M3. A link-claimed guest reads channel role `member` (§4A), so without
    // the workspaceRole tell the operator could not see whom they invited as a
    // guest. The pill reads Guest, not Member.
    const guestRoster = {
      members: [
        MEMBERS.members[0],
        { ...MEMBERS.members[1], workspaceRole: "guest" as const },
      ],
    };
    serve(HOME, guestRoster);
    renderHome();
    await screen.findByTestId("channel-surface");
    const roster = await screen.findByTestId("channel-members");
    expect(within(roster).getByText("Owner")).toBeInTheDocument();
    expect(within(roster).getByText("Guest")).toBeInTheDocument();
  });

  it("STALE CACHE: a roster row with no workspaceRole shows the plain role, never Guest", async () => {
    // ⚠ A cached members payload minted before M3 carries no workspaceRole. The
    // row must fall back to its channel role, never crash or flash Guest.
    const stale = MEMBERS.members.map((m) => {
      const clone: Partial<typeof m> = { ...m };
      delete clone.workspaceRole;
      return clone;
    });
    serve(HOME, { members: stale } as typeof MEMBERS);
    renderHome();
    await screen.findByTestId("channel-surface");
    const roster = await screen.findByTestId("channel-members");
    expect(within(roster).getByText("Owner")).toBeInTheDocument();
    expect(within(roster).getByText("Member")).toBeInTheDocument();
    expect(within(roster).queryByText("Guest")).toBeNull();
  });

  it("renders the operator ALONE on a solo channel — never an empty state", async () => {
    serve(SOLO_HOME, SOLO_MEMBERS);
    renderHome();
    await screen.findByTestId("channel-surface");
    const roster = await screen.findByTestId("channel-members");
    expect(within(roster).getByText("Sam Wang")).toBeInTheDocument();
    expect(within(roster).queryByText("Priya Shah")).toBeNull();
    // ⚠ `emptyLine` is OFF here on purpose: the caller is always a member of
    // their own container, so that sentence could only ever flash during the
    // roster read's first frame, and it would be false.
    expect(screen.queryByText(/No members in this channel/i)).toBeNull();
  });

  it("puts Add person UNDER the roster", async () => {
    serve(SOLO_HOME, SOLO_MEMBERS);
    renderHome();
    await screen.findByTestId("channel-surface");
    const heading = await screen.findByText("Members");
    const add = screen.getByRole("button", { name: "Add person" });
    // ⚠ ORDER IS THE ASSERTION (Samuel, 2026-08-25). `DOCUMENT_POSITION_
    // FOLLOWING` says the button comes AFTER the heading in document order —
    // the control belongs beside the list it changes, not at the tab's foot.
    expect(
      heading.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("KEEPS Add person once a peer has arrived — there is no cap", async () => {
    // 🔒 THE RULING, PINNED (Samuel, 2026-08-26: a home channel takes MORE THAN
    // TWO people). The default fixture's channel already HAS a peer, and this
    // used to assert the control was gone. Adding the next person is the same
    // act as adding the first, so the affordance must survive the first claim.
    renderHome();
    await screen.findByTestId("channel-surface");
    await screen.findByText("Members");
    expect(
      screen.getByRole("button", { name: "Add person" })
    ).toBeInTheDocument();
  });

  it("shows the Link out panel instead when an invitation is already out", async () => {
    serve(
      {
        channels: [{ ...SOLO_CHANNEL, linkOut: LINK_OUT }],
        pendingLinks: [],
      },
      SOLO_MEMBERS
    );
    renderHome();
    await screen.findByTestId("channel-surface");
    const surface = screen.getByTestId("channel-surface");
    expect(await within(surface).findByText("Link out")).toBeInTheDocument();
    // ⚠ ONE SECTION, TWO STATES, AND NEVER BOTH — this is the rule the cap's
    // retirement did NOT take with it. A container may hold at most ONE open
    // link at a time, so offering the act beside a live invitation would mint
    // over a URL the operator has already sent.
    expect(
      within(surface).queryByRole("button", { name: "Add person" })
    ).toBeNull();
  });
});

describe("Thread activity", () => {
  /**
   * ⚠ THE VISUAL IS THE CHANNELS PAGE'S DENSITY STRIP AND THE NUMBERS ARE REAL
   * (Samuel, 2026-08-25 — this replaces the plain thread LIST the first pass
   * substituted). What it must never become again is that page's FIXTURE: the
   * squares are only honest because a counted series is behind them.
   */
  it("draws the strip from the channel-scoped series", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    expect(await screen.findByText("Thread activity")).toBeInTheDocument();

    const strip = await screen.findByRole("img", { name: /Messages in this channel/i });
    expect(strip.children).toHaveLength(SERIES.days.length);
    // The label states the unit and the window — a bare row of squares that
    // names neither is a picture the reader has to guess at.
    expect(strip.getAttribute("aria-label")).toContain("per day");
  });

  it("⚠ asks for THIS CHANNEL, not the container's whole workspace", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    await screen.findByRole("img", { name: /Messages in this channel/i });

    const call = bridgeCalls(apiRequest).find((c) =>
      c.path.includes("/overview-series")
    );
    expect(call).toBeTruthy();
    // Today a link container holds exactly one channel, so an UNSCOPED series
    // would look identical and be right by accident. It would stop being right
    // the moment that stops being true, and nothing would say so.
    expect(call?.path).toContain(`channelId=${CHANNEL_ID}`);
    expect(call?.path).toContain("metric=messages");
  });

  it("renders NO squares rather than empty wells when the series cannot answer", async () => {
    // A stale persisted cache entry, or a read still in flight: an empty well
    // is a MEASURED zero, so 31 of them would state a month of quiet nobody
    // counted.
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) =>
        path.split("?")[0].endsWith("/overview-series")
          ? Promise.resolve(ok({ metric: "messages" }))
          : (routes(path, opts) ??
            Promise.reject(new Error(`unexpected: ${path}`)))
    );
    renderHome();
    await screen.findByTestId("channel-surface");
    expect(await screen.findByText("Thread activity")).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Messages in this channel/i })
    ).toBeNull();
  });
});

describe("section order", () => {
  it("is header → Channel info → Thread activity → Members", async () => {
    renderHome();
    await screen.findByTestId("channel-surface");
    const main = await screen.findByText("Channel info");
    const activity = screen.getByText("Thread activity");
    const members = screen.getByText("Members");
    // ⚠ Samuel corrected this order on the day it shipped — Members had been
    // second. Document position is the only thing that can hold it: both
    // sections render identically wherever they sit.
    expect(
      main.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      activity.compareDocumentPosition(members) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

/**
 * ⚠ THE STALE-CACHE CASE, and it is a CRASH rather than a cosmetic gap. The
 * channel list is IndexedDB-persisted with a 24h `gcTime`, so the first launch
 * after an update reads entries written by the previous bundle — which have no
 * `infoCard` key at all. A direct `channel.infoCard.hidden` read throws and the
 * whole pane goes blank, for a field that is decoration over facts that are all
 * still on screen.
 */
describe("a cache entry written before the info card existed", () => {
  it("renders the shipped card instead of throwing", async () => {
    apiRequest.mockImplementation(
      (path: string, opts: BridgeRequestOpts = {}) => {
        if (path.split("?")[0] === "/api/channels") {
          // The field is DELETED from the fixture, not set to null or {} — a
          // stale entry does not carry the key.
          const stale: Record<string, unknown> = { ...CHANNEL };
          delete stale.infoCard;
          return Promise.resolve(ok({ channels: [stale] }));
        }
        return (
          routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
        );
      }
    );
    renderHome();
    await screen.findByTestId("channel-surface");
    expect(await screen.findByText("Channel info")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    // And the add affordance still works off the empty card.
    expect(screen.getByTestId("info-card-add")).toBeInTheDocument();
  });
});
