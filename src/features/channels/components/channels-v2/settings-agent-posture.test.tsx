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
 * picked Bypass, and got manual/ask on every session after the first. The arm was spent
 * by the launch that consumed it and expired 30 minutes later, while the control went
 * on displaying the value they chose, because it re-reads only on mount.
 *
 * ⚠ AND THEN THE ARM WAS DELETED OUTRIGHT, SAME DAY (Samuel's ruling). It was first
 * said to have "gone back to the request card" — but that card's inbound branch had
 * not rendered since the 2026-08-18 consent rewrite, so it went nowhere and nothing
 * could arm it (F-233); `RequestPermissionRow` and `channelPermissionPresets` went
 * with it. THIS PAIR IS NOW THE ONLY PERMISSION POSTURE IN THE PRODUCT. H2 still
 * holds and still holds BY CONSUMER: an inbound request a peer triggered carries no
 * tool posture at all and starts at manual/ask, while this pair answers the Launch
 * button the operator is pressing on their own thread.
 * `dopl-desktop-app/main/channel-prefs.js` is the statement of record.
 *
 * The render harness is shared with `settings-tab.test.tsx` — see
 * `settings-agent-harness.tsx` for why it is a file rather than a copy.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    // The consumers, COUNTED. A reader of this record that no human is attending is
    // the failure H2 exists to prevent, and it would not look like one from here.
    // ⚠ COUNTED, NOT NAMED, SINCE 2026-08-20 (F-237). This asserted the read lived
    // in `channel-dir-ipc.js`; the desktop split that file and the read moved to
    // `session-ipc-ops.js`, reddening this suite on a change that did not touch the
    // rule. The file it lives in is the desktop's business; how many there are is
    // ours. `channel-prefs.js` is excluded as the definition site.
    //
    // ⚠ IT WENT FROM ONE TO TWO ON 2026-08-22, AND THAT IS A RULING, NOT A DRIFT
    // (Samuel's launch-over-MCP approval). `launch-directives.js` is the ORCHESTRATOR
    // lane: an operator's own external agent files a `channel_launch_directives` row
    // and that operator's own desktop spawns from it, with NO CLICK. H2's rule is not
    // "a click must happen" — it is that a stored posture may only apply to a launch a
    // human is APPROVING, and Samuel ruled the approval for this lane a LOCAL,
    // PER-MACHINE, DEFAULT-OFF toggle. **The toggle IS that human.**
    // ⚠ WHAT MAKES IT A REAL APPROVAL is that it is unreachable by the thing it
    // governs: an `electron-store` boolean behind one `appWindowOnly` IPC pair, with
    // NO route, NO MCP op and NO `workspace_settings` column — because a spawned
    // session has `Bash` and the device token is on disk, so a server-side flag could
    // be flipped by the very agents the lane creates.
    // ⚠ AND THE DIRECTIVE SUPPLIES ONLY A GOAL AND A MODEL. The posture still comes
    // from THIS record and the tool profile from main's own watched-channel DTO, so a
    // directive-launched agent is exactly as contained as a button-launched one.
    // The desktop-side argument and its cases live in
    // `dopl-desktop-app/test/session-preset-census.test.mjs` (which pins the same fact
    // from the other side, by file name) and `test/launch-directives.test.mjs`.
    // ⚠ A THIRD READER STILL NEEDS AN ARGUMENT OF THIS SHAPE. Do not raise this number
    // without one.
    //
    // ⚠ **THE ORCHESTRATOR LANE'S SPELLING CHANGED ON 2026-09-01 AND THE RULE DID
    // NOT (T24).** It read `channelPrefs.launchStartModes(`, which is
    // `getLaunchPosture` + `windowlessMessageMode` welded together and FLOORED. T24
    // let a directive ASK for a posture, which has to be CLAMPED to the operator's
    // ceiling BEFORE the windowless floor is applied — clamp then floor, or a
    // clamped `ask` comes back out as `auto_inbound` looking as though the ceiling
    // had allowed it. `launchStartModes` cannot express that order, so the lane now
    // reads the two halves and composes them in `main/launch-posture.js ›
    // resolveLaunch`. **The stored posture is still the ceiling and still the only
    // thing that decides.** The lane also moved file, `launch-directives.js` →
    // `launch-directive-spawn.js`, in the same wave's 500-line split.
    //
    // ⚠ SO THE CENSUS IS OVER BOTH SPELLINGS, and it must stay that way: pinning
    // only the old one would have gone GREEN on a lane that had stopped reading the
    // posture at all, and pinning only the new one would miss the button lane.
    // ⚠ `channel-dir-ipc.js` IS EXCLUDED BY NAME AND IT IS NOT AN EXEMPTION: it
    // DISCLOSES the stored posture to the settings UI over IPC and hands it to no
    // spawn. H2 counts who APPLIES a stored posture to a launch, which is a
    // different question from who can read one back.
    const DISCLOSURE_ONLY = "channel-dir-ipc.js";
    const readers = [
      ...desktopMainFilesContaining("channelPrefs.launchStartModes("),
      ...desktopMainFilesContaining("channelPrefs.getLaunchPosture("),
    ].filter((f) => f !== DISCLOSURE_ONLY);
    expect([...new Set(readers)].sort()).toEqual([
      "launch-directive-spawn.js",
      "session-launch-op.js",
    ]);
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

/**
 * 🔒 THE TWO PERMISSION AXES, ACROSS BOTH TREES (G2, 2026-08-30).
 *
 * `TOOL_MODES` and `MESSAGE_MODES` are re-typed in THREE desktop main modules
 * and once more over here in `channels/lib/permission-modes.ts`, and until
 * this pass nothing compared them. `permission-modes.ts`'s own docblock names
 * its ONE reason to change — *"the DESKTOP's enums moved"* — and states that
 * its job is "to keep the web from offering a value main would reject". That
 * is a claim no test made.
 *
 * ⚠ THE FAILURE IS SILENT AND IT FAILS CLOSED, WHICH IS WORSE THAN A THROW.
 * `session-profiles.js › coerceMode` answers `'manual'` / `'ask'` for anything
 * it does not recognise (`// fail-closed`), so a web-side mode the desktop
 * dropped is written, acknowledged, re-rendered as the operator's choice, and
 * applied as the most restrictive value on every launch. The supervision
 * setting reads as saved and is not.
 *
 * ⚠ `session-profiles.js` WINS. It is the module that re-validates every
 * write at spawn; the other three are copies of its answer.
 *
 * ⚠ DERIVED, NOT NAMED (the F-237 lesson this file already carries at
 * `desktopMainFilesContaining`). The desktop's declaring files are found by
 * scanning `main/`, so a FOURTH copy appearing joins the comparison instead of
 * sitting outside a hand-typed list — which is exactly how `HOME_FILES` in
 * `agent-templates/components/template-editor.test.tsx` missed a file.
 */
describe("the two permission axes agree across both trees", () => {
  /** The string members of `const NAME = [...]` — single or double quoted, TS
   *  `as const` or plain JS array. */
  const modes = (source: string, name: string): string[] => {
    const m = new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(source);
    if (!m) throw new Error(`no \`const ${name} = [ … ]\` in source`);
    return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
  };

  // ⚠ DERIVED PER AXIS, NOT ONCE. Since 2026-08-31 the two axes are declared in different
  // places — Axis A in the runtime adapter's `tools.js`, Axis B in the gate — so one scan for
  // "files containing TOOL_MODES" would drag a file that declares only one of them into the
  // comparison for the other. The needle is the LITERAL DECLARATION, so a file that merely READS
  // a list (as `session-profiles.js` now does for Axis A) is correctly not in it.
  const declaringFiles = (name: string) => desktopMainFilesContaining(`const ${name} = [`);
  const WEB_MODULE = "src/features/channels/lib/permission-modes.ts";
  const web = readFileSync(resolve(process.cwd(), WEB_MODULE), "utf8");

  /**
   * ⚠ AXIS A'S LIST STOPPED BEING A LITERAL ON 2026-08-31 (the runtime-adapter port,
   * §0.1b). The modes are a vocabulary of ONE runtime's built-in tools — a runtime
   * storing Axis A as its own words would resolve every call to the most restrictive
   * mode, which on a surface-less session is a silent DENY of every read — so they are
   * DECLARED by the adapter (`main/runtime/claude/index.js › descriptor.toolMode`) and
   * `session-profiles.js` reads them.
   *
   * ⚠ THE INVARIANT THIS BLOCK IS FOR IS UNCHANGED, and it is not about literals: the SPA
   * must never offer a mode the desktop would coerce away, because such a mode is written,
   * acknowledged, re-rendered as the operator's choice, and applied as the most restrictive
   * value on every launch — a supervision setting that reads as saved and is not. What moved
   * is only WHICH desktop source is the winner.
   */
  const ADAPTER = "runtime/claude/index.js";
  const declaredToolModes = (): string[] => {
    const block = /options: \[([\s\S]*?)\n {4}\]/.exec(desktopSource(ADAPTER));
    if (!block) throw new Error(`no \`toolMode.options\` array in ${ADAPTER}`);
    return [...block[1].matchAll(/\{ value: '([^']+)'/g)].map((x) => x[1]);
  };

  /**
   * ⚠ A SECOND RUNTIME'S AXIS-A LIST IS NOT A COPY OF THIS ONE, AND THIS SPLIT IS WHY THE
   * COMPARISON BELOW STILL MEANS SOMETHING (2026-08-31, the Codex adapter).
   *
   * `main/runtime/codex/tools.js` declares `const TOOL_MODES = ['untrusted', 'granular',
   * 'on-request', 'never']` — `approval_policy`'s own values. The scan finds it, and until this
   * repair the "one list in every tree" case compared it against Claude's four and failed.
   *
   * ⚠ THE CASE WAS RIGHT AT ONE ADAPTER AND WRONG AT TWO, IN THE ONE DIRECTION THAT MATTERS.
   * Axis A's modes ARE per-runtime — that is the whole of the port's §0.1b, and a second adapter
   * whose list MATCHED Claude's would be the synthesised-mode failure decision (1) exists to
   * forbid. So the comparison is scoped to the DEFAULT adapter (the runtime an un-stamped session
   * resolves to, and the only one the SPA renders today), and every OTHER adapter is asserted to
   * declare its own DIFFERENT list.
   *
   * The invariant is unchanged and is still not about literals: **the SPA must never offer a mode
   * the desktop would coerce away.** What changed is that "the desktop's answer" is now a
   * per-runtime question, and the SPA's single copy is the default runtime's.
   */
  const ADAPTER_DIR = ADAPTER.slice(0, ADAPTER.lastIndexOf("/") + 1); // `runtime/claude/`
  const isOtherAdapter = (file: string) =>
    file.startsWith("runtime/") && !file.startsWith(ADAPTER_DIR);

  it("finds the desktop declarations, and the right file for each axis", () => {
    // An empty scan would make every assertion below vacuously true.
    expect(declaringFiles("MESSAGE_MODES")).toContain("session-profiles.js");
    expect(declaringFiles("TOOL_MODES")).toContain(`${ADAPTER_DIR}tools.js`);
    expect(declaringFiles("TOOL_MODES").length).toBeGreaterThanOrEqual(3);
    expect(declaredToolModes().length).toBeGreaterThan(0);
  });

  it("a SECOND runtime declares its own Axis-A vocabulary, not a copy of the default's", () => {
    // ⚠ THE POSITIVE HALF, so "scoped to the default adapter" cannot become a way for a second
    // adapter to quietly ship the first one's mode names. A runtime that offered
    // manual/accept_edits/auto/bypass would be Dopl pretending, which is exactly what the
    // no-synthesised-modes rule forbids — and the operator's mental model would be wrong about
    // the platform they chose.
    const others = declaringFiles("TOOL_MODES").filter(isOtherAdapter);
    for (const file of others) {
      const theirs = modes(desktopSource(file), "TOOL_MODES");
      expect(theirs.length, file).toBeGreaterThan(0);
      expect(theirs, file).not.toEqual(declaredToolModes());
    }
  });

  it("session-profiles.js READS Axis A rather than declaring it — core holds no copy", () => {
    // The half that keeps the winner honest: if this file ever re-declares a literal, the
    // comparison below silently starts measuring core against itself.
    const profiles = desktopSource("session-profiles.js");
    expect(profiles).not.toMatch(/const TOOL_MODES = \[/);
    expect(profiles).toContain("const TOOL_MODES = cap.toolModes(descriptorFor(null));");
  });

  it.each(["TOOL_MODES", "MESSAGE_MODES"])(
    "%s is one list in every tree that declares it",
    (name) => {
      // ⚠ TWO WINNERS NOW, AND THE SPLIT IS THE ARGUMENT. Axis B is DOPL'S OWN enum — it
      // names no platform tool and no platform mode, so it is still a literal in the gate.
      // Axis A is the runtime's, so its winner is the descriptor.
      const winner = name === "TOOL_MODES"
        ? declaredToolModes()
        : modes(desktopSource("session-profiles.js"), name);
      // Order is part of it: `session-permission-axes.test.mjs` indexes
      // `TOOL_MODES` positionally to build its permissiveness ladder, and the adapter's
      // own contract suite reads `[0]` as the fail-closed member and the last as the widest.
      expect(winner.length).toBeGreaterThan(0);
      for (const file of declaringFiles(name)) {
        // ⚠ ANOTHER RUNTIME'S ADAPTER IS NOT A COPY OF THIS ONE — see the block above; its own
        // case asserts it differs. Every OTHER declaring file (core, and the default adapter's
        // own modules) is still held against the winner, which is where the drift this suite
        // exists for would actually appear.
        if (name === "TOOL_MODES" && isOtherAdapter(file)) continue;
        expect(modes(desktopSource(file), name), file).toEqual(winner);
      }
      expect(modes(web, name), WEB_MODULE).toEqual(winner);
    }
  );

  it("the web module's DEFAULT is the desktop's fail-closed answer", () => {
    // A default the desktop would itself coerce away is a posture the operator can never
    // actually hold. ⚠ Axis A's fail-closed answer is `descriptor.toolMode.default`, which
    // `runtime-contract.test.mjs` separately pins to be the NARROWEST option — the two halves
    // of "a session starts asking, and park resets it there".
    const profiles = desktopSource("session-profiles.js");
    const adapterDefault = /default: '([^']+)',/.exec(desktopSource(ADAPTER))?.[1];
    expect(adapterDefault).toBe(declaredToolModes()[0]);
    expect(web).toContain(`tools: "${adapterDefault}"`);
    const messageFallback =
      /MESSAGE_MODES\.indexOf\(mode\) === -1 \? '([^']+)'/.exec(profiles)?.[1];
    expect(web).toContain(`messages: "${messageFallback}"`);
  });
});

