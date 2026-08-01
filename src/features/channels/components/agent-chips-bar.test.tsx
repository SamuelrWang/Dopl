/**
 * The chips bar is where a channel states that agents are members of the room,
 * and where their owner (and ONLY their owner) can act on them. Rendered
 * statically, like every other channels component test.
 *
 * WHICH of them is listening is the other half, and it is big enough to be its
 * own file (§2): `agent-chips-bar-engagement.test.tsx`.
 */

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChipMenu, AgentChipsBar } from "./agent-chips-bar";
import { deriveAgentEngagement } from "../lib/agent-engagement";
import type { AgentEngagement } from "../lib/agent-engagement";
import type { AgentStatus, ChannelAgent, ChannelMember } from "../types";

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
 * Both desktops CONNECTED, which is the condition under which an engaged agent
 * actually acts. The offline roster (and what the chip does with it) lives in
 * the engagement file.
 */
const MEMBERS = [
  member({ userId: ME, displayName: "Me", agentOnline: true }),
  member({ userId: ADA, displayName: "Ada", agentOnline: true }),
];

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

describe("AgentChipsBar rendering", () => {
  it("renders one chip per agent, by handle", () => {
    const markup = render([
      agent({ id: "a1", name: "quartz" }),
      agent({ id: "a2", name: "vega", ownerUserId: ADA }),
    ]);
    expect(markup).toContain("quartz");
    expect(markup).toContain("vega");
    expect(markup).toContain('aria-label="Channel agents"');
  });

  it("renders nothing at all in a channel with no agents", () => {
    expect(render([])).toBe("");
  });

  it("drops a DISMISSED agent's chip (the row survives for attribution)", () => {
    const markup = render([
      agent({ id: "a1", name: "quartz" }),
      agent({ id: "a2", name: "flint", status: "dismissed" }),
    ]);
    expect(markup).toContain("quartz");
    expect(markup).not.toContain("flint");
  });

  it("renders nothing when every agent is dismissed", () => {
    expect(render([agent({ status: "dismissed" })])).toBe("");
  });

  it("carries the owner's avatar miniature (whose machine it runs on)", () => {
    // Initials fallback for a roster member with no picture.
    expect(render([agent({ ownerUserId: ADA, name: "vega" })])).toContain("A");
  });
});

describe("AgentChipsBar status dots", () => {
  const dotClasses = (markup: string) =>
    [...markup.matchAll(/class="([^"]*rounded-full[^"]*)"/g)].map((m) => m[1]);

  function classesFor(status: AgentStatus) {
    return dotClasses(render([agent({ status })])).join(" ");
  }

  it("pulses a summoned agent", () => {
    expect(classesFor("summoned")).toContain("animate-pulse");
  });

  it("inks an active agent solid, with no pulse", () => {
    const classes = classesFor("active");
    expect(classes).toContain("bg-success");
    expect(classes).not.toContain("animate-pulse");
  });

  it("hollows a parked agent", () => {
    const classes = classesFor("parked");
    expect(classes).toContain("bg-transparent");
    expect(classes).not.toContain("bg-success");
  });

  it("states the status in the chip title, for a reader who can't see color", () => {
    expect(render([agent({ status: "parked" })])).toContain("Parked");
  });
});

describe("AgentChipsBar ownership", () => {
  it("says an agent is YOURS in its own words", () => {
    expect(render([agent({ ownerUserId: ME })])).toContain("Your agent");
  });

  it("names the owner of someone else's agent", () => {
    expect(render([agent({ ownerUserId: ADA, name: "vega" })])).toContain(
      "Ada&#x27;s agent"
    );
  });

  it("never uses a hardcoded color or px size (design tokens only)", () => {
    const markup = render([agent(), agent({ id: "a2", status: "summoned" })]);
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(markup).not.toMatch(/style="/);
  });
});

/**
 * The popover body renders only once opened, so the owner gate is driven
 * directly here — the same split the invite dialog uses for its routing note.
 */
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

describe("AgentChipMenu — owner-only affordances", () => {
  it("gives the OWNER rename, park and dismiss", () => {
    const markup = menu({ owned: true });
    expect(markup).toContain('aria-label="Agent handle"');
    expect(markup).toContain("Rename");
    expect(markup).toContain("Park");
    expect(markup).toContain("Dismiss");
  });

  it("gives a NON-owner none of them — only coarse status", () => {
    const markup = menu({ owned: false });
    expect(markup).not.toContain('aria-label="Agent handle"');
    expect(markup).not.toContain("Rename");
    expect(markup).not.toContain("Park");
    expect(markup).not.toContain("Dismiss");
    // What a peer DOES see: whose it is and what it is doing. Nothing else —
    // peer visibility is coarse status, never session internals.
    expect(markup).toContain("Ada&#x27;s agent");
    expect(markup).toContain("Working");
  });

  it("offers Resume (not Park) on a parked agent", () => {
    const markup = menu({ owned: true, agent: agent({ status: "parked" }) });
    expect(markup).toContain("Resume");
    expect(markup).not.toContain(">Park<");
  });

  it("offers nothing editable on a dismissed agent (it is retired)", () => {
    const markup = menu({ owned: true, agent: agent({ status: "dismissed" }) });
    expect(markup).not.toContain(">Dismiss<");
    expect(markup).not.toContain(">Resume<");
    expect(markup).not.toContain(">Rename<");
    expect(markup).not.toContain('aria-label="Agent handle"');
    // It still says what it is.
    expect(markup).toContain("Dismissed");
  });

  it("starts the rename field on the current handle, disabled until it changes", () => {
    const markup = menu({ owned: true });
    expect(markup).toContain('value="quartz"');
    // Nothing typed yet -> the write button cannot fire.
    const renameAt = markup.indexOf(">Rename<");
    const openedAt = markup.lastIndexOf("<button", renameAt);
    expect(markup.slice(openedAt, renameAt)).toContain('disabled=""');
  });

  it("shows no validation error on the untouched handle", () => {
    expect(menu({ owned: true })).not.toContain("Lowercase letters");
  });
});

