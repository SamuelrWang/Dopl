import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClient } from "#/lib/query-client";
import ChannelsPage from "#/pages/channels";
import { SEGMENT } from "#/test-utils/bridge";

/**
 * Channels page smoke test, AFTER THE CUTOVER (wiring plan Phase 12,
 * 2026-08-18). This file used to mount the two-pane `ChannelsViewCore`; that
 * tree is deleted and `/:workspaceSegment/channels` now mounts the three-column
 * surface (`components/channels-v2/channels-v2-core.tsx`) that lived behind a
 * temporary `channels-v2` route until the rename.
 *
 * What is pinned here is the SEAM, not the surface — every column has its own
 * suite next to the component:
 *
 *  - the page resolves the workspace once and every live surface issues its OWN
 *    initial fetch, which is what keeps first paint correct with the realtime
 *    doorbell silent;
 *  - the `:channelId` route selects that channel (the desktop notification's
 *    landing route — `main/shell-mode.js › CHANNELS_PAGE` builds it);
 *  - **there is no consent INBOX** (Samuel, 2026-08-25): row, badge and takeover
 *    deleted, the review moved to the work stream's card, and the draft stays
 *    decidable from the THREAD. The WRITE is unchanged through all of it — the
 *    same `PATCH /consent/[id]` with the same `"allow"`.
 *  - the channel-management controls the cutover carried over are REACHABLE.
 *    They were the old header's, and orphaning them was the demolition's one
 *    real risk.
 *
 * `fetch` is the mock point — the seam both clients share (SPA's `#/lib/api`
 * and `@/shared/api/api-client`, which the channels feature client calls
 * directly for every mutation).
 *
 * ⚠ Supabase stubbed at the browser-client module: jsdom has no `window.dopl`,
 * so the realtime registry does NOT take its SPA short-circuit and would reach
 * for a Supabase config the renderer has none of. Stub keeps the subscriptions
 * wiring for real without a websocket. Assertions deliberately do NOT depend on
 * a realtime event — every surface loads from its own fetch.
 */

vi.mock("@/shared/supabase/browser", () => {
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  return {
    getSupabaseBrowser: () => ({
      channel: () => channel,
      removeChannel: () => {},
      // `CreateChannelDialog` mounts `useAuthUserState`, which falls through to
      // the Supabase client without a `window.dopl` bridge (jsdom).
      auth: {
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
    }),
  };
});

import {
  CHANNEL_ID,
  CONSENT,
  MEMBERS,
  MESSAGES,
  OTHER,
  OTHER_ID,
  THREAD,
  THREAD_ID,
  baseChannel,
} from "./channels-test-fixtures";

/** ⚠ Fresh per test: realtime registry shares one channel per workspace id
 *  across mounts (module singleton + teardown grace window), so a reused id
 *  hands the second test the first test's already-connected entry. */
let workspaceId = "";
let workspaceSeq = 0;

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let calls: FetchCall[];
/** Flipped by the consent PATCH so the follow-up inbox read comes back empty,
 *  as the real service does (`pending` rows only). */
let consentDecided = false;

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  workspaceId = `ws-${++workspaceSeq}`;
  calls = [];
  consentDecided = false;
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const path = url.split("?")[0];
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    // ONE read for workspace + role + caller id; `resolve` and `me` seeded
    // from it, so the page never waits on them in series.
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
    if (path === `/api/workspaces/${SEGMENT}/members`) return json({ members: [] });
    if (path === "/api/channels") {
      return json({
        channels: [
          { ...baseChannel, workspaceId },
          { ...OTHER, workspaceId },
        ],
      });
    }
    const channelId = /^\/api\/channels\/(ch-\d)\//.exec(path)?.[1];
    if (channelId && path.endsWith("/messages")) {
      return json({ messages: channelId === CHANNEL_ID ? MESSAGES : [] });
    }
    if (channelId && path.endsWith("/members")) {
      return json({ members: channelId === CHANNEL_ID ? MEMBERS : [] });
    }
    if (channelId && path.endsWith("/tasks")) {
      return json({ tasks: channelId === CHANNEL_ID ? [THREAD] : [] });
    }
    if (channelId && path.endsWith("/mentions")) return json({ mentions: [] });
    if (path === "/api/channels/consent") {
      return json({
        requests: consentDecided ? [] : [{ ...CONSENT, workspaceId }],
      });
    }
    if (path === "/api/channels/consent/cr-1" && method === "PATCH") {
      consentDecided = true;
      return json({
        request: { ...CONSENT, workspaceId, status: "allowed", decidedBy: "web" },
      });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

/** Both rows are the SAME page component; `channelId` is what differs — and,
 *  since wiring plan Phase 10, an optional `?thread=` SELECTION on the second one. */
function renderPage(channelId?: string, threadId?: string) {
  const router = createMemoryRouter(
    [
      { path: "/:workspaceSegment/channels", element: <ChannelsPage /> },
      { path: "/:workspaceSegment/channels/:channelId", element: <ChannelsPage /> },
    ],
    {
      initialEntries: [
        channelId
          ? `/${SEGMENT}/channels/${channelId}${threadId ? `?thread=${threadId}` : ""}`
          : `/${SEGMENT}/channels`,
      ],
    }
  );
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

const requestsTo = (path: string, method = "GET") =>
  calls.filter((c) => c.url.split("?")[0] === path && c.method === method);

describe("channels page", () => {
  it("resolves the workspace, then loads the tree and the transcript", async () => {
    renderPage();

    expect(
      await screen.findByText("Picked it up, wiring the client queries now.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Can your agent take the channels port?")
    ).toBeInTheDocument();

    expect(requestsTo("/api/boot", "POST")[0].body).toEqual({ segment: SEGMENT });
    expect(requestsTo("/api/workspaces/me")).toHaveLength(0);

    // ⚠ Every live surface needs its OWN initial fetch: that is what keeps the
    // page correct on first paint with the realtime doorbell silent.
    for (const path of [
      "/api/channels",
      `/api/channels/${CHANNEL_ID}/messages`,
      `/api/channels/${CHANNEL_ID}/members`,
      `/api/channels/${CHANNEL_ID}/tasks`,
      `/api/channels/${CHANNEL_ID}/mentions`,
      "/api/channels/consent",
    ]) {
      expect(requestsTo(path).length).toBeGreaterThan(0);
      expect(requestsTo(path)[0].headers["x-workspace-id"]).toBe(workspaceId);
    }

    // ⚠ `/api/channels/trust` IS NEVER READ BY ANYTHING ANY MORE (2026-08-22): the
    // ROUTE and its hook are deleted with the trust roster they fed. The
    // assertion stays as the cheap catch for a reintroduced read that would 404.
    expect(requestsTo("/api/channels/trust")).toHaveLength(0);
  });

  it("opens the channel the ROUTE names, not the first row", async () => {
    // THE DESKTOP NOTIFICATION'S LANDING ROUTE (wiring plan Phase 9, renamed
    // off `channels-v2` at the cutover). The page reads the param and hands it
    // down; the shared tree is router-free and takes it as a plain prop.
    renderPage(OTHER_ID);

    await waitFor(() =>
      expect(requestsTo(`/api/channels/${OTHER_ID}/messages`).length).toBeGreaterThan(0)
    );
    expect(requestsTo(`/api/channels/${CHANNEL_ID}/messages`)).toHaveLength(0);
  });

  it("opens the THREAD the query names — the pop-out window's landing", async () => {
    // ⚠ NOT A ROUTE (wiring plan Phase 10, 2026-08-18). Main opens the pop-out on
    // `/{segment}/channels/{channelId}?thread={threadId}` — the SAME `:channelId` row
    // above, with no new `routes.tsx` entry and no deep-link grammar change, because a
    // thread is not a page: it is which transcript this page has open. The page reads the
    // search param and hands it down as a plain prop, exactly as it does the channel.
    renderPage(CHANNEL_ID, THREAD_ID);

    // The thread view replaces the channel's own rows: the crumb becomes
    // `# channel / title` and the channel crumb is THE WAY BACK (a button).
    const crumb = await screen.findByLabelText("Breadcrumb");
    await waitFor(() =>
      expect(within(crumb).getByRole("button", { name: "migration" })).toBeInTheDocument()
    );
    expect(within(crumb).getByText("Ship the release")).toBeInTheDocument();
  });

  it("lands on the CHANNEL view when the query names no thread", async () => {
    renderPage(CHANNEL_ID);
    await screen.findByText("Picked it up, wiring the client queries now.");
    // No crumb trail: the channel name is plain text, with nothing to go back to.
    const crumb = screen.getByLabelText("Breadcrumb");
    expect(within(crumb).queryByRole("button")).not.toBeInTheDocument();
    expect(within(crumb).getByText("migration")).toBeInTheDocument();
  });

  /**
   * THE SURVIVING DECISION END TO END, and the RETIRED ones pinned as ABSENCES
   * (2026-08-22's inbound retirement, and 2026-08-25's Inbox deletion).
   *
   * ⚠ THE ABSENCES ARE WHY THIS TEST IS STILL HERE: each retired surface was
   * optional-prop shaped, so re-adding one would compile and render.
   */
  it("decides an OUTBOUND draft, and offers no inbound decision anywhere", async () => {
    renderPage();
    await screen.findByText("Picked it up, wiring the client queries now.");

    // ⚠ NOTHING ON THE TRANSCRIPT ASKS FOR AN ANSWER: the card's inline pair and
    // the thread strip are deleted, "Requested" has no derivation left, and a
    // Decline exists on no surface. ⚠ AND NO INBOX EITHER — row, badge and
    // takeover deleted; the review is `agent-stream.tsx › SentToChannelBox`.
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByText("Requested")).toBeNull();
    expect(screen.queryByText(/awaiting your answer/i)).toBeNull();
    expect(screen.queryByText(/'s agent is asking/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Inbox/ })).toBeNull();

    // The GATE and the WRITE are untouched — the draft is still decidable from
    // its THREAD, over the same CAS'd route. ⚠ SCOPED TO THE SEND BOX: the
    // composer has a Send of its own, and a page-wide query would find it.
    cleanup();
    renderPage(CHANNEL_ID, THREAD_ID);
    const heading = await screen.findByText("Your agent wants to reply");
    const box = heading.parentElement!.parentElement!;
    expect(screen.queryByRole("button", { name: "Decline" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Launch agent" })).toBeNull();

    fireEvent.click(within(box).getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(requestsTo("/api/channels/consent/cr-1", "PATCH")).toHaveLength(1)
    );
    const patch = requestsTo("/api/channels/consent/cr-1", "PATCH")[0];
    expect(patch.body).toEqual({ decision: "allow" });
    expect(patch.headers["x-workspace-id"]).toBe(workspaceId);

    // The read holds only `pending` rows, so a decided one leaves the surface.
    await waitFor(() =>
      expect(screen.queryByText("Your agent wants to reply")).not.toBeInTheDocument()
    );
  });

  it("keeps the channel-management surface reachable after the demolition", async () => {
    // The cutover deleted the page that owned these entry points. Every one of
    // them was on the old header or its list pane, and the plan's KEEP list
    // names them — an unreachable dialog is a deleted feature with a file still
    // in the tree, which `npx knip` would not even flag.
    //
    // ⚠ THEY MOVED AGAIN ON 2026-08-19, WHICH IS WHY THIS TEST OPENS A TAB. The
    // pane header now carries the info toggle and nothing else; the cluster is
    // the right panel's SETTINGS tab, where the Links empty state used to be.
    // The sidebar's two `+` entries did NOT move.
    renderPage();

    await screen.findByText("Picked it up, wiring the client queries now.");
    expect(screen.getByRole("button", { name: "Add channel" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New direct message" })
    ).toBeInTheDocument();

    // Nothing channel-scoped is on the header any more — not even mounted.
    expect(screen.queryByRole("radiogroup", { name: "Tools" })).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));

    // ⚠ THE PER-CHANNEL SETTINGS ARE THE TAB ITSELF NOW (2026-08-19, second
    // ruling the same day): the popover behind "Channel settings" was DELETED
    // and its controls are inline, so the entry point to look for is the
    // control, not a button that opens one. The kebab's four items are rows.
    // ⚠ `findBy`: the body crossfades (2026-08-24) — tab flips now, contents a fade later.
    expect(await screen.findByRole("radiogroup", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add members" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make public" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete channel" })).toBeInTheDocument();

    // ⚠ THE TAB NO LONGER OPENS A READ OF ITS OWN (2026-08-22). It used to fire
    // `useTrustRules` on mount, and this asserted the read ARRIVED WITH the tab
    // rather than with the page. Trust is deleted with the inbound consent lane,
    // so the honest assertion is the mirror image: opening the tab reaches the
    // controls and still asks the server for nothing extra.
    expect(requestsTo("/api/channels/trust")).toHaveLength(0);
  });

  it("has no Links tab left to render an empty state into", async () => {
    // It was a deliberate empty state ("No links in this channel yet.") holding
    // the slot Settings took. Nothing was rehomed out of it — there was nothing
    // in it — and where a channel's files and links land is still open.
    renderPage();

    await screen.findByText("Picked it up, wiring the client queries now.");
    expect(screen.queryByRole("tab", { name: "Links" })).toBeNull();
    expect(screen.queryByText("No links in this channel yet.")).toBeNull();
  });
});
