import { describe, expect, it } from "vitest";
import {
  applyMention,
  buildMentionCandidates,
  extractMentionedAgentIds,
  extractMentionedAgents,
  findMentionQuery,
  MENTION_LIMIT,
  mentionPopupHeight,
} from "./mention";
import { MAX_ADDRESSED_AGENTS } from "../schema";
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
    engagedAt: null,
    engagedBy: null,
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

/**
 * THE BUG THIS SUITE EXISTS FOR: "@quartz @onyx work together on X" typed into
 * the composer used to address NOBODY. The handles were inserted as plain text
 * and nothing ever turned them into an address, so neither agent acted and
 * nothing on screen said why. Resolution runs on the COMPOSED BODY, so a handle
 * counts however it got there and stops counting the moment it is deleted.
 */
describe("extractMentionedAgents — @handles become an address", () => {
  const roster = [
    agent({ id: "a1", name: "quartz" }),
    agent({ id: "a2", name: "onyx" }),
    agent({ id: "a3", name: "code-review" }),
    agent({ id: "a4", name: "parked-one", status: "parked" }),
    agent({ id: "a5", name: "gone", status: "dismissed" }),
  ];
  const ids = (body: string) => extractMentionedAgentIds(body, roster);

  it("resolves ONE mention", () => {
    expect(ids("@quartz can you take this")).toEqual(["a1"]);
  });

  it("resolves the operator's core flow, in the order they were named", () => {
    expect(ids("@quartz @onyx work together on X")).toEqual(["a1", "a2"]);
  });

  it("keeps FIRST-appearance order, not roster order", () => {
    expect(ids("@onyx and @quartz")).toEqual(["a2", "a1"]);
  });

  it("dedupes a repeated handle into one address", () => {
    expect(ids("@quartz start, then @quartz finish")).toEqual(["a1"]);
  });

  it("is case-insensitive (the server folds handles the same way)", () => {
    expect(ids("@QUARTZ and @Onyx")).toEqual(["a1", "a2"]);
  });

  it("ignores an unknown handle rather than guessing a near match", () => {
    // A typo has to visibly fail to resolve — that is the composer's only
    // warning that the agent you meant is not going to act.
    expect(ids("@quarzt please look")).toEqual([]);
    expect(ids("@quarzt but also @quartz")).toEqual(["a1"]);
  });

  it("drops punctuation that trails the handle", () => {
    expect(ids("@quartz, @onyx: and @quartz's turn")).toEqual(["a1", "a2"]);
    expect(ids("ping @onyx.")).toEqual(["a2"]);
    expect(ids("ready @onyx?")).toEqual(["a2"]);
  });

  it("keeps a hyphen INSIDE a handle but not a trailing one", () => {
    expect(ids("@code-review please")).toEqual(["a3"]);
    expect(ids("@code-review- please")).toEqual(["a3"]);
  });

  it("never treats an email address as a mention", () => {
    expect(ids("mail ada@quartz.example.com about it")).toEqual([]);
  });

  it("ignores a handle inside a code span", () => {
    expect(ids("run `@quartz --help` first")).toEqual([]);
    expect(ids("run `@quartz` then ping @onyx")).toEqual(["a2"]);
  });

  it("ignores non-addressable agents (parked, dismissed)", () => {
    expect(ids("@parked-one @gone @quartz")).toEqual(["a1"]);
  });

  it("returns nothing for a body with no mentions", () => {
    expect(ids("morning all")).toEqual([]);
  });

  it("caps at the schema's address limit", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      agent({ id: `m${i}`, name: `bot-${i}` })
    );
    const body = many.map((a) => `@${a.name}`).join(" ");
    const resolved = extractMentionedAgentIds(body, many);
    expect(resolved).toHaveLength(MAX_ADDRESSED_AGENTS);
    expect(resolved[0]).toBe("m0");
  });

  it("returns the resolved agents themselves, for the helper line's handles", () => {
    expect(
      extractMentionedAgents("@Onyx @quartz", roster).map((a) => a.name)
    ).toEqual(["onyx", "quartz"]);
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
