import { describe, expect, it } from "vitest";
import { launchAllowedInView } from "./launch-view-gate";

/**
 * THE LAUNCH CONTROL'S VIEW GATE (2026-09-08). Until this date
 * `surface-info-panel.tsx` required an OPEN thread, so the Agents tab in CHANNEL
 * view — where most people arrive — rendered no launch control at all (Samuel:
 * "i dont see the new agent button"), against `agents-tab.tsx`'s own 2026-08-24
 * rule. The DOM cannot pin this in the surface harness (no desktop bridge → the
 * tab's "needs the desktop app" arm renders first), so the rule is a pure function.
 */
const ME = "me";
const mine = { createdBy: ME, targetUserId: "peer" };
const toMe = { createdBy: "peer", targetUserId: ME };
const strangers = { createdBy: "a", targetUserId: "b" };

describe("launchAllowedInView", () => {
  it("channel view (no thread): the capability alone decides", () => {
    expect(launchAllowedInView(true, null, ME)).toBe(true);
    expect(launchAllowedInView(true, undefined, ME)).toBe(true);
    expect(launchAllowedInView(false, null, ME)).toBe(false);
  });

  it("thread view: a PARTY may launch, a bystander may not", () => {
    expect(launchAllowedInView(true, mine, ME)).toBe(true);
    expect(launchAllowedInView(true, toMe, ME)).toBe(true);
    expect(launchAllowedInView(true, strangers, ME)).toBe(false);
  });

  it("no capability → never, whatever the thread", () => {
    expect(launchAllowedInView(false, mine, ME)).toBe(false);
  });
});
