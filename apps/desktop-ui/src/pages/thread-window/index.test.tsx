import { render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import { THREAD_WINDOW_PATH, routes } from "#/routes";
import { SEGMENT } from "#/test-utils/bridge";

/**
 * THE POP-OUT THREAD WINDOW'S PAGE — the seam, driven through the REAL route
 * table (Samuel, 2026-08-19).
 *
 * ⚠ IT GOES THROUGH `routes` ON PURPOSE. The requirement is not "this component
 * renders a transcript" — it is that the pop-out's URL resolves to a surface
 * with NO app shell around it. Mounting the page directly would assert the
 * component and prove nothing about the row, and the row is the change.
 *
 * ⚠ AND THE ASSERTIONS ARE MOSTLY ABSENCES, because that is what went wrong:
 * the pop-out landed on the full channels page until now, so a window opened to
 * read one thread arrived carrying the app sidebar, the channels tree and the
 * info panel. A test that only looked for the message would have stayed green
 * through the entire bug.
 *
 * `fetch` is the mock point, the seam both clients share.
 */

vi.mock("@/shared/supabase/browser", () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    getSupabaseBrowser: () => ({
      channel: () => channel,
      removeChannel: () => {},
      auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    }),
  };
});

const CHANNEL_ID = "ch-1";
const THREAD_ID = "t-1";

/** Fresh per test: the realtime registry shares one channel per workspace id. */
let workspaceId = "";
let workspaceSeq = 0;

const THREAD = {
  id: THREAD_ID,
  channelId: CHANNEL_ID,
  workspaceId: "",
  title: "Ship the release",
  status: "open",
  outcome: null,
  mode: "collab",
  createdBy: "u-1",
  targetUserId: "u-2",
  createdAt: "2026-08-01T11:00:00.000Z",
  updatedAt: "2026-08-01T11:00:00.000Z",
  closedAt: null,
  outcomeSummary: null,
  lastActivityAt: "2026-08-01T12:00:00.000Z",
};

const MESSAGES = [
  {
    id: "m-1",
    seq: 1,
    channelId: CHANNEL_ID,
    authorUserId: "u-2",
    authorKind: "user",
    kind: "message",
    body: "in the thread",
    metadata: { taskId: THREAD_ID },
    clientMsgId: null,
    createdAt: "2026-08-01T11:59:00.000Z",
    authorName: "Ada",
    authorAvatarUrl: null,
  },
  {
    id: "m-2",
    seq: 2,
    channelId: CHANNEL_ID,
    authorUserId: "u-1",
    authorKind: "user",
    kind: "message",
    body: "channel-level, not in the thread",
    metadata: {},
    clientMsgId: null,
    createdAt: "2026-08-01T12:00:00.000Z",
    authorName: "Sam",
    authorAvatarUrl: null,
  },
];

const MEMBERS = [
  {
    channelId: CHANNEL_ID,
    userId: "u-1",
    role: "owner",
    lastReadAt: null,
    notifyScope: "all",
    agentToolProfile: "full",
    agentOnline: true,
    lastSeenAt: "2026-08-01T12:00:00.000Z",
    addedBy: null,
    joinedAt: "2026-08-01T10:00:00.000Z",
    displayName: "Sam",
    email: "sam@example.com",
    avatarUrl: null,
  },
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let paths: string[];

beforeEach(() => {
  workspaceId = `ws-tw-${++workspaceSeq}`;
  paths = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = String(input);
      const path = url.split("?")[0];
      paths.push(path);
      if (path === "/api/boot") {
        return json({
          isOnboarded: true,
          surveyCompleted: true,
          userId: "u-1",
          workspace: { id: workspaceId, name: "Acme", slug: "acme", publicId: "ab12cd" },
          segment: SEGMENT,
          needsRedirect: false,
          role: "admin",
          myAccess: { defaultLevel: "edit", overrides: [] },
        });
      }
      if (path.endsWith("/messages")) return json({ messages: MESSAGES });
      if (path.endsWith("/members")) return json({ members: MEMBERS });
      if (path.endsWith("/tasks")) return json({ tasks: [{ ...THREAD, workspaceId }] });
      // The decision surfaces' channel-scoped consent read (2026-08-20).
      if (path === "/api/channels/consent") return json({ requests: [] });
      throw new Error(`unexpected request: ${url}`);
    })
  );
});

function renderWindow(threadId: string | null = THREAD_ID) {
  const router = createMemoryRouter(routes, {
    initialEntries: [
      `/${SEGMENT}/${THREAD_WINDOW_PATH}/${CHANNEL_ID}${
        threadId ? `?thread=${threadId}` : ""
      }`,
    ],
  });
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

describe("the thread window page", () => {
  it("resolves the workspace and shows the named thread", async () => {
    renderWindow();
    expect(await screen.findByText("in the thread")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ship the release" })).toBeInTheDocument();
    // The thread's rows, not the channel's.
    expect(screen.queryByText("channel-level, not in the thread")).not.toBeInTheDocument();
  });

  it("brings NO app shell with it — no nav, no channels tree, no info panel", async () => {
    const { container } = renderWindow();
    await screen.findByText("in the thread");

    // The app sidebar's nav links are the shell's tell.
    expect(screen.queryByRole("link", { name: "Knowledge" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    // The channels tree and the info panel are the page's.
    expect(screen.queryByLabelText("Channel info")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Inbox/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    // ONE floating page card in the window — the thread's.
    expect(container.querySelectorAll(".page-float")).toHaveLength(1);
  });

  it("issues only the reads ONE thread needs", async () => {
    renderWindow();
    await screen.findByText("in the thread");
    // No channel LIST, no mentions, no trust — those belong to surfaces this
    // window does not have. ⚠ The CONSENT read is here BY DESIGN since
    // 2026-08-20: this window is a decision surface (the awaiting strip and
    // the send box render in it), and its read is CHANNEL-SCOPED.
    expect(paths).not.toContain("/api/channels");
    expect(paths).toContain("/api/channels/consent");
    expect(paths.some((p) => p.endsWith("/mentions"))).toBe(false);
  });

  it("names the window after the thread", async () => {
    renderWindow();
    await screen.findByText("in the thread");
    expect(document.title).toBe("Dopl — Ship the release");
  });

  it("says so when the window was landed with no thread", async () => {
    renderWindow(null);
    expect(await screen.findByText("That thread isn't here")).toBeInTheDocument();
  });

  it("carries a composer, so the window can be replied from", async () => {
    renderWindow();
    await screen.findByText("in the thread");
    expect(
      within(document.body).getByPlaceholderText(/message|reply/i)
    ).toBeInTheDocument();
  });
});
