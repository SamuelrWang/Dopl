/**
 * 🔒 **`sessionChannelId` — THE HEAD OF A SESSION KEY, AND THE UUID GUARD ON IT**
 * (rule B, 2026-09-13).
 *
 * ⚠ **WRITTEN BECAUSE THE GUARD SURVIVED A MUTATION (2026-09-14 review).** Deleting
 * `UUID_RE.test(head)` — so ANY colon-headed handle became a claimed channel — left the
 * mcp/auth suites green. The function's own docblock states the rule ("not uuid-headed →
 * null, because another client's opaque handle may carry a colon that names no channel"),
 * and nothing held it.
 *
 * ⚠ **WHAT THE GUARD IS AND IS NOT.** It is NOT the security fence — that is
 * `billing/server/channel-attribution.ts › resolveCallingChannel`, which honours a claimed
 * channel only for a container the caller is an active member of, and this header
 * establishes nothing on its own (see `session-header.ts`'s own header). The guard is what
 * keeps a NON-desktop client's opaque handle from costing a channel lookup and a warn line
 * on **every MCP tool call**: `resolveCallingChannel` reads the channel row for any
 * non-empty claim, so a junk head is a round trip per call plus a log line that reads like
 * a forgery.
 *
 * ⚠ The two sibling readers of this header (`readSessionIdHeader`, `narrowSessionId`) are
 * pinned by `features/channels/server/service-writes-metadata-session.test.ts`; only the
 * money-side split is new here.
 */

import { describe, it, expect } from "vitest";
import { sessionChannelId } from "./session-header";

const CHANNEL = "3f2b6c1e-8a4d-4c1f-9f77-0c5b2a9e1d44";

describe("sessionChannelId — the calling channel out of a desktop slot key", () => {
  it("splits `<channelId>:<tail>` and answers the head", () => {
    expect(sessionChannelId(`${CHANNEL}:agent-7`)).toBe(CHANNEL);
    // ⚠ THE EMPTY TAIL IS A REAL SLOT SHAPE — a team session with no thread —
    // and it names a channel exactly as a filled one does.
    expect(sessionChannelId(`${CHANNEL}:`)).toBe(CHANNEL);
    // A bare channel id with no separator is still a channel.
    expect(sessionChannelId(CHANNEL)).toBe(CHANNEL);
    // ⚠ CASE-INSENSITIVE: the shape is what is checked, not a canonical spelling.
    expect(sessionChannelId(`${CHANNEL.toUpperCase()}:x`)).toBe(
      CHANNEL.toUpperCase()
    );
  });

  it("🔒 answers null for a head that is not a uuid — the guard, not the fence", () => {
    // Another client's opaque handle. It carries a colon and names no channel.
    expect(sessionChannelId("claude-code:abc")).toBeNull();
    expect(sessionChannelId("sess_01HX:thread-2")).toBeNull();
    // A near-miss uuid is a bug to notice, not a value to coerce.
    expect(sessionChannelId(`${CHANNEL.slice(0, -1)}:x`)).toBeNull();
    expect(sessionChannelId(`${CHANNEL}x:agent-7`)).toBeNull();
    // A leading separator has an EMPTY head, which must not read as "present".
    expect(sessionChannelId(`:${CHANNEL}`)).toBeNull();
  });

  it("answers null when there is no key at all, or the key is unshaped", () => {
    // Every non-desktop client — a Claude Desktop / Claude Code connection —
    // sends nothing, and that is rule B's ordinary fallback arm, not a failure.
    expect(sessionChannelId(undefined)).toBeNull();
    expect(sessionChannelId(null)).toBeNull();
    expect(sessionChannelId("")).toBeNull();
    // ⚠ REJECTED BY `narrowSessionId` FIRST, so it never reaches the split: the
    // same predicate the header reader applies, applied once more.
    expect(sessionChannelId(`${CHANNEL} :agent-7`)).toBeNull();
    expect(sessionChannelId(`${CHANNEL}\n:agent-7`)).toBeNull();
    expect(sessionChannelId(`${CHANNEL}:${"x".repeat(200)}`)).toBeNull();
  });
});
