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

describe("code does not tag (rule 6)", () => {
  // ⚠ THE DEFECT THIS PINS IS MEASURED, not hypothetical: two agents writing
  // DOCUMENTATION about @-tagging shipped backticked handles in their bodies and
  // tagged both operators for real (seqs 647 / 653, 2026-08-21). The transcript
  // already refused to tint those — `marked` lexes a code span into its own
  // token — so the server was the half that disagreed.

  it("a BACKTICK-WRAPPED handle tags nobody", () => {
    expect(mentionTokensOf("write `@diana` to tag her")).toEqual([]);
    expect(resolveMentions("write `@diana` to tag her", ROSTER)).toEqual([]);
  });

  it("a handle inside a FENCED block tags nobody", () => {
    const body = "example:\n\n```\npost(body=\"@diana ping\")\n```\n\ndone";
    expect(resolveMentions(body, ROSTER)).toEqual([]);
  });

  it("a tilde fence counts, and so does the fence's own info string", () => {
    expect(resolveMentions("~~~@diana\n@dan\n~~~", ROSTER)).toEqual([]);
  });

  it("an UNCLOSED fence runs to the end — fail closed, never fail open", () => {
    // A body that opens a fence and never closes it is code all the way down for
    // `marked` too. Tagging everything below an unterminated fence is the wrong
    // direction to be wrong in.
    expect(resolveMentions("```\n@diana\n@dan", ROSTER)).toEqual([]);
  });

  it("a PLAIN handle still tags — the rule removes code, not mentions", () => {
    expect(resolveMentions("@diana take a look", ROSTER)).toEqual(["u-diana"]);
  });

  it("a MIXED body tags only the plain one", () => {
    expect(
      resolveMentions("say `@dan` in the docs, and @diana should review", ROSTER)
    ).toEqual(["u-diana"]);
  });

  it("a fenced example does not stop a real tag in the prose around it", () => {
    const body = "@dan see below:\n\n```\n@diana\n```\n\nand @diana after";
    expect(resolveMentions(body, ROSTER)).toEqual(["u-daniel", "u-diana"]);
  });

  it("an UNMATCHED backtick masks nothing — a lone tick is prose", () => {
    // The failure mode of a greedy span rule: one stray backtick swallowing the
    // rest of the message and silently dropping every tag after it.
    expect(resolveMentions("costs 5` more — @diana thoughts?", ROSTER)).toEqual([
      "u-diana",
    ]);
  });

  it("a span may not cross a BLANK LINE, so two stray ticks stay literal", () => {
    // `marked` lexes inline tokens inside ONE block, so these are two literal
    // characters in two paragraphs — not a code span with @diana inside it.
    expect(resolveMentions("a `\n\n@diana\n\nb `", ROSTER)).toEqual(["u-diana"]);
  });

  it("a DOUBLE-backtick span containing a single tick is still code", () => {
    expect(resolveMentions("``@diana`s handle``", ROSTER)).toEqual([]);
  });

  it("masks by BLANKING, so removing a span cannot MINT a handle", () => {
    // ⚠ The reason the mask is length-preserving spaces rather than deletion:
    // deleting the span out of "@di`x`ana" leaves "@diana" and tags Diana off a
    // body that never named her. Blanking leaves "@di", which names nobody.
    expect(mentionTokensOf("@di`x`ana")).toEqual(["@di"]);
    expect(resolveMentions("@di`x`ana", ROSTER)).toEqual([]);
  });
});

describe("markup is not a handle (rule 7, F-266)", () => {
  // ⚠ THE DIRECTION OF EACH CASE IS THE TRANSCRIPT'S, measured by walking
  // `marked` the way `message-markdown.tsx` walks it — the table lives in
  // `mentions-tint-parity.test.ts`, which asserts both ends together. These
  // cases pin the RESOLVER half in isolation, so a failure says which end moved.

  describe("delimiters that WRAP a handle come off it, so the tag lands", () => {
    it("**bold** is the load-bearing case — it is how an agent escalates", () => {
      // ⚠ `**@sam** I am blocked` tinted and stamped NOBODY. The transcript told
      // the author it had reached a human; the Tags inbox was empty.
      expect(resolveMentions("**@diana** please review", ROSTER)).toEqual([
        "u-diana",
      ]);
    });

    it("every emphasis marker, single and doubled", () => {
      for (const body of [
        "*@diana* please",
        "__@diana__ please",
        "_@diana_ please",
        "~~@diana~~ please",
        "***@diana*** please",
      ]) {
        expect(resolveMentions(body, ROSTER), body).toEqual(["u-diana"]);
      }
    });

    it("emphasis PLUS punctuation, in either order — the strip runs to a fixed point", () => {
      expect(mentionHandleOf("@diana**,")).toBe("diana");
      expect(mentionHandleOf("@diana,**")).toBe("diana");
      expect(mentionHandleOf("@diana**")).toBe("diana");
    });

    it("a trailing HTML tag comes off, and `>` alone does not eat it first", () => {
      // ⚠ `>` is already in the punctuation class, so a single pass in the wrong
      // order leaves `@diana</b` — a shape nothing can recover.
      expect(mentionHandleOf("@diana</b>")).toBe("diana");
      expect(mentionHandleOf("@diana<br>")).toBe("diana");
      expect(resolveMentions("<b>@diana</b> please", ROSTER)).toEqual(["u-diana"]);
    });

    it("`_` INSIDE a handle is untouched — only a trailing run is stripped", () => {
      // ⚠ The check F-266 asked for before `_` joined the class: an underscore is
      // legal in an email local part, so clipping it mid-handle would break real
      // people rather than markdown.
      const withUnderscore: MentionCandidate = {
        userId: "u-u",
        displayName: null,
        email: "diana_taylor@example.com",
      };
      expect(resolveMentions("@diana_taylor ping", [withUnderscore])).toEqual([
        "u-u",
      ]);
      expect(resolveMentions("**@diana_taylor** ping", [withUnderscore])).toEqual([
        "u-u",
      ]);
    });

    it("LEADING punctuation is still never stripped (rule 2 is untouched)", () => {
      // The `@(diana` argument is about the FRONT of a token — guessing where a
      // handle starts is how `@…` inside a URL becomes a tag.
      expect(mentionHandleOf("@(diana")).toBe("(diana");
      expect(mentionHandleOf("@*diana")).toBe("*diana");
    });
  });

  describe("text markdown reads as STRUCTURE tags nobody", () => {
    it("an ESCAPED @ tags nobody — the author typed the backslash to prevent this", () => {
      expect(resolveMentions("literally \\@diana here", ROSTER)).toEqual([]);
      expect(mentionTokensOf("literally \\@diana here")).toEqual([]);
    });

    it("but an escaped BACKSLASH leaves the @ live — the run is COUNTED", () => {
      // ⚠ `\\@diana` is an escaped backslash followed by a real mention.
      // Blanking `\@` on sight would silently drop it.
      expect(resolveMentions("a backslash \\\\@diana here", ROSTER)).toEqual([
        "u-diana",
      ]);
      expect(resolveMentions("three \\\\\\@diana here", ROSTER)).toEqual([]);
    });

    it("a link or image DESTINATION tags nobody — a URL path is not a mention", () => {
      expect(resolveMentions("see [docs](https://ex.com/@diana)", ROSTER)).toEqual([]);
      expect(resolveMentions("![alt](https://ex.com/@diana)", ROSTER)).toEqual([]);
    });

    it("…and the SAME mask makes link TEXT resolve, which is the other half", () => {
      // ⚠ `[@diana](url)` TINTS. Its token was `@diana](url`; blanking the
      // destination leaves exactly `@diana`, so both halves of a markdown link
      // now agree with the render. One mask, two alignments.
      expect(resolveMentions("[@diana](https://ex.com) please", ROSTER)).toEqual([
        "u-diana",
      ]);
    });

    it("a link REFERENCE DEFINITION tags nobody — the renderer draws nothing at all", () => {
      expect(resolveMentions("[docs]: https://ex.com/@diana", ROSTER)).toEqual([]);
    });

    it("an AUTOLINK still tags, and that is deliberate", () => {
      // ⚠ `marked` makes the url its own link TEXT, so the transcript TINTS
      // these. Masking them would stamp nothing under a visible highlight —
      // manufacturing the divergence this rule exists to remove.
      expect(resolveMentions("see <https://ex.com/@diana>", ROSTER)).toEqual([
        "u-diana",
      ]);
      expect(resolveMentions("see https://ex.com/@diana now", ROSTER)).toEqual([
        "u-diana",
      ]);
    });

    it("prose that merely CONTAINS a bracket is not a destination", () => {
      // The mask keys on `](`, never on a bare bracket, so ordinary prose with
      // brackets keeps tagging.
      expect(resolveMentions("[note] @diana can you look", ROSTER)).toEqual([
        "u-diana",
      ]);
    });

    it("masking is blank-not-delete here too, so a destination cannot mint a handle", () => {
      // Deleting `](x)` out of `@di](x)ana` would leave `@diana`.
      expect(resolveMentions("@di](x)ana", ROSTER)).toEqual([]);
    });
  });

  describe("code still wins, and it wins FIRST", () => {
    it("a fenced block holding markup is code, not markup", () => {
      // ⚠ Ordering: if the markup pass ran first, an unbalanced `](` inside a
      // code sample could blank real prose after the fence.
      const body = "```\nsee [docs](https://ex.com/@diana)\n```\n\n@diana ping";
      expect(resolveMentions(body, ROSTER)).toEqual(["u-diana"]);
    });

    it("a backticked escape is code, and tags nobody either way", () => {
      expect(resolveMentions("write `\\@diana` to escape", ROSTER)).toEqual([]);
    });
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
