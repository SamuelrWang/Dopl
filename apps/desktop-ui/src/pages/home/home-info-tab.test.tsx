import { screen, within } from "@testing-library/react";
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
  SOLO_CHANNEL,
  THREADS,
  openChannelRecord,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * THE HOME CHANNEL'S INFO TAB, END TO END THROUGH THE REAL PAGE (Samuel's four
 * items, 2026-08-25): removable Channel-info rows, the discreet add affordance,
 * the Members section with Add person beneath it, and channel activity.
 *
 * ⚠ **RENAMED OFF `person-info-tab.test.tsx` IN WAVE 1A (2026-09-17), AND WHAT
 * IT MOUNTS CHANGED UNDER IT WHILE THE CASES DID NOT.** It pinned a /home-LOCAL
 * Info body injected through the body-REPLACING `infoTab` slot; that body is
 * deleted and the /home host now adds ONE region
 * (`channel-surface-contract.ts › ChannelInfoExtras.belowRoster`) to the shared
 * `channels/components/info-tab.tsx`. **Every case below is unchanged** — which
 * is the finding, not a coincidence: what they always asserted is what the /home
 * HOST puts on screen, and that was never the fork's to own.
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

// ⚠ ONE STUB, FIVE FILES (`surface-slot-fixtures.tsx`). It imports the REAL
// `ChannelInfoTabContext`, so a slot contract that grows a field fails to compile here
// instead of passing against a hand-written shape that has quietly gone stale.
// ⚠ THE FACTORY IMPORTS IT ITSELF: `vi.mock` is hoisted above every import, so a
// top-level binding is not in scope yet when this runs.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
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

describe("Channel info — the fixed rows", () => {
  /**
   * 🔒 NAME · CREATOR · CREATED · LAST ACTIVITY ARE FIXED AND PERMANENT (Samuel,
   * 2026-09-12: *"add Creator as a field, under name. Remove the ability to
   * remove the created and last activity fields, the 4 fields there will now be
   * fixed and permanent"*). No × on any of them; only custom rows carry one.
   */
  it("renders Name, Creator, Created in that order, none removable", async () => {
    renderHome();
    await openChannelRecord();
    await screen.findByText("Created");

    const labels = ["Name", "Creator", "Created"].map(
      (label) => screen.getByText(label)
    );
    // Pairwise the list is ascending in document order.
    for (let i = 1; i < labels.length; i++) {
      expect(
        labels[i - 1]!.compareDocumentPosition(labels[i]!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    for (const label of ["Name", "Creator", "Created"]) {
      expect(
        screen.queryByRole("button", { name: `Remove ${label} from this card` })
      ).toBeNull();
    }
    expect(lastCardSent()).toBeNull();
  });

  it("names the creator from the roster the surface already holds", async () => {
    renderHome();
    await openChannelRecord();
    // `CHANNEL.createdBy` is `USER_ID`, whose roster row is "Sam Wang". The
    // roster prints the same name one section down, so the pin is POSITION:
    // one "Sam Wang" sits between the "Creator" and "Created" labels.
    const names = await screen.findAllByText("Sam Wang");
    const creatorLabel = screen.getByText("Creator");
    const createdLabel = screen.getByText("Created");
    const between = names.some(
      (el) =>
        creatorLabel.compareDocumentPosition(el) &
          Node.DOCUMENT_POSITION_FOLLOWING &&
        el.compareDocumentPosition(createdLabel) &
          Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(between).toBe(true);
  });

  it("ignores a stored `hidden` key — the row is fixed, the stored state is inert", async () => {
    // ⚠ A card written while the × existed may still carry `created`/`email`
    // in `hidden`. `info-card.ts` keeps the union so those rows validate; this
    // tab now renders every built-in regardless, and sends nothing.
    stored = { hidden: ["created", "email"], rows: [] };
    serve(HOME);
    renderHome();
    await openChannelRecord();
    expect(await screen.findByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.queryByText("Email")).toBeNull();
    expect(lastCardSent()).toBeNull();
  });
});

describe("Channel info — the add affordance is GONE", () => {
  /**
   * ⚠ **DELETED 2026-09-15 (Samuel): *"remove the ability to add an item … make
   * sure code cleanly deleted. EXCEPT, I want you to comment out the UI of the add
   * item button. Cuz I might reuse the UI down the line."*** Three cases stood here
   * and pinned the whole interaction — the affordance invisible until hover, a
   * custom item added in place and persisted, ESCAPE cancelling the draft without
   * writing. They are replaced by one case pinning the DELETION, because the thing
   * most likely to go wrong now is a revival nobody asked for.
   *
   * ⚠ **READING AND REMOVING SURVIVE AND ARE PINNED ELSEWHERE**: stored custom rows
   * still render and still carry their hover ×. What went is CREATE.
   */
  it("draws no add row, and writes nothing", async () => {
    renderHome();
    await openChannelRecord();
    await screen.findByText("Channel info");
    expect(screen.queryByTestId("info-card-add")).toBeNull();
    // ⚠ NOT a blanket /add/i sweep: "Add person" lives under the roster one section
    // down and is a different control Samuel did not touch. Asserting its absence
    // here would make this case fail the day that button is renamed.
    expect(lastCardSent()).toBeNull();
  });
});

describe("Members", () => {
  /**
   * ⚠ THE ROW IS THE CHANNELS PAGE'S ROW, and these are the marks the
   * home-local copy was missing when Samuel saw it (*"I don't know why you're
   * making it different"*): the EMAIL subline and the role pill. Both surfaces
   * render `channels/components/member-roster.tsx › MemberRoster`, so a regression here
   * is a change to that shared component and shows up on both pages at once.
   */
  it("renders the channels-page row — name, EMAIL and role — for a peer channel", async () => {
    renderHome();
    await openChannelRecord();
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
    await openChannelRecord();
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
    await openChannelRecord();
    const roster = await screen.findByTestId("channel-members");
    expect(within(roster).getByText("Owner")).toBeInTheDocument();
    expect(within(roster).getByText("Member")).toBeInTheDocument();
    expect(within(roster).queryByText("Guest")).toBeNull();
  });

  it("renders the operator ALONE on a solo channel — never an empty state", async () => {
    serve(SOLO_HOME, SOLO_MEMBERS);
    renderHome();
    await openChannelRecord();
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
    await openChannelRecord();
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
    await openChannelRecord();
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
    await openChannelRecord();
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


describe("section order", () => {
  it("is Channel info → Name → Channel activity → Members, with no name heading above", async () => {
    renderHome();
    await openChannelRecord();
    const main = await screen.findByText("Channel info");
    const activity = screen.getByText("Channel activity");
    const members = screen.getByText("Members");
    // ⚠ Samuel corrected this order on the day it shipped — Members had been
    // second. Document position is the only thing that can hold it: both
    // sections render identically wherever they sit.
    // ⚠ AND THE NAME IS A FIELD, NOT A TITLE (Samuel, 2026-09-05, live review of
    // this pane). It is the first row UNDER "Channel info" and nothing above the
    // heading prints it — the bold title that used to sit there is what he
    // reported as the duplicate. The activity heading says "Channel" because
    // this pane shows a channel.
    const nameLabel = screen.getByText("Name");
    expect(
      main.compareDocumentPosition(nameLabel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      nameLabel.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(screen.queryByText("Thread activity")).toBeNull();
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
    await openChannelRecord();
    expect(await screen.findByText("Channel info")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    // ⚠ And NO add affordance — deleted 2026-09-15; a stale cache entry must not
    // resurrect it either.
    expect(screen.queryByTestId("info-card-add")).toBeNull();
  });
});
