// @vitest-environment jsdom
/**
 * The guest mount — what it hands the shared surface, and the two endings it
 * has to render instead of it.
 *
 * ⚠ THE LOAD-BEARING ASSERTION IS AN ABSENCE: no `role` prop (ruling R4). The
 * claimer really is a workspace `admin`, so passing the true role through would
 * hand a guest rename/archive/mint affordances the server would honour. The
 * surface's own least-privileged default is the narrowing, and a "tidy-up" that
 * threads the role in would restore them with no error anywhere.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { HomeChannel } from "@/features/home/types";

const mocks = vi.hoisted(() => ({
  useChannels: vi.fn(),
  surfaceProps: null as Record<string, unknown> | null,
}));

vi.mock("@/features/channels/hooks/use-channels", () => ({
  useChannels: mocks.useChannels,
}));
// The real surface would open a realtime subscription and need a query client;
// the stub records what the mount decided, which is the whole subject here.
vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: (props: Record<string, unknown>) => {
      mocks.surfaceProps = props;
      return <div data-testid="surface" />;
    },
  })
);

import { GuestChannel } from "./guest-channel";

const WS = "33333333-3333-4333-8333-333333333333";
const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";
const USER = "11111111-1111-4111-8111-111111111111";

const HOME_CHANNEL: HomeChannel = {
  workspaceId: WS,
  workspaceSegment: "ada-grace-abc123def456",
  channelId: CHANNEL_ID,
  name: "Ada & Grace",
  peers: [],
  peer: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  lastMessageAt: null,
  lastMessagePreview: null,
  linkOut: null,
};

const ROW = { id: CHANNEL_ID, name: "Ada & Grace" };

function answer(over: Record<string, unknown> = {}) {
  mocks.useChannels.mockReturnValue({
    channels: [ROW],
    loading: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.surfaceProps = null;
  answer();
});

afterEach(cleanup);

/** `next/dynamic` resolves on a microtask — the surface is never in the FIRST paint. */
async function mount() {
  render(<GuestChannel homeChannel={HOME_CHANNEL} currentUserId={USER} />);
  return screen.findByTestId("surface");
}

describe("the mount", () => {
  it("addresses the CONTAINER and pins the surface to the row it names", async () => {
    await mount();
    expect(mocks.useChannels).toHaveBeenCalledWith(WS, false);
    expect(mocks.surfaceProps).toMatchObject({
      workspaceId: WS,
      workspaceSlug: "ada-grace-abc123def456",
      channel: ROW,
      currentUserId: USER,
    });
  });

  /**
   * ⚠ EVERY FLAG, ASSERTED WHOLE — `toEqual`, never `toMatchObject`. A partial
   * match stays green when a flag is DROPPED from the object, which is the
   * regression itself: the control comes back on the guest's surface and
   * nothing anywhere errors. `memberManagement` is the container's fixed
   * two-person roster; `selfManagement` is rulings R2/R3 (2026-08-25) — a guest
   * runs no agent, and leaving is a one-way exit from their only Dopl surface.
   *
   * ⚠ `knowledge: true` STOOD HERE FROM M4 (2026-08-26) AND IS GONE (Samuel,
   * 2026-09-04). It drew the Knowledge tab — the bases the operator granted INTO
   * this channel — and the argument for it was that this tab is a guest's only
   * way to read one. The web channel page's ruling overrides that in as many
   * words: *"There should be no Knowledge tab at all for the web: just Info,
   * Threads, and Agents."* ⚠ THE LANE IS UNTOUCHED and still guest-floored
   * (`channels-v2/guest-surface-reads.test.tsx` pins it against the routes
   * themselves); what is gone is the FACE. This assertion is where the guest's
   * whole capability posture is stated in one place, so an ADDITION lands here
   * as loudly as a removal — including a re-addition of that flag.
   */
  it("states the guest's whole capability posture — two off, nothing on", async () => {
    await mount();
    expect(mocks.surfaceProps?.capabilities).toEqual({
      memberManagement: false,
      selfManagement: false,
    });
  });

  /**
   * 🔒 **THE ONE-COLUMN LAYOUT IS THE HOST'S DECISION (Samuel, 2026-09-04).** The
   * surface renders two columns without it, which is the desktop app's shape and
   * the wrong one on a phone. ⚠ The STATE is asserted here, not the rendering:
   * this page is the only place that owns it, and a host that stopped passing it
   * would ship the slide-out pane back to the web with nothing failing.
   */
  it("hands the surface the web's view state — one column, faces in the URL", async () => {
    await mount();
    const webView = mocks.surfaceProps?.webView as
      | { view: string; setView: unknown }
      | undefined;
    expect(webView?.view).toBe("channel");
    expect(typeof webView?.setView).toBe("function");
  });

  it("passes NO `role` — the least-privilege default is the narrowing", async () => {
    await mount();
    expect(mocks.surfaceProps).not.toBeNull();
    expect(Object.keys(mocks.surfaceProps ?? {})).not.toContain("role");
  });

  it("supplies its own bounded height and its own paint, not the shell's", async () => {
    // ⚠ `/c` is absent from `layout-shell.tsx › NON_WORKSPACE_ROOTS`, so the body
    // is painted the app rail's dark colour and nothing above supplies a height.
    const { container } = render(
      <GuestChannel homeChannel={HOME_CHANNEL} currentUserId={USER} />
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain("h-[100dvh]");
    expect(root?.className).toContain("bg-bg-elevated");
  });
});

describe("the endings", () => {
  it("renders a skeleton, never the surface, while the row is unresolved", () => {
    answer({ channels: [], loading: true });
    render(<GuestChannel homeChannel={HOME_CHANNEL} currentUserId={USER} />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByTestId("surface")).toBeNull();
  });

  it("says the channel is GONE when the row never resolves", async () => {
    answer({ channels: [] });
    render(<GuestChannel homeChannel={HOME_CHANNEL} currentUserId={USER} />);
    expect(
      await screen.findByText("This channel no longer exists")
    ).toBeTruthy();
    // ⚠ An ENDING, not a detour: a guest has no other Dopl surface to be sent
    // to, so the panel offers no navigation at all.
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("distinguishes a failed LOAD from a deleted channel, and offers the retry", () => {
    answer({ channels: [], error: "boom" });
    render(<GuestChannel homeChannel={HOME_CHANNEL} currentUserId={USER} />);
    expect(screen.getByText("This channel would not load")).toBeTruthy();
    expect(screen.queryByText("This channel no longer exists")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});
