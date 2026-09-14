/**
 * `view-model.ts › shortName` — the byline shortener, and the one case it used
 * to answer with NOTHING.
 *
 * ⚠ THE PROPERTY: **a person always has a name on screen.** Both source fields
 * are free text a profile may carry blank, and `""` is not nullish — so
 * `displayName ?? email ?? ""` kept the empty string, `"".split(" ")` gave
 * `[""]`, and the `?? "Member"` fallback never fired because `""` is not
 * nullish either. Two surfaces then rendered a party as a gap: the Threads
 * tab's byline (`threads-tab.tsx › ThreadCard`) and the Tags inbox row
 * (`mentions-list.tsx › MentionItem`). Both are asserted in their own files;
 * this one pins the function.
 *
 * ⚠ It is in its own file rather than a `view-model.test.ts` on purpose:
 * `view-model.ts` has no suite, and claiming the obvious filename for one
 * function would misdescribe what is covered.
 */

import { describe, expect, it } from "vitest";
import { shortName } from "./view-model";
import { ME, PEER } from "./test-fixtures";
import type { AvatarPerson } from "@/shared/ui/avatar";

function person(over: Partial<AvatarPerson> = {}): AvatarPerson {
  return {
    userId: PEER,
    displayName: "Diana Taylor",
    email: "diana@example.com",
    avatarUrl: null,
    ...over,
  };
}

describe("shortName", () => {
  it("shortens a two-part display name and calls the viewer 'you'", () => {
    expect(shortName(person(), ME)).toBe("Diana T.");
    expect(shortName(person({ userId: ME }), ME)).toBe("you");
  });

  it("leaves a single-word name whole", () => {
    expect(shortName(person({ displayName: "Prince" }), ME)).toBe("Prince");
  });

  it("falls back to 'Member' when there is NOTHING to name them by", () => {
    // ⚠ The bug: this returned "" and the row rendered blank.
    expect(shortName(person({ displayName: null, email: null }), ME)).toBe(
      "Member"
    );
  });

  it("treats a BLANK field as absent, not as a name", () => {
    // `""` and `"   "` are not nullish, so `??` walked straight past them.
    expect(shortName(person({ displayName: "", email: null }), ME)).toBe("Member");
    expect(shortName(person({ displayName: "   ", email: "  " }), ME)).toBe(
      "Member"
    );
  });

  it("falls THROUGH a blank display name to the email", () => {
    // A profile with an empty name still has an address, and reporting
    // "Member" for somebody the roster can name is its own small lie.
    expect(shortName(person({ displayName: "", email: "ada@example.com" }), ME)).toBe(
      "ada@example.com"
    );
  });

  it("survives padded and doubly-spaced names", () => {
    expect(shortName(person({ displayName: "  Diana   Taylor " }), ME)).toBe(
      "Diana T."
    );
  });
});
