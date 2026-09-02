import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import type { ChannelPing } from "@/features/channels/types";
import { NeedsYou, handOffConfig, pingAge } from "./needs-you";

/**
 * THE "NEEDS YOU" INBOX.
 *
 * What is pinned here is what the panel is FOR, not its layout:
 *  - the three kinds are distinguishable at a glance;
 *  - **"Open thread" is ABSENT, not disabled, when there is no thread** — the
 *    design-system rule for an action that cannot apply;
 *  - **"Send to Desktop Agent" files a NEW ping with `toDesktop: true`**, which
 *    is the whole point of the button: it is how a human hands a signal to the
 *    external session without typing it out. The original row is never rewritten.
 */

const WS = "11111111-2222-3333-4444-555555555555";
const CH = "33333333-4444-5555-6666-777777777777";
const SEGMENT = "acme-ab12";

const ping = (over: Partial<ChannelPing> = {}): ChannelPing => ({
  id: "p-1",
  seq: 12,
  channelId: CH,
  channelSlug: "build",
  threadId: null,
  senderUserId: "u2",
  senderAgentId: "k3wpf7c5",
  recipientKind: "desktop",
  recipientUserId: "u1",
  recipientAgentId: null,
  kind: "done",
  body: "migration written, tests green",
  createdAt: new Date().toISOString(),
  ...over,
});

function mount(rows: ChannelPing[]) {
  const client = createQueryClient();
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <NeedsYou
            rows={rows}
            segment={SEGMENT}
            workspaceId={WS}
            onRefresh={() => {}}
          />
        ),
      },
    ],
    { initialEntries: ["/"] }
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ping: ping({ id: "p-2" }) }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the empty state", () => {
  it("says nothing yet rather than showing an empty list", () => {
    mount([]);
    expect(screen.getByText("Nothing yet.")).toBeTruthy();
  });
});

describe("a row", () => {
  it("shows the body, the sending agent, the channel and the AGE", () => {
    mount([ping()]);
    expect(screen.getByText("migration written, tests green")).toBeTruthy();
    // ⚠ Age, not a clock time: the only question a reader has about a ping is
    // how long it has been sitting there unread.
    expect(screen.getByText(/now · build · @agent-k3wpf7c5/)).toBeTruthy();
  });

  it("distinguishes the three kinds", () => {
    mount([
      ping({ id: "a", kind: "done" }),
      ping({ id: "b", kind: "question" }),
      ping({ id: "c", kind: "blocked" }),
    ]);
    for (const label of ["Done", "Question", "Blocked"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("says 'a member' when no agent sent it — null is NOT REPORTED", () => {
    mount([ping({ senderAgentId: null })]);
    expect(screen.getByText(/a member/)).toBeTruthy();
  });
});

describe('"Open thread"', () => {
  it("is ABSENT, not disabled, when the ping points at no thread", () => {
    mount([ping({ threadId: null })]);
    expect(screen.queryByText("Open thread")).toBeNull();
  });

  it("links into the existing channel deep link with the thread pre-opened", () => {
    mount([ping({ threadId: "t-1" })]);
    const link = screen.getByText("Open thread") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toContain(`/${SEGMENT}/channels/${CH}`);
    expect(link.getAttribute("href")).toContain("thread=t-1");
  });
});

describe('"Send to Desktop Agent"', () => {
  it("POSTs a NEW ping with toDesktop:true, quoting the original", async () => {
    mount([ping({ threadId: "t-1", kind: "blocked" })]);
    fireEvent.click(screen.getByText("Send to Desktop Agent"));
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/pings");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.toDesktop).toBe(true);
    expect(body.channel).toBe(CH);
    // ⚠ The KIND rides through: handing a `blocked` signal on as `done` would
    // misreport the thing the operator is trying to escalate.
    expect(body.kind).toBe("blocked");
    expect(body.threadId).toBe("t-1");
    // ⚠ QUOTED, not restated, so the external agent reads what the sending
    // agent actually wrote.
    expect(body.body).toContain("migration written, tests green");
    expect(body.body).toContain("@agent-k3wpf7c5");
  });
});

describe("handOffConfig — the request it builds", () => {
  it("omits threadId entirely when there is none (absent, never null)", () => {
    const req = handOffConfig(WS, () => {}).request({
      channel: CH,
      kind: "done",
      body: "b",
      threadId: null,
    });
    expect(Object.keys(req.body)).not.toContain("threadId");
    expect(req.workspaceId).toBe(WS);
  });
});

describe("pingAge", () => {
  it("counts up in minutes, hours, then days", () => {
    const now = new Date("2026-09-01T12:00:00Z");
    expect(pingAge("2026-09-01T11:59:40Z", now)).toBe("now");
    expect(pingAge("2026-09-01T11:56:00Z", now)).toBe("4m");
    expect(pingAge("2026-09-01T09:00:00Z", now)).toBe("3h");
    expect(pingAge("2026-08-30T12:00:00Z", now)).toBe("2d");
  });

  it("renders nothing for an unparseable timestamp rather than 'NaN'", () => {
    expect(pingAge("not a date")).toBe("");
  });
});
