import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ConsentCard,
  RequestFolderRow,
  RequestFolderRowView,
} from "./consent-card";
import { RequestPermissionRow } from "./permission-preset-row";
import { getDesktopChannelFolders } from "@/shared/lib/desktop";
import type { ChannelConsentRequest } from "../types";

const CHANNEL_ID = "44444444-4444-4444-8444-444444444444";
const ME = "u-me";
const FOLDER = "~/Downloads/repo";

function request(over: Partial<ChannelConsentRequest> = {}): ChannelConsentRequest {
  return {
    id: "cr1",
    channelId: CHANNEL_ID,
    workspaceId: "w1",
    operatorUserId: ME,
    requesterUserId: "u-ada",
    kind: "inbound",
    messageSeq: 1,
    summary: "Run the migration check",
    bodyPreview: "Please run the migration check.",
    proposedReply: null,
    status: "pending",
    decidedBy: null,
    decidedAt: null,
    createdAt: "2026-07-28T00:06:00.000Z",
    expiresAt: null,
    requesterName: "Ada",
    requesterAvatarUrl: null,
    ...over,
  };
}

const noop = () => {};

function card(over: Partial<ChannelConsentRequest> = {}) {
  return (
    <ConsentCard
      request={request(over)}
      onAllow={noop}
      onDeny={noop}
    />
  );
}

/** The card's OUTPUT tree (ConsentCard is a pure function of its props), so a
 *  test can assert which children it composes without mounting a DOM. */
function cardTree(over: Partial<ChannelConsentRequest> = {}): ReactNode {
  return ConsentCard({
    request: request(over),
    onAllow: noop,
    onDeny: noop,
  });
}

/** True when the rendered element tree contains an element of `type`. Lets the
 *  suite assert WHICH card mounts the (bridge-gated) folder row without a DOM. */
function containsType(node: ReactNode, type: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some((child) => containsType(child as ReactNode, type));
  }
  if (!isValidElement(node)) return false;
  if (node.type === type) return true;
  const { children } = node.props as { children?: ReactNode };
  return containsType(children, type);
}

// Tests that define `window` clean it up, so the render tests see the true
// "no bridge on the server / in a plain browser" state.
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.restoreAllMocks();
});

describe("getDesktopChannelFolders gate (the folder row's visibility source)", () => {
  it("returns the bridge only when window.dopl.channels.chooseFolder is a function", () => {
    (globalThis as { window?: unknown }).window = {
      dopl: { channels: { chooseFolder: vi.fn() } },
    };
    expect(getDesktopChannelFolders()).not.toBeNull();
  });

  it("returns null in a plain browser (no window.dopl)", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(getDesktopChannelFolders()).toBeNull();
  });

  it("returns null on an older desktop build (marker but no folder API)", () => {
    (globalThis as { window?: unknown }).window = { dopl: { isDesktop: true } };
    expect(getDesktopChannelFolders()).toBeNull();
  });
});

describe("the request card's folder pill", () => {
  it("names the folder the desktop bridge reports, as a clickable pill", async () => {
    (globalThis as { window?: unknown }).window = {
      dopl: {
        channels: {
          getFolderLabel: vi.fn().mockResolvedValue(FOLDER),
          chooseFolder: vi.fn().mockResolvedValue("~/code/app"),
          clearFolder: vi.fn().mockResolvedValue(null),
        },
      },
    };
    const bridge = getDesktopChannelFolders();
    if (!bridge) throw new Error("expected the mocked desktop folder bridge");
    const markup = renderToStaticMarkup(
      <RequestFolderRowView
        label={await bridge.getFolderLabel(CHANNEL_ID)}
        busy={false}
        onChange={noop}
      />
    );
    expect(markup).toContain(FOLDER);
    // The PILL recipe (kit: rounded-full + border-border-strong + bg-bg-inset) and
    // no separate "Change" link — the whole pill is the affordance.
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("border-border-strong");
    expect(markup).not.toContain("Change the folder this request runs in</");
    expect(markup).toContain('aria-label="Change the folder this request runs in"');
  });

  it("says Default folder when the channel uses the desktop default", () => {
    const markup = renderToStaticMarkup(
      <RequestFolderRowView label={null} busy={false} onChange={noop} />
    );
    expect(markup).toContain("Default folder");
  });

  it("disables the affordance while the native picker is open", () => {
    const markup = renderToStaticMarkup(
      <RequestFolderRowView label={FOLDER} busy onChange={noop} />
    );
    expect(markup).toContain("disabled");
    expect(markup).toContain("Opening picker…");
  });

  it("renders nothing at all without the desktop bridge (no dead control)", () => {
    const markup = renderToStaticMarkup(
      <RequestFolderRow channelId={CHANNEL_ID} />
    );
    expect(markup).toBe("");
  });
});

describe("ConsentCard folder-row wiring", () => {
  it("mounts the folder row on an inbound approval", () => {
    expect(containsType(cardTree(), RequestFolderRow)).toBe(true);
  });

  it("never mounts it on an outbound review (nothing spawns locally)", () => {
    const outbound = cardTree({
      kind: "outbound",
      requesterUserId: null,
      requesterName: null,
      proposedReply: "Here is the draft.",
    });
    expect(containsType(outbound, RequestFolderRow)).toBe(false);
  });

  it("shows no folder line in a plain browser, inbound included", () => {
    // The row is feature-detected after mount, so it is absent from the
    // server / first-paint markup and forever absent in a plain browser.
    const markup = renderToStaticMarkup(card());
    expect(markup).not.toContain("Default folder");
    // Same for the permission dropdowns — desktop-only, no dead controls.
    expect(markup).not.toContain("aria-haspopup");
    // The rest of the inbound card is untouched.
    expect(markup).toContain("border-warning/25");
    expect(markup).toContain("Allow");
    // The tool-scope sentence was removed from this card by product decision; the
    // machine-side warning stays.
    expect(markup).toContain("Allowing runs a Claude session on this machine.");
    expect(markup).not.toContain("tool scope for this channel");
  });
});

describe("ConsentCard permission-preset wiring", () => {
  it("mounts the two permission dropdowns on an inbound approval", () => {
    // The posture must be settable BEFORE Allow — that is the whole point of
    // putting it on the card rather than in the session window.
    expect(containsType(cardTree(), RequestPermissionRow)).toBe(true);
  });

  it("never mounts them on an outbound review (nothing spawns locally)", () => {
    const outbound = cardTree({
      kind: "outbound",
      requesterUserId: null,
      requesterName: null,
      proposedReply: "Here is the draft.",
    });
    expect(containsType(outbound, RequestPermissionRow)).toBe(false);
  });

  it("sits alongside the folder pill, in the same settings row", () => {
    const tree = cardTree();
    expect(containsType(tree, RequestFolderRow)).toBe(true);
    expect(containsType(tree, RequestPermissionRow)).toBe(true);
  });
});
