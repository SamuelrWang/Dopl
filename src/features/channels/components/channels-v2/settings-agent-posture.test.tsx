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
  desktopMainFilesContaining,
  desktopSource,
  disabled,
  postureSends,
  postureTools,
} from "./settings-agent-harness";

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
    // ⚠ The arm's heading must NOT appear here — and since 2026-08-20 there is no
    // surface it could belong to instead: the arm is DELETED (F-233, Samuel's
    // ruling). This assertion outlived its subject on purpose, because the
    // heading is what a reader would reach for if they re-added a fuse here.
    expect(text).not.toContain("For the next request you allow");
    expect(text).not.toMatch(/Permissions[^.]*\balways\b/i);
  });

  it("is the ONLY permission posture the desktop stores — the arm is gone", () => {
    // ⚠ THIS TEST INVERTED ON 2026-08-20 (Samuel's ruling). It asserted the ARM
    // was untouched — `ARM_TTL_MS`, "SINGLE USE", and a SEPARATE store key from
    // this posture, because one key would have made every arm a permanent
    // channel setting (H2, exactly). The arm is DELETED: its web controls had
    // stopped rendering at the 2026-08-18 consent rewrite and nothing could set
    // it (F-233).
    //
    // ⚠ H2 DID NOT GO WITH IT, AND THIS IS NOW WHERE THAT IS PINNED. The rule was
    // never the TTL — it is that a stored posture may only reach a launch a human
    // is approving in that moment, enforced by the CONSUMER COUNT. So: one key,
    // and the arm's key must not come back under any name.
    // ⚠ Asserted as ABSENT DECLARATIONS, not absent strings: `channel-prefs.js`
    // still NAMES the arm in the ⚠ block recording why it went, and that record is
    // the point — a reader who finds the key in an old store needs to land on it.
    expect(CHANNEL_PREFS).toContain("const POSTURE_KEY = 'channelLaunchPosture'");
    expect(CHANNEL_PREFS).not.toMatch(/const PRESETS_KEY\s*=/);
    expect(CHANNEL_PREFS).not.toMatch(/const ARM_TTL_MS\s*=/);
    expect(CHANNEL_PREFS).not.toMatch(/^function (arm|consume|clear)PermissionPreset/m);
    // The one consumer, COUNTED. A second reader of this record is the failure H2
    // exists to prevent, and it would not look like one from here.
    // ⚠ COUNTED, NOT NAMED, SINCE 2026-08-20 (F-237). This asserted the read lived
    // in `channel-dir-ipc.js`; the desktop split that file and the read moved to
    // `session-ipc-ops.js`, reddening this suite on a change that did not touch the
    // rule. The file it lives in is the desktop's business; that there is exactly
    // ONE is ours. `channel-prefs.js` is excluded as the definition site.
    const readers = desktopMainFilesContaining("channelPrefs.launchStartModes(");
    expect(readers).toHaveLength(1);
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

