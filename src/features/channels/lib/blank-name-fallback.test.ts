/**
 * 🔒 A NAME THAT IS NOT REALLY A NAME FALLS BACK ON EVERY SURFACE, IDENTICALLY (2026-09-07).
 *
 * ⚠ THE DEFECT CLASS. Display fallbacks in this tree were written two ways: `||`, which catches
 * the empty string, and `??`, which does NOT — it falls back only on null and undefined. Five
 * places had the second, and each rendered a real user-visible blank: a DM with no name in the
 * sidebar and header (`channel-display.ts`), an unlabelled row in the knowledge grant picker, a
 * guest row that silently lost its "Guest", and the default-responder dropdown row that started
 * the hunt (that last one is not pinned here — it dies whole in the responder rewire, and a test
 * on a corpse is a test somebody has to delete).
 *
 * ⚠ AND THE HALF `||` STILL MISSED: WHITESPACE. `"   "` is truthy, so a member whose display
 * name is spaces rendered as spaces. The HANDLE side never had this bug — `mentions.ts ›
 * handlesOf` has always done `(source ?? "").trim()` and skipped a source that empties — so the
 * two sides of the SAME picker had already diverged: a blank row that inserted a working
 * email-derived handle underneath it. That is why {@link memberLabel} now trims, and why the
 * parity block below asserts the property in the form that actually matters: a whitespace name
 * must behave EXACTLY like an absent one, on the label and on the inserted token alike.
 */

import { describe, expect, it } from "vitest";
import { channelDisplayName, memberLabel } from "./channel-display";
import { buildMentionIndex, insertableHandle } from "./mentions";
import { channel, member, ME, PEER } from "../components/channels-v2/test-fixtures";

const BLANKS = ["", "   ", "\t", "\n  "];

describe("memberLabel treats a blank display name as absent", () => {
  it("falls through to the email for every blank shape, never rendering it", () => {
    for (const displayName of BLANKS) {
      expect(memberLabel(member({ displayName }))).toBe("sam@example.com");
    }
  });

  it("falls through to the user id when the email is blank too — a row is never empty", () => {
    // ⚠ THE INVARIANT THIS FILE'S SUBJECT DOCBLOCK CLAIMS ("so a row is never blank"). The id is
    // ugly and that is the point: it is the last resort that cannot itself be empty.
    for (const displayName of BLANKS) {
      expect(memberLabel(member({ displayName, email: "  " }))).toBe(ME);
    }
  });

  it("keeps a real name, trimmed", () => {
    expect(memberLabel(member({ displayName: "  Sam Wang  " }))).toBe("Sam Wang");
  });
});

describe("the picker's label and the token it inserts agree about what a name is", () => {
  // ⚠ THE PARITY IS "BLANK BEHAVES LIKE ABSENT", not "the two strings are equal" — a label is a
  // name and a handle is a slug, and they are not supposed to be the same string. What must hold
  // is that both surfaces pick the same SOURCE, or the row shows one person and tags another.
  const index = (m: ReturnType<typeof member>) =>
    buildMentionIndex([m, member({ userId: PEER, displayName: "Diana Taylor", email: "diana@example.com" })]);

  it("renders and inserts for a whitespace name exactly as for no name at all", () => {
    const absent = member({ displayName: null });
    for (const displayName of BLANKS) {
      const blank = member({ displayName });
      expect(memberLabel(blank)).toBe(memberLabel(absent));
      expect(insertableHandle(blank, index(blank))).toBe(
        insertableHandle(absent, index(absent))
      );
    }
  });

  it("and the token it inserts is the email's, which still resolves back to them", () => {
    const blank = member({ displayName: "   " });
    const handle = insertableHandle(blank, index(blank));
    expect(handle).toBe("sam");
    expect(index(blank).get(handle!)).toBe(ME);
  });
});

describe("a DM header never renders a nameless channel", () => {
  const dm = channel({ isDirect: true, directPeer: null });
  const roster = (displayName: string | null) => [
    member({ userId: ME, displayName: "Sam Wang" }),
    member({ userId: PEER, displayName, email: "diana@example.com" }),
  ];

  it("falls back to the peer's email when their display name is blank", () => {
    // ⚠ THE ORIGINAL BUG, EXACTLY: this line read `peer?.displayName ?? peer?.email ?? …`, so an
    // empty-string name was returned AS the channel's name and the DM rendered untitled.
    for (const displayName of BLANKS) {
      expect(channelDisplayName(dm, roster(displayName), ME)).toBe("diana@example.com");
    }
  });

  it("still says 'Direct message' when there is no peer to name", () => {
    // The literal is kept for the case it was written for — an unresolvable peer — and not as a
    // stand-in for a peer whose name happens to be empty.
    expect(channelDisplayName(dm, [], ME)).toBe("Direct message");
    expect(channelDisplayName(dm)).toBe("Direct message");
  });

  it("prefers the server-resolved peer, and a non-direct channel keeps its own name", () => {
    expect(channelDisplayName(channel({ name: "Website" }), roster(null), ME)).toBe("Website");
  });
});
