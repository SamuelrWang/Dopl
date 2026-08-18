// @vitest-environment jsdom
/**
 * The launch panel — what replaced `consent-card.tsx` in wiring plan Phase 8.
 *
 * The folder-row and permission-preset assertions below are PORTED from
 * `consent-card.test.tsx`, which went out with the card: the controls did not
 * change, only the surface that composes them, and the properties they pin
 * (desktop-gated, no dead controls, never on an outbound review) are the same
 * properties.
 *
 * What is new here is the launch VERB, the two-click disclosure, and the arm's
 * heading — the one piece of copy INVARIANTS §11 states as a rule.
 *
 * ⚠ jsdom, not `renderToStaticMarkup`: the panel holds expansion state and
 * feature-detects both bridges after mount, so a static call would render the
 * pre-mount frame forever and assert nothing about the flow.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LaunchPanel, LAUNCH_SETTINGS_HEADING } from "./launch-panel";
import { RequestFolderRow, RequestFolderRowView } from "./request-folder-row";
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

/** Both desktop bridges, at the shape each hook feature-detects on. */
function mountDesktopBridges() {
  (window as unknown as { dopl?: unknown }).dopl = {
    channels: {
      getFolderLabel: vi.fn().mockResolvedValue(FOLDER),
      chooseFolder: vi.fn().mockResolvedValue("~/code/app"),
      clearFolder: vi.fn().mockResolvedValue(null),
      getPermissionPreset: vi.fn().mockResolvedValue(null),
      setPermissionPreset: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

function panel(
  over: Partial<ChannelConsentRequest> = {},
  handlers: Partial<{ onLaunch: () => void; onDecline: () => void; busy: boolean }> = {}
) {
  return render(
    <LaunchPanel
      request={request(over)}
      onLaunch={handlers.onLaunch ?? noop}
      onDecline={handlers.onDecline ?? noop}
      busy={handlers.busy}
    />
  );
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { dopl?: unknown }).dopl;
  vi.restoreAllMocks();
});

describe("getDesktopChannelFolders gate (the folder row's visibility source)", () => {
  it("returns the bridge only when window.dopl.channels.chooseFolder is a function", () => {
    (window as unknown as { dopl?: unknown }).dopl = {
      channels: { chooseFolder: vi.fn() },
    };
    expect(getDesktopChannelFolders()).not.toBeNull();
  });

  it("returns null in a plain browser (no window.dopl)", () => {
    expect(getDesktopChannelFolders()).toBeNull();
  });

  it("returns null on an older desktop build (marker but no folder API)", () => {
    (window as unknown as { dopl?: unknown }).dopl = { isDesktop: true };
    expect(getDesktopChannelFolders()).toBeNull();
  });
});

describe("the request card's folder pill", () => {
  it("names the folder the desktop bridge reports, as a clickable pill", () => {
    const { container } = render(
      <RequestFolderRowView label={FOLDER} busy={false} onChange={noop} />
    );
    const markup = container.innerHTML;
    expect(markup).toContain(FOLDER);
    // The PILL recipe (kit: rounded-full + border-border-strong + bg-bg-inset) and
    // no separate "Change" link — the whole pill is the affordance.
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("border-border-strong");
    expect(screen.getByRole("button", { name: "Change the folder this request runs in" }))
      .not.toBeNull();
  });

  it("says Default folder when the channel uses the desktop default", () => {
    render(<RequestFolderRowView label={null} busy={false} onChange={noop} />);
    expect(screen.getByText("Default folder")).not.toBeNull();
  });

  it("disables the affordance while the native picker is open", () => {
    render(<RequestFolderRowView label={FOLDER} busy onChange={noop} />);
    const button = screen.getByRole("button", {
      name: "Change the folder this request runs in",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Opening picker…")).not.toBeNull();
  });

  it("renders nothing at all without the desktop bridge (no dead control)", () => {
    const { container } = render(<RequestFolderRow channelId={CHANNEL_ID} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("LaunchPanel — the verb", () => {
  it("says Launch agent, never Allow or Approve", () => {
    const { container } = panel();
    expect(screen.getByRole("button", { name: /Launch agent/ })).not.toBeNull();
    expect(container.textContent).not.toContain("Allow");
    expect(container.textContent).not.toContain("Approve");
  });

  it("keeps the amber container and states what a launch does", () => {
    const { container } = panel();
    expect(container.innerHTML).toContain("border-warning/25");
    expect(container.innerHTML).toContain("bg-warning/10");
    expect(container.textContent).toContain(
      "Launching runs a Claude session on this machine."
    );
    // The tool-scope sentence was removed from this surface by product decision
    // (2026-07-31) and did not come back with the redesign.
    expect(container.textContent).not.toContain("tool scope for this channel");
  });

  it("keeps Decline available beside it", () => {
    const onDecline = vi.fn();
    panel({}, { onDecline });
    fireEvent.click(screen.getByRole("button", { name: /Decline/ }));
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("disables both decisions while a write is in flight", () => {
    panel({}, { busy: true });
    expect(
      (screen.getByRole("button", { name: /Launch agent/ }) as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: /Decline/ }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("reads Send / Cancel on an outbound review (nothing launches locally)", () => {
    panel({
      kind: "outbound",
      requesterUserId: null,
      requesterName: null,
      proposedReply: "Here is the draft.",
    });
    expect(screen.getByRole("button", { name: /Send/ })).not.toBeNull();
    expect(screen.getByRole("button", { name: /Cancel/ })).not.toBeNull();
  });
});

describe("LaunchPanel — the settings expand", () => {
  it("expands into the two permission axes and the working folder on the first click", async () => {
    mountDesktopBridges();
    const onLaunch = vi.fn();
    panel({}, { onLaunch });

    const launch = screen.getByRole("button", { name: /Launch agent/ });
    // Before the click the region is collapsed, and the click that opens it is
    // NOT the decision.
    expect(launch.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(launch);
    expect(onLaunch).not.toHaveBeenCalled();
    expect(launch.getAttribute("aria-expanded")).toBe("true");

    // The two REUSED axes, by their own aria labels, plus the folder pill.
    expect(
      await screen.findByRole("button", { name: "What this thread's agent may do" })
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Which messages cross without asking" })
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Change the folder this request runs in" })
    ).not.toBeNull();
  });

  it("launches on the second click, with the settings on screen", () => {
    mountDesktopBridges();
    const onLaunch = vi.fn();
    panel({}, { onLaunch });
    const launch = screen.getByRole("button", { name: /Launch agent/ });
    fireEvent.click(launch);
    fireEvent.click(launch);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });

  it("heads the arm 'For the next request you allow', never 'this channel'", async () => {
    mountDesktopBridges();
    const { container } = panel();
    fireEvent.click(screen.getByRole("button", { name: /Launch agent/ }));
    expect(await screen.findByText(LAUNCH_SETTINGS_HEADING)).not.toBeNull();
    // ⚠ INVARIANTS §11: the preset is an ARM, not a stored preference. A panel
    // called "launch settings" must never say it applies to the channel.
    expect(LAUNCH_SETTINGS_HEADING).toBe("For the next request you allow");
    expect(container.textContent).not.toContain("this channel");
    expect(container.textContent).not.toContain("Always");
  });

  it("never offers the settings on an outbound review, bridges or not", () => {
    mountDesktopBridges();
    panel({
      kind: "outbound",
      requesterUserId: null,
      requesterName: null,
      proposedReply: "Here is the draft.",
    });
    const send = screen.getByRole("button", { name: /Send/ });
    expect(send.getAttribute("aria-expanded")).toBeNull();
    fireEvent.click(send);
    expect(screen.queryByText(LAUNCH_SETTINGS_HEADING)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Change the folder this request runs in" })
    ).toBeNull();
  });

  it("shows no settings and decides on the FIRST click in a plain browser", () => {
    // No bridge = no controls at all, so a disclosure would open onto nothing.
    const onLaunch = vi.fn();
    const { container } = panel({}, { onLaunch });
    const launch = screen.getByRole("button", { name: /Launch agent/ });
    expect(launch.getAttribute("aria-expanded")).toBeNull();
    expect(container.textContent).not.toContain(LAUNCH_SETTINGS_HEADING);
    expect(container.textContent).not.toContain("Default folder");
    expect(container.innerHTML).not.toContain("aria-haspopup");
    fireEvent.click(launch);
    expect(onLaunch).toHaveBeenCalledTimes(1);
  });
});

describe("LaunchPanel — the trust seam stays empty", () => {
  it("renders no auto-launch / trust affordance of any kind", () => {
    mountDesktopBridges();
    const { container } = panel();
    fireEvent.click(screen.getByRole("button", { name: /Launch agent/ }));
    // ⚠ "Auto-launch with saved settings for this person" is ON HOLD (MAPPING
    // § Q&A, second round). `POST /trust` stays `sessionOnly` and unreferenced.
    const text = container.textContent ?? "";
    expect(text).not.toContain("Auto");
    expect(text).not.toContain("Trust");
    expect(text).not.toContain("Remember");
  });
});
