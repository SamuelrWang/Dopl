/**
 * 🔒 THE PICKER MAY ONLY INSERT A TOKEN THE PARSER GIVES BACK UNCHANGED (2026-09-07).
 *
 * ⚠ THE DEFECT, AND IT IS F-210 REACHED BY A DIFFERENT DOOR. `insertableHandle` promises a token
 * "the resolver accepts BY CONSTRUCTION", and it checked exactly one half of that: that the INDEX
 * maps the handle back to this member. But the index is keyed on the RAW slug, so a display name
 * ending in punctuation claims a handle ending in punctuation — "Diana Taylor Jr." claims
 * `diana-taylor-jr.` — while `mentionHandleOf` strips that trailing run off the token BEFORE the
 * lookup. The picker inserted `@diana-taylor-jr.`, the resolver asked for `diana-taylor-jr`, and
 * the message tagged nobody. A row that shows a name and lands on no one is the precise thing
 * F-210 was fixed to stop.
 *
 * ⚠ `TRAILING_PUNCTUATION`'s own note calls this residual pre-existing — true — and implies it is
 * harmless because "insertableHandle has always been able to offer such a handle". That is the
 * defect stated as a reassurance.
 *
 * ⚠ THE FIX IS A ROUND TRIP THROUGH THE REAL PARSER, not a second punctuation list, so it stays
 * correct the next time that class changes. The member is not made unreachable: they keep every
 * handle that does survive, which is the same fallback the ambiguity rule already relies on.
 */

import { describe, expect, it } from "vitest";
import {
  buildMentionIndex,
  insertableHandle,
  mentionHandleOf,
  resolveMentionToken,
} from "./mentions";
import {
  agentIdHandle,
  agentMentionFace,
  agentMentionHandle,
  buildAgentMentionIndex,
  resolveAgentHandle,
} from "./agent-mentions";
import { member, ME, PEER } from "../components/channels-v2/test-fixtures";

const other = member({
  userId: PEER,
  displayName: "Anthony Ross",
  email: "anthony@example.com",
});

const setup = (displayName: string | null, email: string | null = "diana@example.com") => {
  const m = member({ userId: ME, displayName, email });
  return { m, index: buildMentionIndex([m, other]) };
};

/** What the composer actually does: take the handle, write `@handle`, and let the resolver read
 *  it back. Anything else tests the halves and not the seam. */
const inserted = (handle: string | null) => (handle === null ? null : `@${handle}`);

describe("a name ending in punctuation", () => {
  const { m, index } = setup("Diana Taylor Jr.");

  it("is not offered as the handle the strip would eat", () => {
    expect(insertableHandle(m, index)).not.toBe("diana-taylor-jr.");
  });

  it("offers a handle that survives the round trip and tags the member for real", () => {
    const handle = insertableHandle(m, index);
    expect(handle).toBe("diana");
    expect(resolveMentionToken(inserted(handle)!, index)).toBe(ME);
  });

  it("and the token it USED to insert really did tag nobody — the defect, pinned", () => {
    // ⚠ THE INDEX STILL HOLDS THE RAW SLUG, deliberately: bodies already written that end in the
    // punctuation keep whatever behaviour they had. What changed is only what the picker OFFERS.
    expect(resolveMentionToken("@diana-taylor-jr.", index)).toBeNull();
  });
});

describe("the ordinary cases are untouched", () => {
  it("offers the slug for a plain two-word name", () => {
    const { m, index } = setup("Diana Taylor");
    const handle = insertableHandle(m, index);
    expect(handle).toBe("diana-taylor");
    expect(resolveMentionToken(inserted(handle)!, index)).toBe(ME);
  });

  it("keeps an underscore INSIDE a handle, which is legal and only stripped trailing", () => {
    const { m, index } = setup("Diana_Taylor");
    expect(insertableHandle(m, index)).toBe("diana_taylor");
  });

  it("falls back to the email forms when the display name is absent", () => {
    const { m, index } = setup(null);
    const handle = insertableHandle(m, index);
    expect(handle).toBe("diana");
    expect(resolveMentionToken(inserted(handle)!, index)).toBe(ME);
  });
});

/**
 * ⚠ THE AGENT NAMESPACE HAS THE SAME DEFECT FOR THE SAME REASON: it slugs a free-text name an
 * operator chose. Fixing only the member half would have left the picker offering `@bot!` in the
 * very next row. The agent side has a fallback members do not — the id form, which is never
 * withdrawn — so an unusable NAME costs the name and nothing else.
 */
describe("an agent whose name does not survive the strip", () => {
  const AGENT = "m4x8p1qr";
  const identities = (displayName: string | null) =>
    new Map([[AGENT, { displayName }]]);

  it("is offered by its id form rather than by a handle that reaches nobody", () => {
    expect(agentMentionHandle({ agentId: AGENT, displayName: "Bot!" })).toBe(
      agentIdHandle(AGENT)
    );
  });

  it("and the handle it IS offered by resolves for real", () => {
    const handle = agentMentionHandle({ agentId: AGENT, displayName: "Bot!" });
    const index = buildAgentMentionIndex([{ agentId: AGENT, displayName: "Bot!" }]);
    expect(resolveAgentHandle(mentionHandleOf(`@${handle}`), index)).toBe(AGENT);
  });

  it("faces NULL, so the tag renders as the raw token the reader can actually retype", () => {
    // ⚠ `agentMentionFace`'s own rule is that a face is "a TAG a reader may retype". `@bot!` is
    // not one: the strip turns it into `bot`, which claims nothing.
    expect(agentMentionFace(AGENT, identities("Bot!"))).toBeNull();
  });

  it("still faces and offers an ordinary name normally", () => {
    expect(agentMentionFace(AGENT, identities("Research Bot"))).toBe("research-bot");
    expect(
      agentMentionHandle({ agentId: AGENT, displayName: "Research Bot" })
    ).toBe("research-bot");
  });
});

describe("when nothing they claim survives, they are offered nothing", () => {
  it("answers null rather than a token that reaches no one", () => {
    // ⚠ `null` IS ALREADY A MEANINGFUL ANSWER HERE — the ambiguity rule produces it too, and
    // `composer-mentions.tsx` already declines to list a candidate that has none. This just
    // widens the set of reasons a handle can be unusable from "contested" to "unusable".
    const { m, index } = setup("Jr.", null);
    expect(insertableHandle(m, index)).toBeNull();
  });

  it("does not disturb the other member's own handle", () => {
    const { index } = setup("Jr.", null);
    expect(resolveMentionToken("@anthony-ross", index)).toBe(PEER);
  });
});
