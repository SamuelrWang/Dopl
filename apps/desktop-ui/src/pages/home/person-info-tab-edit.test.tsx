import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts, BridgeResponse } from "#/lib/dopl-bridge";
import { installBridge, ok } from "#/test-utils/bridge";
import { EMPTY_INFO_CARD } from "@/features/channels/info-card";
import type { Channel } from "@/features/channels/types";
import type { HomeChannelsPayload } from "@/features/home/types";
import type { Role } from "@/features/workspaces/types";
import {
  CHANNEL,
  CHANNEL_ID,
  HOME,
  MEMBERS,
  THREADS,
  openChannelRecord,
  renderHome,
  routes,
} from "./home-test-harness";

/**
 * THE /home INFO TAB'S NAME AND DESCRIPTION EDIT IN PLACE (Samuel, 2026-09-17,
 * verbatim): *"On the right, the info tab: I want to be able to click where the
 * name and description are. I want to click that, and then I should be able to
 * edit the name and description of the channel."*
 *
 * ⚠ **THE SAME BEHAVIOUR THE WORKSPACE TAB TOOK ON 2026-09-16, NOT A SECOND ONE**
 * — one `InlineEditText`, one `use-channel-header-writes.ts`, one mirror of
 * `canManageChannel`, reached through `ChannelInfoTabContext.headerEdit`. The
 * workspace tab's own cases are `channels/components/info-tab.test.tsx`; what is
 * pinned HERE is the half that is /home's alone — the injected tab receives the
 * bundle, and the LEFT COLUMN's row re-titles, which is a second cache.
 *
 * ⚠ MOUNTED THROUGH `HomePage`, and the surface stub mints the REAL write
 * (`surface-slot-fixtures.tsx`): the PATCH, its optimistic patch of
 * `GET /api/channels` and the /home bridge that copies the name across all have to
 * run, or "the row re-titles" is a sentence about a handler nobody wired.
 *
 * ⚠ **THE STUB SERVER IS STATEFUL.** The write's own `invalidate` re-reads
 * `/api/channels`, so a stub that always answered with the shipped name would
 * repaint the OLD one a tick after every save — the exact regression this suite
 * exists to catch.
 */

const apiRequest = vi.hoisted(() => vi.fn());

// ⚠ ONE STUB, SHARED (`surface-slot-fixtures.tsx`), and the factory imports it
// itself because `vi.mock` is hoisted above every import.
vi.mock("@/features/channels/components/channel-surface-standalone", async () =>
  (await import("./surface-slot-fixtures")).standaloneSurfaceStub()
);

/** Every PATCH body this suite's channel received, in order. */
let patches: Record<string, unknown>[] = [];

/**
 * Serve the account surface with `channel` as the resolved row, and PERSIST
 * whatever the header PATCH sends.
 *
 * ⚠ `isDirect: false` IS THE ARGUMENT'S DEFAULT AND THE HARNESS'S IS `true` — a
 * home container minted before the 2026-08-24 channel-first inversion still
 * carries the flag, and the tab keeps the workspace tab's rule that only a STORED
 * name opens. The DM case below passes the harness fixture unchanged.
 *
 * ⚠ **`homeRole` IS THE SECOND HALF OF `canEdit` SINCE 2026-09-17 (F-343)** — the
 * caller's role in the CONTAINER, which /home now reads off `HomeChannel.role`
 * and hands the surface. The harness fixture is the container's OWNER, so a case
 * about a reader who may not manage this channel has to say which reader.
 */
function serve(over: Partial<Channel> = {}, homeRole: Role = "owner"): void {
  let channel: Channel = {
    ...CHANNEL,
    isDirect: false,
    infoCard: EMPTY_INFO_CARD,
    ...over,
  };
  const home: HomeChannelsPayload = {
    ...HOME,
    channels: HOME.channels.map((row) => ({ ...row, role: homeRole })),
  };
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}): Promise<BridgeResponse> => {
      const bare = path.split("?")[0];
      if (bare === "/api/home/channels") return Promise.resolve(ok(home));
      if (bare === "/api/channels") {
        return Promise.resolve(ok({ channels: [channel] }));
      }
      if (bare === `/api/channels/${CHANNEL_ID}/members`) {
        return Promise.resolve(ok(MEMBERS));
      }
      if (bare === `/api/channels/${CHANNEL_ID}/tasks`) {
        return Promise.resolve(ok(THREADS));
      }
      if (bare === `/api/channels/${CHANNEL_ID}` && opts.method === "PATCH") {
        const body = (opts.body ?? {}) as Record<string, unknown>;
        patches.push(body);
        channel = { ...channel, ...body };
        return Promise.resolve(ok({ channel }));
      }
      return (
        routes(path, opts) ?? Promise.reject(new Error(`unexpected: ${path}`))
      );
    }
  );
}

/** One Channel-info row's own box — `bits.tsx › MetaRow`. ⚠ SCOPED, because
 *  the roster at the foot of the tab says the peer's name too. */
function metaRow(label: string): HTMLElement {
  const card = screen.getByTestId("channel-surface");
  return within(card).getByText(label).closest("div")!;
}

/** The channel list on the left — the wells column, not the card. */
function listRow(name: string): HTMLElement {
  const recent = screen
    .getByRole("heading", { name: "Recent" })
    .closest("section")!;
  return within(recent).getByText(name);
}

beforeEach(() => {
  patches = [];
  apiRequest.mockReset();
  installBridge({ apiRequest });
});

describe("home info tab — the header lines open", () => {
  it("opens the Name line on a click and SAVES ON BLUR, one field", async () => {
    serve();
    renderHome();
    await openChannelRecord();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Channel name" }));
    const field = screen.getByRole("textbox", { name: "Channel name" });
    // ⚠ THE FIELD OPENS ON THE STORED VALUE, which on this pane is also what the
    // line was showing (`home-rows.ts › channelTitle`, `peerNamedHeader: false`).
    expect((field as HTMLInputElement).value).toBe("Priya Shah");
    fireEvent.change(field, { target: { value: "Q3 Fundraise" } });
    fireEvent.blur(field);

    // ⚠ ONE FIELD PER SAVE — an untouched description is never part of a name's
    // write (`use-channel-header-writes.ts › HeaderDraft`).
    await waitFor(() => expect(patches).toEqual([{ name: "Q3 Fundraise" }]));
  });

  it("re-titles the row in the LEFT COLUMN, which is a second cache", async () => {
    serve();
    renderHome();
    await openChannelRecord();
    expect(listRow("Priya Shah")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Channel name" }));
    const field = screen.getByRole("textbox", { name: "Channel name" });
    fireEvent.change(field, { target: { value: "Q3 Fundraise" } });
    fireEvent.blur(field);

    // 🔒 THE WHOLE REASON THE BRIDGE EXISTS: the write patches `GET /api/channels`
    // and this list is `GET /api/home/channels` — two payloads carrying one name
    // (`use-home-channel-sync.ts`, the pin's own two-cache gap).
    await waitFor(() => expect(listRow("Q3 Fundraise")).toBeTruthy());
  });

  it("writes NOTHING when the line is opened and left alone", async () => {
    serve();
    renderHome();
    await openChannelRecord();

    fireEvent.click(await screen.findByRole("button", { name: "Edit Channel name" }));
    fireEvent.blur(screen.getByRole("textbox", { name: "Channel name" }));

    // ⚠ A click that only passed THROUGH a line is not an edit, and the PATCH
    // would stamp `updated_at` — the channels list's sort key — reordering
    // somebody's column because they looked at a name.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit Channel name" })).toBeTruthy()
    );
    expect(patches).toEqual([]);
  });

  it("opens the Description on the EMPTY STRING, never on the word None", async () => {
    serve({ topic: "" });
    renderHome();
    await openChannelRecord();

    // "None" is the empty face AND the click target (minimal copy, §5).
    expect(await screen.findByText("None")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Channel description" })
    );
    const field = screen.getByRole("textbox", { name: "Channel description" });
    expect((field as HTMLInputElement).value).toBe("");
    fireEvent.change(field, { target: { value: "Everything about the raise" } });
    fireEvent.blur(field);

    await waitFor(() =>
      expect(patches).toEqual([{ topic: "Everything about the raise" }])
    );
  });
});

describe("home info tab — who may open them", () => {
  it("keeps BOTH lines display-only on a channel that is still `is_direct`", async () => {
    // ⚠ THE HARNESS FIXTURE, UNCHANGED — every home container minted before the
    // channel-first inversion carries this flag, and the rule is the workspace
    // tab's: only a STORED name opens (`info-tab.tsx › headerEditable`).
    serve({ isDirect: true });
    renderHome();
    await openChannelRecord();

    await screen.findByText("Description");
    expect(screen.queryByRole("button", { name: "Edit Channel name" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit Channel description" })
    ).toBeNull();
    // ⚠ AND THE LINES ARE STILL THERE — they are the room's label, they simply
    // do not open.
    expect(within(metaRow("Name")).getByText("Priya Shah")).toBeTruthy();
    expect(within(metaRow("Description")).getByText("None")).toBeTruthy();
  });

  it("keeps them display-only for a member who may not manage the channel", async () => {
    // ⚠ THE MIRROR OF `service-shared.ts › canManageChannel`, WHICH IS A PAIR:
    // channel OWNER **or** workspace ADMIN+. So the non-manager's face needs BOTH
    // halves false — a channel `member` who is also a plain `member` of the
    // container. ⚠ **THE SECOND HALF WAS A CONSTANT UNTIL 2026-09-17 (F-343)**:
    // /home passed no role at all, the surface defaulted to `"member"`, and this
    // case passed for a reader whose real rank nobody had read. It now states it.
    serve({ role: "member" }, "member");
    renderHome();
    await openChannelRecord();

    await screen.findByText("Description");
    expect(screen.queryByRole("button", { name: "Edit Channel name" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit Channel description" })
    ).toBeNull();
    expect(within(metaRow("Name")).getByText("Priya Shah")).toBeTruthy();
  });
});
