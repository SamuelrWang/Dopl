/**
 * THE MATCH RULE, pinned. `lib/mentions.ts` is ONE parser shared by the
 * server's resolution at insert and the transcript's highlight, so every case
 * here is simultaneously a claim about whose inbox a message lands in and about
 * where a tint is drawn.
 */

import { describe, expect, it } from "vitest";
import {
  MENTIONS_METADATA_KEY,
  buildMentionIndex,
  mentionHandleOf,
  mentionTokensOf,
  mentionedUserIdsOf,
  resolveMentionToken,
  resolveMentions,
  type MentionCandidate,
} from "./mentions";

const DIANA: MentionCandidate = {
  userId: "u-diana",
  displayName: "Diana Taylor",
  email: "diana@example.com",
};
const DANIEL: MentionCandidate = {
  userId: "u-daniel",
  displayName: "Daniel Anderson",
  email: "dan@example.com",
};
const ROSTER = [DIANA, DANIEL];

describe("tokenizing", () => {
  it("finds every @-run and nothing else", () => {
    expect(mentionTokensOf("hey @diana and @dan — see @diana again")).toEqual([
      "@diana",
      "@dan",
      "@diana",
    ]);
  });

  it("is free of a body with no @ at all — the server's cheap exit", () => {
    expect(mentionTokensOf("no tags in this one")).toEqual([]);
  });

  it("does not treat an email in prose as two tags", () => {
    // `[^\s@]+` stops at the second `@`, so `diana@example.com` yields the one
    // token `@example.com`, which resolves to nobody.
    expect(mentionTokensOf("write to diana@example.com")).toEqual([
      "@example.com",
    ]);
    expect(resolveMentions("write to diana@example.com", ROSTER)).toEqual([]);
  });

  it("strips TRAILING punctuation and never leading", () => {
    expect(mentionHandleOf("@diana,")).toBe("diana");
    expect(mentionHandleOf("@Diana!?")).toBe("diana");
    expect(mentionHandleOf("@(diana")).toBe("(diana");
    expect(mentionHandleOf("@")).toBeNull();
    expect(mentionHandleOf("diana")).toBeNull();
  });
});

describe("the handle set", () => {
  it("answers to the first name, the squashed full name and the email local part", () => {
    const index = buildMentionIndex([DIANA]);
    for (const token of ["@diana", "@Diana", "@dianataylor", "@DianaTaylor"]) {
      expect(resolveMentionToken(token, index)).toBe("u-diana");
    }
  });

  it("does NOT match on a prefix or a substring", () => {
    // The composer's autocomplete is substring-matched because a human then
    // PICKS one. A resolver that guessed would tag `@dan` at Daniel Anderson
    // AND at anybody called Danielle.
    const index = buildMentionIndex(ROSTER);
    expect(resolveMentionToken("@dia", index)).toBeNull();
    expect(resolveMentionToken("@danielanders", index)).toBeNull();
  });

  it("a token that is only a display-name FRAGMENT resolves to nobody", () => {
    // `@Diana Taylor` is the token `@Diana` plus prose. The first-name handle
    // is what makes it work at all; "Taylor" alone is not a handle.
    expect(resolveMentions("hi @Diana Taylor", ROSTER)).toEqual(["u-diana"]);
    expect(resolveMentions("hi @Taylor", ROSTER)).toEqual([]);
  });
});

describe("ambiguity fails closed", () => {
  it("a handle two members claim resolves to NOBODY, not to the first row", () => {
    const twin: MentionCandidate = {
      userId: "u-other",
      displayName: "Diana Okafor",
      email: "diana.o@example.com",
    };
    // Both answer to "diana" — the roster's ORDER must not decide whose inbox
    // this lands in.
    expect(resolveMentions("@diana ping", [DIANA, twin])).toEqual([]);
    expect(resolveMentions("@diana ping", [twin, DIANA])).toEqual([]);
    // …and each is still reachable by an unambiguous handle.
    expect(resolveMentions("@dianataylor ping", [DIANA, twin])).toEqual([
      "u-diana",
    ]);
  });

  it("one member claiming a handle twice is not ambiguous", () => {
    const same: MentionCandidate = {
      userId: "u-x",
      displayName: "sam",
      email: "sam@example.com",
    };
    expect(resolveMentions("@sam", [same])).toEqual(["u-x"]);
  });
});

describe("whole-body resolution", () => {
  it("de-dupes and keeps first-appearance order", () => {
    expect(resolveMentions("@dan then @diana then @dan", ROSTER)).toEqual([
      "u-daniel",
      "u-diana",
    ]);
  });

  it("a member with neither a display name nor an email claims no handle", () => {
    const nameless: MentionCandidate = {
      userId: "u-nameless",
      displayName: null,
      email: null,
    };
    expect(buildMentionIndex([nameless]).size).toBe(0);
    expect(resolveMentions("@somebody", [nameless])).toEqual([]);
  });
});

describe("reading the stamp back", () => {
  it("absent, malformed and foreign values all read as NO mention", () => {
    expect(mentionedUserIdsOf(undefined)).toEqual([]);
    expect(mentionedUserIdsOf({})).toEqual([]);
    expect(mentionedUserIdsOf({ [MENTIONS_METADATA_KEY]: "u-diana" })).toEqual([]);
    expect(mentionedUserIdsOf({ [MENTIONS_METADATA_KEY]: 7 })).toEqual([]);
  });

  it("keeps only the string entries of an array", () => {
    expect(
      mentionedUserIdsOf({ [MENTIONS_METADATA_KEY]: ["u-diana", 3, null] })
    ).toEqual(["u-diana"]);
  });
});
