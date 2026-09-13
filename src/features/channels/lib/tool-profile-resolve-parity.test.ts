import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AGENT_TOOL_PROFILE_LABELS } from "../constants";
import { isSharedChannel, profileForChannel } from "./tool-profile-resolve";

/**
 * 🔒 **ONE NARROWING RULE, TWO TREES** — the parity half of F-692's truthful label
 * (2026-09-13), on `agent-posture-parity.test.ts`'s exact argument.
 *
 * ⚠ **THE COPY THIS GUARDS.** `lib/tool-profile-resolve.ts` is a hand copy of
 * `dopl-desktop-app/main/tool-profiles.js › profileForChannel` and
 * `main/targeting-window.js › isSharedChannel`, because main is CommonJS and cannot
 * import this tree. The copy is deliberate — the alternative was the Settings tab
 * printing **"Full access"** over a session the desktop launches at `channel_agent`,
 * which is what it did — but a hand-copied rule is a drift bomb, and this one's
 * failure mode is a CONTAINMENT CLAIM that is wrong in the fail-OPEN direction.
 *
 * ⚠ **IT RUNS THE REAL CODE.** The desktop's sentinel block is sliced and evaluated,
 * so this is not two suites each agreeing with themselves.
 */

const DESKTOP_ROOT = path.join(
  import.meta.dirname, "..", "..", "..", "..", "dopl-desktop-app", "main"
);
const PROFILES_SRC = readFileSync(path.join(DESKTOP_ROOT, "tool-profiles.js"), "utf8");
const WINDOW_SRC = readFileSync(path.join(DESKTOP_ROOT, "targeting-window.js"), "utf8");

function desktop(): {
  profileForChannel: (p: string, shared: boolean) => string;
  KNOWN_PROFILES: readonly string[];
} {
  const begin = PROFILES_SRC.indexOf("// ─── BEGIN TOOL-PROFILE TABLE");
  expect(begin, "the desktop's BEGIN sentinel is gone").toBeGreaterThan(-1);
  const end = PROFILES_SRC.indexOf("// ─── END TOOL-PROFILE TABLE");
  const block = PROFILES_SRC.slice(begin, end > begin ? end : undefined);
  return new Function(
    `${block}\n return { profileForChannel, KNOWN_PROFILES };`
  )() as ReturnType<typeof desktop>;
}

const main = desktop();

describe("the two trees resolve the same profile for the same room", () => {
  /**
   * ⚠ **THE FULL CROSS PRODUCT, over the DESKTOP's OWN profile list.** The set is read
   * out of `KNOWN_PROFILES` rather than restated, so a fifth profile added there fails
   * here instead of being silently un-mirrored.
   */
  it("agrees on every (stored profile × shared) pair", () => {
    for (const profile of main.KNOWN_PROFILES) {
      for (const shared of [true, false]) {
        // `channel_agent` is never STORED, so this tree's signature cannot express it;
        // the desktop's own suite pins its identity case.
        if (profile === "channel_agent") continue;
        expect(
          profileForChannel(profile as "full" | "dopl_only" | "read_only", shared),
          `${profile} / shared=${shared}`
        ).toBe(main.profileForChannel(profile, shared));
      }
    }
  });

  it("moves exactly ONE pair — `full` in a shared room — and never widens", () => {
    expect(profileForChannel("full", true)).toBe("channel_agent");
    expect(profileForChannel("full", false)).toBe("full");
    for (const profile of ["dopl_only", "read_only"] as const) {
      expect(profileForChannel(profile, true)).toBe(profile);
      expect(profileForChannel(profile, false)).toBe(profile);
    }
  });
});

describe("the FACT behind the rule — is this room shared", () => {
  /**
   * 🔒 ⚠ **AN ABSENT COUNT READS AS SHARED**, which is the direction that can only ever
   * REMOVE a shell. The desktop's predicate is `!== 1` and is pinned by regex, because a
   * `> 1` there would silently call every unknown room solo.
   */
  it("only an exact 1 is solo, on both sides", () => {
    expect(isSharedChannel(1)).toBe(false);
    for (const n of [0, 2, 9, null, undefined]) {
      expect(isSharedChannel(n), `memberCount=${n}`).toBe(true);
    }
    expect(WINDOW_SRC).toMatch(/function isSharedChannel\(channel\) \{[\s\S]*?return n !== 1;/);
  });
});

describe("the label the operator reads", () => {
  it("names the fourth profile, and says SHELL rather than a single verb", () => {
    // ⚠ THE WHOLE POINT OF F-692's UI half: the resolved profile must have a label, or the
    // row falls back to the stored one's and over-promises what the desktop will run.
    expect(AGENT_TOOL_PROFILE_LABELS.channel_agent).toBe("Full access, no shell");
    // ⚠ The desktop denies the GROUP (Bash + BashOutput + KillShell), so naming one verb
    // would read as a fence with the door beside it open.
    expect(PROFILES_SRC).toMatch(
      /const SHELL_BUILTINS = \['Bash', 'BashOutput', 'KillShell'\];/
    );
  });
});
