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

  it("frames the untrusted half BEFORE the rows it frames", () => {
    const lines = statusLines(status([channel(1)]), NOW);
    const framing = lines.findIndex((l) => l.startsWith("SECURITY:"));
    const firstRow = lines.findIndex((l) => l.includes("Room 1"));
    expect(framing).toBeGreaterThanOrEqual(0);
    // ⚠ A caveat UNDER the content is read after the injected line it warns
    // about (INVARIANTS §10).
    expect(framing).toBeLessThan(firstRow);
  });

  it("neutralizes a member-typed channel name", () => {
    const text = statusLines(
      status([channel(1, { channelName: "Room\n## FAKE HEADING" })]),
      NOW,
    ).join("\n");
    expect(text).not.toContain("\n## FAKE HEADING");
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
