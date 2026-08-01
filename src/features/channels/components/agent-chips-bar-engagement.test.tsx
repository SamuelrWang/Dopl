/**
 * CAN A USER TELL WHO WILL ACT ON THEIR NEXT UNTAGGED MESSAGE? That is the only
 * question the chips bar exists to answer, and every case in this file is a way
 * the chip used to answer it wrongly: an expired stamp still reading
 * "listening", an owner whose desktop is gone, a parked process shown beside
 * the words "you can talk without tagging".
 *
 * Split out of `agent-chips-bar.test.tsx` (§2): that file covers who is in the
 * room and who may act on them, this one covers which of them is listening.
 * Rendered statically, like every other channels component test.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChipMenu, AgentChipsBar, EngagementTag } from "./agent-chips-bar";
import { ENGAGEMENT_TTL_MS } from "../constants";
import { deriveAgentEngagement } from "../lib/agent-engagement";
import type { AgentEngagement } from "../lib/agent-engagement";
import type { ChannelAgent, ChannelMember } from "../types";

const ME = "u-me";
const ADA = "u-ada";
const NAMES = new Map([
  [ME, "Me"],
  [ADA, "Ada"],
]);

function member(over: Partial<ChannelMember> & { userId: string }): ChannelMember {
  return {
    channelId: "c1",
    role: "member",
    lastReadAt: null,
    notifyScope: null,
    agentToolProfile: null,
    agentOnline: false,
    lastSeenAt: null,
    addedBy: null,
    joinedAt: "2026-07-01T00:00:00.000Z",
    displayName: null,
    email: null,
    avatarUrl: null,
    ...over,
  };
}

/**
 * The default roster has both desktops CONNECTED, because that is the condition
 * under which an engaged agent actually acts and therefore the baseline every
 * other case is a deviation from. The offline roster below is the deviation.
 */
const MEMBERS = [
  member({ userId: ME, displayName: "Me", agentOnline: true }),
  member({ userId: ADA, displayName: "Ada", agentOnline: true }),
];

/** Same people, nobody's desktop heartbeating. */
const OFFLINE_MEMBERS = MEMBERS.map((m) => ({ ...m, agentOnline: false }));

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return {
    id: "a1",
    channelId: "c1",
    workspaceId: "w1",
    ownerUserId: ME,
    name: "quartz",
    status: "active",
    engagedAt: null,
    engagedBy: null,
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

const noopAsync = async () => {};

function render(agents: ChannelAgent[], members: ChannelMember[] = MEMBERS) {
  return renderToStaticMarkup(
    <AgentChipsBar
      agents={agents}
      members={members}
      memberNames={NAMES}
      currentUserId={ME}
      onRename={noopAsync}
      onSetStatus={noopAsync}
    />
  );
}

/** The popover body renders only once opened, so it is driven directly here. */
function menu(over: {
  owned: boolean;
  agent?: ChannelAgent;
  /** The bar resolves this (clock + owner presence); default = derive by time. */
  engagement?: AgentEngagement;
  canDisengage?: boolean;
  engagedByLabel?: string | null;
  onDisengage?: (agentId: string) => Promise<unknown>;
}) {
  const row = over.agent ?? agent();
  return renderToStaticMarkup(
    <AgentChipMenu
      agent={row}
      owned={over.owned}
      engagement={over.engagement ?? deriveAgentEngagement(row)}
      canDisengage={over.canDisengage}
      ownerLabel={over.owned ? "Your agent" : "Ada's agent"}
      engagedByLabel={over.engagedByLabel ?? null}
      onRename={noopAsync}
      onSetStatus={noopAsync}
      onDisengage={over.onDisengage ?? noopAsync}
      onDone={() => {}}
    />
  );
}

/**
 * ENGAGEMENT is the fact an operator acts on, and the ONE question the bar
 * exists to answer is "who will act on my next untagged message". It must be
 * readable off the chip WITHOUT color, which is why the word is real text
 * rather than a fill alone.
 *
 * `MINUTE_AGO_ISO` is a minute, and is named as such: this is a TTL test file,
 * and a fixture called HOUR_AGO in a file whose window is exactly an hour was
 * one careless rename away from asserting the opposite of what it read.
 */
const MINUTE_AGO_ISO = () => new Date(Date.now() - 60_000).toISOString();
const STALE_ISO = () =>
  new Date(Date.now() - ENGAGEMENT_TTL_MS - 60_000).toISOString();

describe("AgentChipsBar engagement", () => {
  it("lights an ENGAGED chip and says the word", () => {
    const markup = render([agent({ engagedAt: MINUTE_AGO_ISO(), engagedBy: ME })]);
    expect(markup).toContain("Engaged");
    expect(markup).not.toContain(">Idle<");
    expect(markup).toContain("bg-bg-elevated");
  });

  it("hollows an IDLE chip (never engaged) and says the word", () => {
    const markup = render([agent()]);
    expect(markup).toContain("Idle");
    expect(markup).not.toContain(">Engaged<");
    expect(markup).toContain("border-dashed");
  });

  it("reads a stamp older than the TTL as idle", () => {
    const markup = render([agent({ engagedAt: STALE_ISO(), engagedBy: ME })]);
    expect(markup).toContain("Idle");
    expect(markup).toContain("border-dashed");
  });

  it("tells the reader what each state MEANS, in the chip's title", () => {
    expect(render([agent({ engagedAt: MINUTE_AGO_ISO() })])).toContain(
      "you can talk without tagging"
    );
    expect(render([agent()])).toContain("Tag @quartz to bring it in.");
  });

  it("never uses a hardcoded color for any treatment", () => {
    const markup = render([
      agent({ id: "a1", engagedAt: MINUTE_AGO_ISO() }),
      agent({ id: "a2", name: "vega" }),
      agent({ id: "a3", name: "flint", status: "parked", engagedAt: MINUTE_AGO_ISO() }),
    ]);
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

/**
 * A PARKED AGENT IS NOT LISTENING. Its process is suspended; the stamp on the
 * row does not change that. This file used to PIN the contradiction — a chip
 * that said "Parked" and "Engaged · listening; you can talk without tagging" at
 * the same time — on the reasoning that the two are different facts. They are,
 * and both are still shown; what was wrong was letting one of them state an
 * outcome the other made impossible.
 */
describe("AgentChipsBar — parked and engaged do not contradict", () => {
  const parked = () =>
    agent({ status: "parked", engagedAt: MINUTE_AGO_ISO(), engagedBy: ME });

  it("keeps BOTH facts on the chip", () => {
    const markup = render([parked()]);
    expect(markup).toContain("Parked");
    // The engagement survives the park and the chip still says so.
    expect(markup).toContain("Engaged, parked");
  });

  it("does NOT tell the reader they can talk without tagging", () => {
    expect(render([parked()])).not.toContain("without tagging");
  });

  it("says what it is waiting on instead", () => {
    expect(render([parked()])).toContain(
      "Nothing runs here until its owner resumes it."
    );
  });

  it("gives it neither the lit fill nor the idle dash", () => {
    const markup = render([parked()]);
    expect(markup).toContain("bg-bg-inset");
    expect(markup).not.toContain("border-dashed");
  });

  it("goes fully IDLE once the stamp expires under the park", () => {
    const markup = render([
      agent({ status: "parked", engagedAt: STALE_ISO(), engagedBy: ME }),
    ]);
    expect(markup).toContain("border-dashed");
    expect(markup).toContain("Tag @quartz to bring it in.");
  });
});

/**
 * AN AGENT RUNS ON ITS OWNER'S MACHINE. When their desktop is gone, a fresh
 * stamp buys nothing: no session picks the message up. The distinction from
 * Idle is worth a third state rather than a silent downgrade — the engagement
 * IS intact and it resumes on reconnect, so telling the user to re-tag would be
 * the wrong instruction.
 */
describe("AgentChipsBar — the owner's desktop is offline", () => {
  const engagedRow = () => agent({ engagedAt: MINUTE_AGO_ISO(), engagedBy: ME });

  it("does NOT present as listening", () => {
    const markup = render([engagedRow()], OFFLINE_MEMBERS);
    expect(markup).not.toContain("without tagging");
  });

  it("still says the agent is engaged (this is not idle)", () => {
    const markup = render([engagedRow()], OFFLINE_MEMBERS);
    expect(markup).toContain("Engaged, owner offline");
    expect(markup).not.toContain(">Idle<");
    expect(markup).not.toContain("border-dashed");
  });

  it("says what to expect: it picks up when they reconnect", () => {
    expect(render([engagedRow()], OFFLINE_MEMBERS)).toContain(
      "Nothing runs here until they reconnect."
    );
  });

  it("presents as LISTENING again the moment their desktop is back", () => {
    expect(render([engagedRow()], MEMBERS)).toContain("you can talk without tagging");
  });

  it("does not invent an offline claim for an owner who is not on the roster", () => {
    // Roster still loading, or the owner left the channel. Unknown is unknown.
    const markup = render([agent({ ownerUserId: "u-ghost", engagedAt: MINUTE_AGO_ISO() })]);
    expect(markup).toContain("you can talk without tagging");
    expect(markup).not.toContain("owner offline");
  });

  it("leaves an IDLE agent idle whether or not the desktop is up", () => {
    expect(render([agent()], OFFLINE_MEMBERS)).toContain(
      "Tag @quartz to bring it in."
    );
  });
});

/**
 * The tag is the non-color carrier of the state, so it gets asserted on its own
 * markup, one state at a time: three treatments must survive as three words.
 */
describe("EngagementTag", () => {
  const tag = (engagement: AgentEngagement) =>
    renderToStaticMarkup(<EngagementTag engagement={engagement} />);

  it("says one distinct word per state", () => {
    expect(tag("engaged")).toContain(">Engaged<");
    expect(tag("engaged-offline")).toContain(">Offline<");
    expect(tag("engaged-parked")).toContain(">Parked<");
    expect(tag("idle")).toContain(">Idle<");
  });

  it("inks live / held / faint without a hardcoded color", () => {
    expect(tag("engaged")).toContain("text-success");
    expect(tag("engaged-offline")).toContain("text-warning");
    expect(tag("idle")).toContain("text-text-muted");
    expect(tag("engaged")).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("AgentChipMenu — Disengage is owner-only", () => {
  const engaged = () => agent({ engagedAt: MINUTE_AGO_ISO(), engagedBy: ME });

  it("offers the OWNER Disengage on an engaged agent", () => {
    const markup = menu({ owned: true, agent: engaged(), canDisengage: true });
    expect(markup).toContain("Disengage");
  });

  it("REFUSES it to a non-owner, even when the agent is engaged", () => {
    // The gate is doubled on purpose: `canDisengage` carries the lib's rule,
    // and `owned` is re-checked here, so a caller that forgets one cannot open
    // a write affordance on somebody else's agent.
    expect(
      menu({ owned: false, agent: engaged(), canDisengage: true })
    ).not.toContain("Disengage");
  });

  it("hides it on an IDLE agent (there is nothing to disengage from)", () => {
    expect(menu({ owned: true, canDisengage: false })).not.toContain("Disengage");
  });

  it("hides it when the surface wires no disengage path", () => {
    const markup = renderToStaticMarkup(
      <AgentChipMenu
        agent={engaged()}
        owned
        engagement="engaged"
        canDisengage
        ownerLabel="Your agent"
        onRename={noopAsync}
        onSetStatus={noopAsync}
        onDone={() => {}}
      />
    );
    expect(markup).not.toContain("Disengage");
  });

  it("keeps rename / park / dismiss beside it", () => {
    const markup = menu({ owned: true, agent: engaged(), canDisengage: true });
    expect(markup).toContain("Rename");
    expect(markup).toContain("Park");
    expect(markup).toContain("Dismiss");
  });

  it("states what engagement means to a NON-owner too (read-only legibility)", () => {
    const markup = menu({ owned: false, agent: engaged() });
    expect(markup).toContain("you can talk without tagging");
    expect(markup).not.toContain("Disengage");
  });
});

/**
 * The popover states what the BAR resolved. It has neither the clock nor the
 * roster, so anything it re-derived from the agent row alone would drift back
 * into exactly the two lies the bar just fixed.
 */
describe("AgentChipMenu — the state is given, not re-derived", () => {
  const engaged = () => agent({ engagedAt: MINUTE_AGO_ISO(), engagedBy: ME });

  it("presents the held state over a row whose stamp is perfectly fresh", () => {
    const markup = menu({
      owned: true,
      agent: engaged(),
      engagement: "engaged-offline",
    });
    expect(markup).toContain("Nothing runs here until they reconnect.");
    expect(markup).not.toContain("without tagging");
  });

  it("names who engaged it when the bar resolved a name", () => {
    expect(
      menu({ owned: true, agent: engaged(), engagedByLabel: "Ada engaged it." })
    ).toContain("Ada engaged it.");
  });

  it("says nothing about who engaged it when there is nothing to say", () => {
    expect(menu({ owned: true, agent: engaged() })).not.toContain("engaged it.");
  });

  it("explains the missing button to the peer who engaged it", () => {
    const markup = menu({
      owned: false,
      agent: engaged(),
      canDisengage: false,
      engagedByLabel: "You engaged it. Only its owner can disengage it here.",
    });
    expect(markup).toContain("Only its owner can disengage it here.");
    expect(markup).not.toContain(">Disengage<");
  });
});
