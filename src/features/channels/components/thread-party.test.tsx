import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isThreadParty, ReadOnlyThreadBadge } from "./thread-party";

/**
 * The client-side statement of the server's thread write gate
 * (`isThreadParticipant`, server/service-writes-metadata.ts): a thread belongs
 * to its creator and its addressee, and NOBODY else — not even another member
 * of the same channel, who can read the thread but is refused on write. These
 * cases pin the two ways the rule can go wrong at three members or more:
 * claiming a stranger is a party, and claiming a party is a stranger.
 */
describe("isThreadParty", () => {
  const thread = { createdBy: "u-ada", targetUserId: "u-bo" };

  it("counts the creator and the addressee, and nobody else", () => {
    expect(isThreadParty(thread, "u-ada")).toBe(true);
    expect(isThreadParty(thread, "u-bo")).toBe(true);
    expect(isThreadParty(thread, "u-carol")).toBe(false);
  });

  it("treats an unknown viewer as not a party", () => {
    // Absent viewer id = we do not know who is looking. Never a party, and the
    // callers must not render the read-only marker on that basis either.
    expect(isThreadParty(thread, undefined)).toBe(false);
    expect(isThreadParty(thread, "")).toBe(false);
  });

  it("never matches a null addressee", () => {
    // `target_user_id` is ON DELETE SET NULL, so a departed addressee leaves a
    // one-party thread. A viewer with no id must not slot into the empty seat.
    const orphaned = { createdBy: "u-ada", targetUserId: null };
    expect(isThreadParty(orphaned, "u-ada")).toBe(true);
    expect(isThreadParty(orphaned, "u-bo")).toBe(false);
    expect(isThreadParty(orphaned, undefined)).toBe(false);
  });
});

describe("ReadOnlyThreadBadge", () => {
  it("says read-only and explains why, in terms of this thread's two members", () => {
    const markup = renderToStaticMarkup(<ReadOnlyThreadBadge />);
    expect(markup).toContain("Read-only");
    expect(markup).toContain("only its two members can post into it");
  });
});
