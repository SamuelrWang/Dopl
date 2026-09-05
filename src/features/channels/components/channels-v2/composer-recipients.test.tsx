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
  type LiveAgentSession,
} from "../../lib/draft-recipients";
import { buildAgentMentionIndex, resolveAgentHandle } from "../../lib/agent-mentions";
import { channel as channelFixture, member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

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

  it("🔒 falls to the DEFAULT RESPONDER when nothing is tagged, and says so", () => {
    const body = mount({
      liveAgents: [PEER_AGENT, BARE_AGENT],
      defaultResponderAgentName: "research-bot",
    });
    type(body, "who is around");
    expect(line()).toContain("@research-bot");
    expect(line()).toContain("default");
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

  it("🔒 and it names the agent that POSTED here last, over the ordering", () => {
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
  const reach = (body: string, over = {}) =>
    draftReach({
      body,
      members: MEMBERS,
      sessions: [PEER_AGENT],
      currentUserId: ME,
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

  it("an explicit tag OUTRANKS the default responder", () => {
    const out = reach("@diana-taylor over to you", {
      defaultResponderAgentName: "research-bot",
    });
    expect(out.via).toBe("tagged");
    expect(out.recipients.map((r) => r.label)).toEqual(["Diana Taylor"]);
  });

  it("a nomination whose agent is not running degrades to the room's own answer", () => {
    // ⚠ IT DEGRADES, IT DOES NOT DANGLE — and since 2026-09-04 the degraded
    // answer is a real one rather than `none`. The setting stores a HANDLE and
    // nothing enforces that it names a live session.
    const out = draftReach({
      body: "hello",
      members: MEMBERS,
      sessions: [PEER_AGENT, BARE_AGENT],
      currentUserId: ME,
      defaultResponderAgentName: "gone-agent",
      recentAgentIds: [BARE_AGENT.name],
    });
    expect(out.via).toBe("responder");
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
      })
    ).toMatchObject({ via: "none", reason: null });
  });

  it("threadOtherPartyOf answers null for a thread the author is not in", () => {
    const thread = { createdBy: "u-third", targetUserId: PEER };
    expect(threadOtherPartyOf(thread, MEMBERS, ME)).toBeNull();
  });
});

describe("🔒 the settings panel and the composer agree on one handle", () => {
  it("what Settings STORES is what the line NAMES", () => {
    // The round trip, across the two surfaces this slice touches: pick the
    // responder in the manage-gated panel, and the handle it sends is the one
    // an untagged draft reports.
    const stored = vi.fn();
    render(
      <ChannelAgentsSettings
        channel={{ ...channelFixture(), defaultResponderAgentName: null }}
        sessions={[{ userId: PEER, ...PEER_AGENT }] as never}
        onSetDefaultResponder={stored}
        onSetCeiling={(() => {}) as never}
      />
    );
    fireEvent.click(
      screen.getByLabelText("Agent that answers unaddressed messages in this channel")
    );
    fireEvent.click(screen.getByRole("menuitem", { name: /Research Bot/ }));
    expect(stored).toHaveBeenCalledWith("research-bot");

    render(
      <ComposerRecipients
        body="anyone there"
        members={MEMBERS}
        sessions={[PEER_AGENT, BARE_AGENT]}
        currentUserId={ME}
        defaultResponderAgentName={stored.mock.calls[0][0]}
      />
    );
    expect(screen.getByLabelText("Recipients").textContent).toContain("@research-bot");
  });
});
