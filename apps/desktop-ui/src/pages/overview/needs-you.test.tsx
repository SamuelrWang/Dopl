import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { AccountStatus, AccountWaitingItem } from "@/features/channels/types";
import { NeedsYou, needsYouRows, waitingAge, type NeedsYouRow } from "./needs-you";

/**
 * THE "NEEDS YOU" CARD — messages addressed to this person and unanswered.
 *
 * What is pinned here is what the panel is FOR, not its layout:
 *  - the account-wide `status` payload is FLATTENED across channels and ordered
 *    OLDEST FIRST — a reader is asking "what have I left hanging", and the
 *    payload nests `waiting` inside each channel;
 *  - a DECISION card (option buttons, waiting on a press) is distinguishable
 *    from an ordinary request at a glance;
 *  - **"Open thread" is ABSENT, not disabled, when there is no thread** — the
 *    design-system rule for an action that cannot apply;
 *  - an unresolved author renders "a member", never a raw user id.
 */

const CH = "33333333-4444-5555-6666-777777777777";
const SEGMENT = "acme-ab12";

const item = (over: Partial<AccountWaitingItem> = {}): AccountWaitingItem => ({
  messageId: "m-1",
  seq: 12,
  channelId: CH,
  threadId: null,
  authorUserId: "u2",
  authorName: "Diana Taylor",
  preview: "migration written, tests green",
  createdAt: new Date().toISOString(),
  isEscalation: false,
  ...over,
});

const row = (over: Partial<NeedsYouRow> = {}): NeedsYouRow => ({
  ...item(),
  channelSlug: "build",
  ...over,
});

function mount(rows: NeedsYouRow[]) {
  const router = createMemoryRouter(
    [{ path: "*", element: <NeedsYou rows={rows} segment={SEGMENT} /> }],
    { initialEntries: ["/"] }
  );
  return render(<RouterProvider router={router} />);
}

afterEach(cleanup);

const WS = "11111111-2222-3333-4444-555555555555";

describe("needsYouRows — the payload, narrowed and flattened", () => {
  it("joins each waiting item to its channel and orders OLDEST first", () => {
    const status = {
      channels: [
        {
          channelId: CH,
          channelName: "Build",
          channelSlug: "build",
          workspaceId: WS,
          lastSeq: 30,
          lastMessageAt: null,
          unread: null,
          sessions: [],
          waiting: [item({ messageId: "b", seq: 20 })],
        },
        {
          channelId: "c2",
          channelName: "Ops",
          channelSlug: "ops",
          workspaceId: WS,
          lastSeq: 12,
          lastMessageAt: null,
          unread: null,
          sessions: [],
          waiting: [item({ messageId: "a", seq: 4 })],
        },
      ],
      operatorOnline: true,
      since: null,
      truncated: { channels: false, unread: false, waiting: false },
    } as AccountStatus;
    expect(
      needsYouRows(status, WS).map((r) => [r.messageId, r.channelSlug])
    ).toEqual([
      ["a", "ops"],
      ["b", "build"],
    ]);
  });

  it("🔒 drops every channel outside THIS workspace", () => {
    // ⚠ The read is USER-scoped and answers for every container the caller is
    // in; the panel sits on a WORKSPACE overview. Rendering the payload whole
    // would put another workspace's — or a home channel's — open requests under
    // this workspace's heading.
    const status = {
      channels: [
        {
          channelId: "c9",
          channelName: "Elsewhere",
          channelSlug: "elsewhere",
          workspaceId: "another-container",
          lastSeq: 9,
          lastMessageAt: null,
          unread: null,
          sessions: [],
          waiting: [item({ messageId: "x", seq: 1 })],
        },
      ],
      operatorOnline: true,
      since: null,
      truncated: { channels: false, unread: false, waiting: false },
    } as AccountStatus;
    expect(needsYouRows(status, WS)).toEqual([]);
  });

  it("answers an empty list before the read lands, never throws", () => {
    // ⚠ The card is deliberately OUTSIDE the page's paint gate, so it renders
    // against `undefined` on the first frame.
    expect(needsYouRows(undefined, WS)).toEqual([]);
  });
});

describe("the empty state", () => {
  it("says nothing yet rather than showing an empty list", () => {
    mount([]);
    expect(screen.getByText("Nothing yet.")).toBeTruthy();
  });
});

describe("a row", () => {
  it("shows the preview, the author, the channel and the AGE", () => {
    mount([row()]);
    expect(screen.getByText("migration written, tests green")).toBeTruthy();
    expect(screen.getByText(/now · build · Diana Taylor/)).toBeTruthy();
  });

  it("distinguishes a decision card from an ordinary request", () => {
    mount([row({ messageId: "a" }), row({ messageId: "b", isEscalation: true })]);
    expect(screen.getByText("Request")).toBeTruthy();
    expect(screen.getByText("Decision")).toBeTruthy();
  });

  it("says 'a member' when the author did not resolve — null is NOT REPORTED", () => {
    mount([row({ authorName: null })]);
    expect(screen.getByText(/a member/)).toBeTruthy();
  });
});

describe('"Open thread"', () => {
  it("is ABSENT, not disabled, when the message is on no thread", () => {
    mount([row({ threadId: null })]);
    expect(screen.queryByText("Open thread")).toBeNull();
  });

  it("links into the existing channel deep link with the thread pre-opened", () => {
    mount([row({ threadId: "t-1" })]);
    const link = screen.getByText("Open thread") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain(`/${SEGMENT}/channels/${CH}`);
    expect(link.getAttribute("href")).toContain("thread=t-1");
  });
});

describe("waitingAge", () => {
  it("counts up in minutes, hours, then days", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    expect(waitingAge("2026-09-01T11:59:40Z", now)).toBe("now");
    expect(waitingAge("2026-09-01T11:56:00Z", now)).toBe("4m");
    expect(waitingAge("2026-09-01T09:00:00Z", now)).toBe("3h");
    expect(waitingAge("2026-08-30T12:00:00Z", now)).toBe("2d");
  });

  it("renders nothing for an unparseable timestamp rather than 'NaN'", () => {
    expect(waitingAge("not a date")).toBe("");
  });
});
