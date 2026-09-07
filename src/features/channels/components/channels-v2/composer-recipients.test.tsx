// @vitest-environment jsdom
/**
 * **TAGGING, MADE DISCOVERABLE AND ITS CONSEQUENCE MADE VISIBLE** (2026-09-02,
 * v2 wave B slice B10 — Samuel's ruling).
 *
 * The two failures this file exists to pin, both of which were SILENT:
 *
 *  - **THE PICKER OFFERED ONLY THIS MACHINE'S OWN AGENTS**, so on the web —
 *    where a guest reads the room — it offered no agent at all. A person who
 *    *"doesn't know that there's a tagging function"* had nothing to discover.
 *    It now offers the CHANNEL's live agents, which is the same set
 *    `server/service-writes-metadata-recipient.ts › liveAgentHandles` resolves
 *    a person's `to=` against.
 *  - **AND NOTHING SAID WHO WOULD ANSWER.** An untagged message looked exactly
 *    like a tagged one until nothing came back. The recipient line states the
 *    prediction `server/service-wake-verdict.ts › resolveWakeVerdict` will
 *    store — the tags, else RR1's thread party, else RR3's responder, else
 *    `nobody`.
 *
 * ⚠ **THE LAST CASE IS THE ONE THAT MATTERS**: whatever the picker put in the
 * draft, feeding it back through the SERVER'S OWN index must name the agent that
 * was picked. That is the F-210 property, restated across the namespace this
 * slice widened.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: send },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

const send = vi.fn();

import { ChannelsV2Composer } from "./composer";
import { ComposerRecipients, REACH_NOBODY } from "./composer-recipients";
import { ChannelAgentsSettings } from "./settings-channel-agents";
import {
  draftReach,
  liveAgentCandidates,
  threadOtherPartyOf,
  viewerUnaddressedResponder,
  type LiveAgentSession,
} from "../../lib/draft-recipients";
import { buildAgentMentionIndex, resolveAgentHandle } from "../../lib/agent-mentions";
// ⚠ THE FEED THE PANE DERIVES (`derivations.ts › recentAgentIds`), asked directly: the line's
// input is where the composer's half of the 15-minute expiry lived, and the component takes the
// ids already resolved.
import { recentAgentsAddressedBy } from "../../lib/agent-post-stamp";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang", email: "sam@example.com" }),
  member({
    userId: PEER,
    displayName: "Diana Taylor",
    email: "diana@example.com",
    role: "member",
  }),
];

/** A PEER's session: an agent minted on somebody else's machine, which is
 *  exactly what the old picker could not see. */
const PEER_AGENT: LiveAgentSession = { name: "k3v7d2mq", displayName: "Research Bot" };
/** Never renamed — it answers only to the `agent-<id>` form. */
const BARE_AGENT: LiveAgentSession = { name: "z9q1w4er", displayName: null };

beforeEach(() => send.mockClear());
afterEach(cleanup);

function mount(over: Partial<React.ComponentProps<typeof ChannelsV2Composer>> = {}) {
  render(
    <ChannelsV2Composer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
      {...over}
    />
  );
  return screen.getByLabelText("Message") as HTMLTextAreaElement;
}

const type = (field: HTMLTextAreaElement, value: string) =>
  fireEvent.change(field, { target: { value } });

const line = () => screen.getByLabelText("Recipients").textContent ?? "";

describe("the picker offers the CHANNEL's live agents", () => {
  it("opens on `@` and lists a PEER's agent by NAME and by HANDLE", () => {
    const body = mount({ liveAgents: [PEER_AGENT] });
    type(body, "@res");
    const row = screen.getByRole("option", { name: /Research Bot/ });
    // ⚠ BOTH strings on the row: the name is what a reader recognises, the
    // handle is what the resolver accepts — and showing only the first is what
    // left them guessing at `@Research Bot`.
    expect(row.textContent).toContain("Research Bot");
    expect(row.textContent).toContain("@research-bot");
  });

  it("🔒 inserts the EXACT token the server resolves — and it round-trips through the server's own index", () => {
    const body = mount({ liveAgents: [PEER_AGENT] });
    type(body, "hey @res");
    fireEvent.mouseDown(screen.getByRole("option", { name: /Research Bot/ }));
    expect(body.value).toBe("hey @research-bot ");
    // The index `liveAgentHandles` builds, from the same two fields.
    const index = buildAgentMentionIndex(liveAgentCandidates([PEER_AGENT]));
    expect(resolveAgentHandle("research-bot", index)).toBe("k3v7d2mq");
  });

  it("inserts `@agent-<id>` for an agent nobody has renamed", () => {
    const body = mount({ liveAgents: [BARE_AGENT] });
    type(body, "@agent-z");
    fireEvent.mouseDown(screen.getAllByRole("option")[0]);
    expect(body.value).toBe("@agent-z9q1w4er ");
  });

  it("🔒 renders NOTHING from a session but its name and its handle", () => {
    // The peer projection is narrow by construction (`collab-dto.ts ›
    // mapPeerSessionStateRow`, pinned at nine keys by `session-visibility.test.ts`).
    // This is the RENDER half: an operator-only field handed in anyway is not drawn.
    const body = mount({
      liveAgents: [{ ...PEER_AGENT, templateName: "Secret Template", model: "opus" } as never],
    });
    type(body, "@res");
    const row = screen.getByRole("option", { name: /Research Bot/ });
    expect(row.textContent).not.toContain("Secret Template");
    expect(row.textContent).not.toContain("opus");
  });

  it("still offers members, and the roster comes first", () => {
    const body = mount({ liveAgents: [PEER_AGENT] });
    type(body, "@");
    expect(screen.getAllByRole("option")[0].textContent).toContain("Diana Taylor");
  });
});

describe("the recipient line — always on, whatever the draft says", () => {
  it("names the tagged agent, by the handle that reaches it", () => {
    const body = mount({ liveAgents: [PEER_AGENT, BARE_AGENT] });
    type(body, "morning @research-bot");
    expect(line()).toContain("@research-bot");
  });

  it("names a tagged MEMBER — reach, even though it wakes nobody's agent", () => {
    const body = mount({ liveAgents: [PEER_AGENT, BARE_AGENT] });
    type(body, "@diana-taylor can you look");
    expect(line()).toContain("Diana Taylor");
  });

  /**
   * 🔒 **THE VIEWER'S OWN "No one" IS HONOURED BY THE LINE** (2026-09-07, items 10 and 11).
   *
   * ⚠ This REPLACED a test that set the channel's `defaultResponderAgentName` and expected the
   * line to name it — RR3's configured arm, deleted with the room-wide field. The case worth
   * pinning in its place is the opposite one: a member who chose "No one" must see `nobody`
   * even in a room with agents live, because the server will wake none of them. A line that
   * still named one here would be OVERSTATING reach, which this file calls worse than no line.
   *
   * ⚠ It is set on the ROSTER, not on a prop, which is the other half of the change: the
   * composer reads the viewer's own membership row rather than being handed a channel value.
   */
  it("🔒 says `nobody` when the VIEWER chose No one, with two agents live", () => {
    const body = mount({
      liveAgents: [PEER_AGENT, BARE_AGENT],
      members: [{ ...MEMBERS[0], unaddressedResponder: "none" }, MEMBERS[1]],
    });
    type(body, "who is around");
    expect(line()).toContain(REACH_NOBODY);
  });

  it("🔒 names an agent with TWO live and no nomination — the line must not say `nobody` for a post that will route", () => {
    // ⚠ THIS SAID `nobody` UNTIL 2026-09-04, and so did the server (row #966).
    // Samuel's B1 is that a forgotten `@` must never stall, so RR3 now answers
    // with the agent that spoke here last — else the one launched last, which is
    // the first candidate in the order this surface holds them.
    const body = mount({ liveAgents: [PEER_AGENT, BARE_AGENT] });
    type(body, "who is around");
    expect(line()).not.toContain(REACH_NOBODY);
    expect(line()).toContain("@research-bot");
  });

  // ⚠ TITLE CORRECTED 2026-09-06: it names the agent this user last ADDRESSED, not the one that
  // posted last — the arm changed feed on 2026-09-04 and the name here never followed.
  it("🔒 and it names the agent this user ADDRESSED last, over the ordering", () => {
    const body = mount({
      liveAgents: [PEER_AGENT, BARE_AGENT],
      recentAgentIds: [BARE_AGENT.name],
    });
    type(body, "who is around");
    expect(line()).toContain("@agent-z9q1w4er");
  });

  it("says `nobody` in an empty room, and renders BEFORE anything is typed", () => {
    mount();
    expect(line()).toContain(REACH_NOBODY);
  });

  it("takes the room's ONE live agent with no nomination at all (RR3 arm 2)", () => {
    const body = mount({ liveAgents: [PEER_AGENT] });
    type(body, "who is around");
    expect(line()).toContain("@research-bot");
  });

  it("names the thread's OTHER party for an unaddressed reply (RR1)", () => {
    const body = mount({ liveAgents: [], threadOtherParty: MEMBERS[1] });
    type(body, "sounds good");
    expect(line()).toContain("Diana Taylor");
    expect(line()).toContain("thread");
  });
});

describe("the rule itself", () => {
  // ⚠ `unaddressedResponder` IS REQUIRED ON `draftReach` SINCE 2026-09-07 and stated here once
  // rather than defaulted, for the reason the parameter is required at all: an omission would
  // land on `last_addressed` and OVERSTATE the reach for a member who chose "No one".
  const reach = (body: string, over = {}) =>
    draftReach({
      body,
      members: MEMBERS,
      sessions: [PEER_AGENT],
      currentUserId: ME,
      unaddressedResponder: "last_addressed",
      ...over,
    });

  it("does not tag from a code span — the one parser, `mentions-mask.ts`", () => {
    // ⚠ Measured, not theorised: two agents writing DOCUMENTATION about
    // @-tagging once tagged both operators for real (INVARIANTS §5).
    expect(reach("write `@research-bot` in the body").via).toBe("responder");
  });

  it("never names the AUTHOR, whatever they typed — it is not a tag, so RR3 still answers", () => {
    const out = reach("@sam-wang note to self");
    expect(out.recipients.some((r) => r.kind === "member")).toBe(false);
    expect(out.via).toBe("responder");
  });

  it("an explicit tag OUTRANKS RR3 entirely", () => {
    const out = reach("@diana-taylor over to you");
    expect(out.via).toBe("tagged");
    expect(out.recipients.map((r) => r.label)).toEqual(["Diana Taylor"]);
  });

  /**
   * 🔒 **`"none"` KILLS EVERY ARM, NOT JUST RECENCY** (2026-09-07, items 10 and 11).
   *
   * ⚠ This REPLACED "a nomination whose agent is not running degrades to the room's own
   * answer" — the arm-1 degradation case, deleted with the stored handle it degraded from.
   * The case that matters now is the reverse: with an agent live AND a recent address to it,
   * every arm below would have answered, so this is the assertion that the short-circuit is on
   * the FIRST line rather than gating recency alone. A single-agent room under "No one" going
   * on auto-answering is the exact complaint the setting came from.
   */
  it("🔒 `none` answers `nobody` even with a live agent this author just addressed", () => {
    const out = draftReach({
      body: "hello",
      members: MEMBERS,
      sessions: [PEER_AGENT, BARE_AGENT],
      currentUserId: ME,
      unaddressedResponder: "none",
      recentAgentIds: [BARE_AGENT.name],
    });
    expect(out).toMatchObject({ via: "none", reason: null });
    expect(out.recipients).toEqual([]);
  });

  /**
   * 🔒 **AN UNLOADED ROSTER READS AS THE DEFAULT, NEVER AS "No one"** (2026-09-07).
   * The fail-safe direction is the ruling: `"none"` means this person's untagged messages
   * reach nobody, so a roster that has not arrived must not be rendered as a choice they made.
   */
  it("🔒 viewerUnaddressedResponder fails to the default, not to `none`", () => {
    expect(viewerUnaddressedResponder([], ME)).toBe("last_addressed");
    // ⚠ A PEER's row is `null` — "not yours to see" — and must not be read as a setting.
    expect(
      viewerUnaddressedResponder([{ ...MEMBERS[1], unaddressedResponder: null }], PEER)
    ).toBe("last_addressed");
    expect(
      viewerUnaddressedResponder([{ ...MEMBERS[0], unaddressedResponder: "none" }], ME)
    ).toBe("none");
  });

  /**
   * 🔒 **THE COMPOSER'S HALF OF "NO WINDOW"** (Samuel, 2026-09-06). The line took its ids from
   * `recentAgentsAddressedBy` bounded by `RESILIENCE_WINDOW_MS`, so fifteen minutes after you
   * tagged an agent the line quietly began naming a different one — and since the server was
   * bounded the same way, both ends moved together and neither looked wrong. Asked over a
   * TWO-HOUR-OLD tag, the feed must still answer, and the line must still name that agent over the
   * ordering that would otherwise pick `PEER_AGENT`.
   */
  it("🔒 a two-hour-old tag still feeds the line — no expiry on the composer side either", () => {
    const recent = recentAgentsAddressedBy(ME, [
      {
        seq: 10,
        createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
        authorUserId: ME,
        recipientAgentIds: [BARE_AGENT.name],
        metadata: {},
      },
    ]);
    expect(recent).toEqual([BARE_AGENT.name]);
    const out = draftReach({
      body: "who is around",
      members: MEMBERS,
      sessions: [PEER_AGENT, BARE_AGENT],
      currentUserId: ME,
      unaddressedResponder: "last_addressed",
      recentAgentIds: recent,
    });
    expect(out.reason).toBe("most recent");
    expect(out.recipients.map((r) => r.label)).toEqual(["@agent-z9q1w4er"]);
  });

  it("an EMPTY room is still `nobody` — the arm that answers nothing is the one with nothing to answer with", () => {
    expect(
      draftReach({
        body: "hello",
        members: MEMBERS,
        sessions: [],
        currentUserId: ME,
        unaddressedResponder: "last_addressed",
      })
    ).toMatchObject({ via: "none", reason: null });
  });

  it("threadOtherPartyOf answers null for a thread the author is not in", () => {
    const thread = { createdBy: "u-third", targetUserId: PEER };
    expect(threadOtherPartyOf(thread, MEMBERS, ME)).toBeNull();
  });
});

/**
 * 🔒 **THE SETTINGS CONTROL AND THE COMPOSER'S LINE ANSWER THE SAME QUESTION** (2026-09-07,
 * items 10 and 11).
 *
 * ⚠ **WHAT THIS SUITE USED TO PROVE WAS A HANDLE ROUND TRIP** — pick an agent in the
 * manage-gated panel, and the handle it stores is the one an untagged draft reports. There is
 * no handle any more: the setting is a two-valued RULE, because agents are ephemeral and a
 * pinned handle decays into naming nothing.
 *
 * ⚠ **SO THE PAIRING TO PIN IS THE ONE THAT REPLACED IT**: both surfaces read the viewer's own
 * roster row through `viewerUnaddressedResponder`, and a member who picks "No one" must see
 * the line stop naming anybody. If the control and the line ever read different sources, a
 * person would be shown a setting the server does not honour and have no way to tell.
 */
describe("🔒 the settings control and the composer read one source", () => {
  it("choosing No one is what the line then reports", () => {
    const chosen = vi.fn();
    render(
      <ChannelAgentsSettings
        members={MEMBERS}
        currentUserId={ME}
        onSetUnaddressedResponder={chosen}
      />
    );
    fireEvent.click(
      screen.getByLabelText("Who answers my unaddressed messages in this channel")
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /No one/ }));
    expect(chosen).toHaveBeenCalledWith("none");

    // The roster as it stands AFTER that write settles — which is exactly what the optimistic
    // patch paints (`optimistic-cache.ts › setUnaddressedResponder`).
    render(
      <ComposerRecipients
        body="anyone there"
        members={[
          { ...MEMBERS[0], unaddressedResponder: chosen.mock.calls[0][0] },
          MEMBERS[1],
        ]}
        sessions={[PEER_AGENT, BARE_AGENT]}
        currentUserId={ME}
      />
    );
    expect(screen.getByLabelText("Recipients").textContent).toContain(REACH_NOBODY);
  });

  it("the default renders as Last Agent Addressed, and the line still names an agent", () => {
    render(
      <ChannelAgentsSettings
        members={MEMBERS}
        currentUserId={ME}
        onSetUnaddressedResponder={vi.fn()}
      />
    );
    expect(
      screen.getByLabelText("Who answers my unaddressed messages in this channel").textContent
    ).toContain("Last Agent Addressed");
  });
});
