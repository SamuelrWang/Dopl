import { describe, expect, it } from "vitest";
import {
  applyMention,
  buildMentionCandidates,
  findMentionQuery,
  MENTION_LIMIT,
  mentionPopupHeight,
} from "./mention";
import type { ChannelAgent, ChannelMember } from "../types";

const ME = "u-me";
const ADA = "u-ada";
const BEN = "u-ben";

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

function agent(over: Partial<ChannelAgent> = {}): ChannelAgent {
  return {
    id: "a1",
    channelId: "c1",
    workspaceId: "w1",
    ownerUserId: ADA,
    name: "quartz",
    status: "active",
    createdAt: "2026-07-31T00:00:00.000Z",
    updatedAt: "2026-07-31T00:00:00.000Z",
    ...over,
  };
}

const members = [
  member({ userId: ME, displayName: "Me" }),
  member({ userId: ADA, displayName: "Ada", agentOnline: true }),
  member({ userId: BEN, displayName: "Ben" }),
];

describe("findMentionQuery — when the popup is open", () => {
  it("opens on a bare @ at the start of the draft", () => {
    expect(findMentionQuery("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("captures what has been typed after the @, lowercased", () => {
    expect(findMentionQuery("hey @QUA", 8)).toEqual({
      start: 4,
      end: 8,
      query: "qua",
    });
  });

  it("closes once the token ends in whitespace (the mention is finished)", () => {
    expect(findMentionQuery("hey @quartz ", 12)).toBeNull();
  });

  it("never opens inside an email address", () => {
    expect(findMentionQuery("ada@example.com", 15)).toBeNull();
  });

  it("is null when there is no @ before the caret", () => {
    expect(findMentionQuery("hello", 5)).toBeNull();
  });

  it("tracks the caret, not the end of the draft", () => {
    // Caret sits right after "@qu" while more text follows.
    expect(findMentionQuery("@qu rest", 3)).toEqual({
      start: 0,
      end: 3,
      query: "qu",
    });
  });
});

describe("buildMentionCandidates — both populations, one list", () => {
  const agents = [
    agent({ id: "a1", name: "quartz", ownerUserId: ADA }),
    agent({ id: "a2", name: "vega", ownerUserId: ME, status: "summoned" }),
    agent({ id: "a3", name: "onyx", ownerUserId: BEN, status: "parked" }),
    agent({ id: "a4", name: "flint", ownerUserId: BEN, status: "dismissed" }),
  ];

  const build = (query: string) =>
    buildMentionCandidates({ query, members, agents, currentUserId: ME });

  it("lists agents AND humans on an empty query", () => {
    const keys = build("").map((c) => c.key);
    expect(keys).toContain("agent:a1");
    expect(keys).toContain(`user:${ADA}`);
  });

  it("puts agents before humans (a mention is how an agent is made to act)", () => {
    const kinds = build("").map((c) => c.kind);
    expect(kinds.indexOf("agent")).toBeLessThan(kinds.indexOf("member"));
  });

  it("filters BOTH populations as you type", () => {
    const rows = build("a");
    // "quartz" (agent) and "Ada" (human) both contain an "a"; "vega" too.
    expect(rows.map((c) => c.label)).toContain("quartz");
    expect(rows.map((c) => c.label)).toContain("Ada");
    // "Ben" does not.
    expect(rows.map((c) => c.label)).not.toContain("Ben");
  });

  it("ranks a prefix match above a mid-string one", () => {
    const rows = build("ve").filter((c) => c.kind === "agent");
    expect(rows[0]?.label).toBe("vega");
  });

  it("offers only ADDRESSABLE agents (parked and dismissed cannot be summoned)", () => {
    const labels = build("").map((c) => c.label);
    expect(labels).toContain("quartz");
    expect(labels).toContain("vega");
    expect(labels).not.toContain("onyx");
    expect(labels).not.toContain("flint");
  });

  it("never offers the viewer themselves", () => {
    expect(build("").some((c) => c.key === `user:${ME}`)).toBe(false);
  });

  it("carries the AGENT's owner as the avatar identity, not the agent", () => {
    const quartz = build("quartz")[0];
    expect(quartz.person.userId).toBe(ADA);
    expect(quartz.status).toBe("active");
  });

  it("shows a listening human as listening, a quiet one with no detail", () => {
    const rows = build("");
    expect(rows.find((c) => c.key === `user:${ADA}`)?.detail).toBe("listening");
    expect(rows.find((c) => c.key === `user:${BEN}`)?.detail).toBeNull();
  });

  it("caps the list", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      agent({ id: `a${i}`, name: `agent-${i}` })
    );
    expect(
      buildMentionCandidates({
        query: "",
        members,
        agents: many,
        currentUserId: ME,
      })
    ).toHaveLength(MENTION_LIMIT);
  });
});

describe("applyMention — what lands in the draft", () => {
  it("inserts the handle with a trailing space and returns the caret", () => {
    const mention = findMentionQuery("hey @qu", 7)!;
    expect(applyMention("hey @qu", mention, "quartz")).toEqual({
      value: "hey @quartz ",
      caret: 12,
    });
  });

  it("keeps whatever followed the token", () => {
    const mention = findMentionQuery("@qu can you look", 3)!;
    expect(applyMention("@qu can you look", mention, "quartz").value).toBe(
      "@quartz  can you look"
    );
  });

  it("inserts a human's display name in the same @ form", () => {
    const mention = findMentionQuery("@Ad", 3)!;
    expect(applyMention("@Ad", mention, "Ada").value).toBe("@Ada ");
  });
});

describe("mentionPopupHeight — the list opens upward, so it must be sized first", () => {
  it("grows with the row count", () => {
    expect(mentionPopupHeight(1)).toBeLessThan(mentionPopupHeight(4));
  });

  it("stops growing at the row cap (the list scrolls past it)", () => {
    expect(mentionPopupHeight(MENTION_LIMIT + 10)).toBe(
      mentionPopupHeight(MENTION_LIMIT)
    );
  });

  it("never returns zero, so the popup can't be anchored on top of the input", () => {
    expect(mentionPopupHeight(0)).toBeGreaterThan(0);
  });
});
