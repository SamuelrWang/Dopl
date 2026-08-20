// @vitest-environment jsdom
/**
 * The Settings tab's DURABLE LAUNCH POSTURE — the two selects that decide what the
 * operator's OWN agent starts on when they press Launch.
 *
 * ⚠ THESE ROWS CHANGED WHAT THEY WRITE ON 2026-08-20, AND THAT IS THE POINT OF THE
 * FILE. They wrote the SINGLE-USE ARM, under the launch panel's own heading, on the
 * reasoning that one sentence must not drift into two. The heading was carrying the
 * entire single-use disclosure — and it could not: the rows sat among durable
 * settings (tool profile, folder, auto-send), so the operator read them as settings,
 * picked Bypass, and got manual/ask on every session after the first. The arm is spent
 * by the launch that consumes it and expires 30 minutes later, while the control went
 * on displaying the value they chose, because it re-reads only on mount.
 *
 * ⚠ THE ARM DID NOT MOVE OR CHANGE — it went back to being consent-only, on the
 * request card (`launch-panel.tsx › RequestPermissionRow`). H2 is intact because the
 * SPLIT IS BY CONSUMER, not by lifetime: the arm answers a peer's request a human is
 * approving right now; this pair answers the Launch button that same human is
 * pressing on their own thread. `dopl-desktop-app/main/channel-prefs.js` is the
 * statement of record; `test/session-preset-start.test.mjs` pins the consumer counts.
 *
 * The render harness is shared with `settings-tab.test.tsx` — see
 * `settings-agent-harness.tsx` for why it is a file rather than a copy.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import {
  agentView,
  copy,
  desktopSource,
  disabled,
  postureSends,
  postureTools,
} from "./settings-agent-harness";
import { PERMISSION_ARM_TTL_MS } from "../../hooks/use-channel-permission-preset";

afterEach(cleanup);

const CHANNEL_PREFS = desktopSource("channel-prefs.js");

describe("the LAUNCH POSTURE renders with its current values, and changes on selection", () => {
  it("shows both axes' current values without opening anything", () => {
    agentView({ posture: { tools: "bypass", messages: "auto_both" } });
    expect(postureTools().textContent).toContain("Bypass");
    expect(postureSends().textContent).toContain("Automatic");
  });

  it("writes the picked mode back on the axis it belongs to", () => {
    const onChangePosture = vi.fn();
    agentView({ onChangePosture });
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    expect(onChangePosture).toHaveBeenCalledWith({ tools: "bypass" });
  });

  it("goes inert while a posture write is in flight", () => {
    agentView({ postureBusy: true });
    expect(disabled(postureTools())).toBe(true);
    expect(disabled(postureSends())).toBe(true);
  });

  it("says WHICH LAUNCHES it governs, and never claims to be every session", () => {
    // ⚠ THIS TEST INVERTED ON 2026-08-20 AND THE REASON IS THE WHOLE SPLIT.
    // It used to assert the heading read "For the next request you allow" —
    // the ARM's heading — because these rows wrote the arm and the heading was
    // carrying the entire single-use disclosure on its own. It could not: the
    // rows sat among durable settings, so the operator read them as one, picked
    // Bypass, and got manual/ask on every session after the first.
    // The rows are DURABLE now, so the honest heading names the ACT.
    const text = copy();
    expect(text).toContain("When you launch an agent");
    expect(text).toContain("For every session on this channel");
    // ⚠ The arm's heading must NOT appear here any more — it belongs to the
    // request card, the only surface that can honestly show a fuse.
    expect(text).not.toContain("For the next request you allow");
    expect(text).not.toMatch(/Permissions[^.]*\balways\b/i);
  });

  it("leaves the ARM exactly as it was — single-use, 30 minutes, consent-only", () => {
    // The split is by CONSUMER, not by lifetime (H2). This tab no longer shows
    // the arm, and nothing about the arm changed; if either half of that stops
    // being true, this is the assertion that says so.
    expect(CHANNEL_PREFS).toContain("const ARM_TTL_MS = 30 * 60 * 1000");
    expect(PERMISSION_ARM_TTL_MS).toBe(30 * 60 * 1000);
    expect(CHANNEL_PREFS).toContain("SINGLE USE");
    // ...and the durable record is a SEPARATE store key, or every arm would
    // become a permanent channel setting — which is H2, exactly.
    expect(CHANNEL_PREFS).toContain("const POSTURE_KEY = 'channelLaunchPosture'");
    expect(CHANNEL_PREFS).toContain("const PRESETS_KEY = 'channelPermissionPresets'");
  });

  it("drops the whole posture subsection, heading included, with no bridge", () => {
    const text = copy({ posture: null });
    expect(text).not.toContain("When you launch an agent");
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByText("Sends")).toBeNull();
    // The durable control survives — it is not desktop-gated.
    expect(screen.getByRole("radio", { name: /Full access/ })).toBeTruthy();
  });
});

