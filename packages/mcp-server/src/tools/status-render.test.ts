/**
 * THE `dopl_status` TABLE — the BUDGET, and the two things it must never claim.
 *
 * ⚠ **THE LINE BUDGET IS A REAL ASSERTION, NOT A STYLE PREFERENCE.** This block
 * rides an orchestrator's every check-in; the tool is worth having only if the
 * answer fits in a glance, and prose added here is prose on every loop of every
 * run. Ten quiet channels must stay under ~40 lines.
 *
 * ⚠ And the two claims it must not make: a `null` unread is NOT ZERO (nobody
 * asked), and a CLIPPED page is not an exhausted one (§9).
 */

import { describe, expect, it } from "vitest";
import type { AccountChannelStatus, AccountStatus } from "@dopl/client";
import { statusLines } from "./status-render.js";

function channel(
  n: number,
  extra: Partial<AccountChannelStatus> = {},
): AccountChannelStatus {
  return {
    channelId: `ch-${n}`,
    channelName: `Room ${n}`,
    channelSlug: `room-${n}`,
    workspaceId: `ws-${n}`,
    lastSeq: 1000 + n,
    lastMessageAt: "2026-09-01T00:00:00Z",
    unread: 0,
    sessions: [],
    waiting: [],
    ...extra,
  };
}

function status(
  channels: AccountChannelStatus[],
  extra: Partial<AccountStatus> = {},
): AccountStatus {
  return {
    channels,
    operatorOnline: true,
    since: 1000,
    truncated: { channels: false, unread: false, waiting: false },
    ...extra,
  };
}

const NOW = Date.parse("2026-09-01T00:00:00Z");

describe("the status table", () => {
  it("stays under ~40 lines for TEN channels", () => {
    const lines = statusLines(
      status(Array.from({ length: 10 }, (_, i) => channel(i))),
      NOW,
    );
    // ⚠ The budget the tool's whole value rests on. If this has to grow, the
    // question is what to REMOVE, not what number to raise.
    expect(lines.length).toBeLessThanOrEqual(40);
    // And it really did render all ten — a budget met by dropping rows is the
    // failure, not the fix.
    for (let i = 0; i < 10; i++) expect(lines.join("\n")).toContain(`Room ${i}`);
  });

  it("publishes BOTH ids on every row — the workspace handle is the point", () => {
    const text = statusLines(status([channel(1)]), NOW).join("\n");
    // A home channel's CONTAINER id appears here and in `dopl_home` and nowhere
    // else; without it the row names a room the reader cannot address.
    expect(text).toContain("workspace=`ws-1`");
    expect(text).toContain("channel=`room-1`");
  });

  it("renders a null unread as `no cursor`, NEVER as 0", () => {
    const text = statusLines(
      status([channel(1, { unread: null })], { since: null }),
      NOW,
    ).join("\n");
    expect(text).toContain("no cursor");
    // ⚠ The whole point: "0 new" is a measurement, and nobody took one.
    expect(text).not.toMatch(/\b0 new\b/);
  });

  it("renders a real zero as `0 new`, so a quiet room is distinguishable", () => {
    const text = statusLines(status([channel(1, { unread: 0 })]), NOW).join("\n");
    expect(text).toContain("0 new");
  });

  /**
   * ⚠ **REWRITTEN DOWN TO WHAT SURVIVES (T11, 2026-09-02) — §14's rule for a
   * case whose feature was deleted.** This asserted that a `SECURITY:` line was
   * emitted ABOVE the first row, because a caveat printed UNDER the content is
   * read after the injected line it warns about. That banner is GONE from this
   * render, and from every other read surface, by the same tier's ruling: it
   * rode an orchestrator's most-repeated call, and the framing was moved to a
   * text read ONCE.
   *
   * ⚠ **WHAT REPLACED IT IS NOT ASSERTED HERE, DELIBERATELY, AND THAT IS A
   * FINDING RATHER THAN AN OMISSION.** `status-render.ts`'s own comment says the
   * rule is now "stated ONCE in `channel-description.ts`'s `SECURITY, SAID ONCE
   * HERE` paragraph" — but that paragraph scopes itself to "EVERY RESULT **THIS
   * TOOL** RETURNS", and `dopl_status` is a different tool whose own
   * description (`status.ts › STATUS_DESCRIPTION`) carries no framing at all.
   * Asserting the linkage would pin a claim that is not true, so this case pins
   * the two halves that ARE true — the departure, and the neutralization that is
   * what actually defangs a hostile string — and the gap is reported rather than
   * papered over.
   */
  it("re-transmits NO per-result banner — the T11 cut, on the hottest call there is", () => {
    const lines = statusLines(status([channel(1)]), NOW);
    // ⚠ ASSERTED AS AN ABSENCE ON A REAL RENDER, not as a source scan: this is
    // the call an orchestrator opens every check-in with, so a banner growing
    // back here is the single most expensive regression on the surface.
    expect(lines.some((l) => l.startsWith("SECURITY:"))).toBe(false);
    // And the page still rendered — an absence proved over nothing is not a
    // guard (the mistake §14 names).
    expect(lines.some((l) => l.includes("Room 1"))).toBe(true);
  });

  it("neutralizes EVERY member-typed string — the half the banner never did", () => {
    // ⚠ THE PROPERTY THE DELETED BANNER ONLY DESCRIBED. Three untrusted values
    // splice into lines this file wrote — the channel name, the author name and
    // a fragment of somebody's message body — and each is checked, because a
    // neutralizer applied to two of three leaves the third able to open a
    // heading above the rows a reader is about to trust.
    const text = statusLines(
      status([
        channel(1, {
          channelName: "Room\n## FAKE HEADING",
          waiting: [
            {
              messageId: "m1",
              seq: 1201,
              channelId: "ch-1",
              threadId: null,
              authorUserId: "u2",
              authorName: "Dana\n## FAKE AUTHOR",
              preview: "look here\n## FAKE PREVIEW",
              createdAt: "2026-09-01T00:00:00Z",
              isEscalation: false,
            },
          ],
        }),
      ]),
      NOW,
    ).join("\n");
    expect(text).not.toContain("\n## FAKE HEADING");
    expect(text).not.toContain("\n## FAKE AUTHOR");
    expect(text).not.toContain("\n## FAKE PREVIEW");
  });

  it("names a CLIP rather than letting it pass as an absence", () => {
    const text = statusLines(
      status([channel(1)], {
        truncated: { channels: true, unread: true, waiting: false },
      }),
      NOW,
    ).join("\n");
    expect(text).toContain("CLIPPED");
    // ⚠ A count at its ceiling is a FLOOR, and the line has to say so or a
    // reader treats a bounded tally as a total.
    expect(text).toContain("FLOOR");
  });

  it("says nothing about clipping when nothing clipped", () => {
    expect(statusLines(status([channel(1)]), NOW).join("\n")).not.toContain(
      "CLIPPED",
    );
  });

  it("renders a waiting item with its seq, its author and an ESCALATION mark", () => {
    const text = statusLines(
      status([
        channel(1, {
          waiting: [
            {
              messageId: "m1",
              seq: 1201,
              channelId: "ch-1",
              threadId: null,
              authorUserId: "u2",
              authorName: "Dana",
              preview: "can you look at the CI failure",
              createdAt: "2026-09-01T00:00:00Z",
              isEscalation: true,
            },
          ],
        }),
      ]),
      NOW,
    ).join("\n");
    expect(text).toContain("ESCALATION #1201");
    expect(text).toContain("Dana");
    expect(text).toContain("can you look at the CI failure");
  });

  it("prints the handle note ONLY when there is a session to address", () => {
    const quiet = statusLines(status([channel(1)]), NOW).join("\n");
    expect(quiet).not.toContain("@agent-");

    const busy = statusLines(
      status([
        channel(1, {
          sessions: [
            {
              channelId: "ch-1",
              threadId: null,
              name: "x2sz1ztt",
              state: "working",
              channelName: "Room 1",
              threadTitle: null,
              updatedAt: new Date(NOW).toISOString(),
              model: "claude-opus-5[1m]",
              toolLabel: "Bash",
              contextUsed: null,
              contextWindow: null,
              tokensSpent: null,
              startedAt: null,
              lastActivityAt: null,
              templateName: "Orchestrator",
            },
          ],
        }),
      ]),
      NOW,
    ).join("\n");
    expect(busy).toContain("`@agent-x2sz1ztt`");
    // The projection renderer's own output, reused verbatim — template, then
    // model as ONE token (F-293).
    expect(busy).toContain("Orchestrator");
    expect(busy).toContain("opus-5-1m");
  });

  it("says so, and offers a next step, when there is nothing at all", () => {
    const text = statusLines(status([]), NOW).join("\n");
    expect(text).toContain("No channels");
    expect(text).toContain("dopl_home(op='create_channel'".replace(/'/g, '"'));
  });
});
