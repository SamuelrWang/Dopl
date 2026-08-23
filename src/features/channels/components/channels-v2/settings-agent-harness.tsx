// @vitest-environment jsdom
/**
 * SHARED RENDER HARNESS for the Settings tab's AGENT half.
 *
 * WHY IT IS ITS OWN FILE. `settings-tab.test.tsx` crossed the 500-line cap when the
 * 2026-08-20 arm-vs-durable-posture split landed, and the alternative — copying
 * `agentView` into a second file — is how two suites drift into rendering two
 * different components. Same seam and same precedent as `_channel-prefs-block.mjs`
 * on the desktop side: the machinery is shared, the cases split by what they are
 * ABOUT. `settings-tab.test.tsx` keeps the tab (rows, profiles, folder, trust);
 * `settings-agent-posture.test.tsx` takes the launch posture.
 *
 * ⚠ NOT a `*.test.tsx` name on purpose — `vitest.config.ts` includes exactly
 * `src/**​/*.test.ts(x)`, so this file is imported, never collected.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  ChannelAgentSettingsView,
  type ChannelAgentSettingsViewProps,
} from "./settings-agent";
import { DEFAULT_PERMISSION_PRESET } from "../../lib/permission-modes";

/** The desktop modules these claims are ABOUT. ⚠ Off `process.cwd()` (the vitest
 *  root), not `import.meta.url`: under the jsdom environment these files declare, a
 *  module-relative URL misses the tree. */
export function desktopSource(file: string) {
  return readFileSync(resolve(process.cwd(), "dopl-desktop-app/main", file), "utf8");
}

/**
 * HOW MANY FILES IN `dopl-desktop-app/main/` CONTAIN `needle` — for pinning a
 * CONSUMER COUNT rather than a filename.
 *
 * ⚠ IT EXISTS BECAUSE A FILENAME PIN BROKE ON A PURE MOVE (F-237). The launch
 * posture's one-consumer rule was asserted as `desktopSource("channel-dir-ipc.js")
 * .toContain(...)`; the desktop split that file and the read moved to
 * `session-ipc-ops.js`, so a refactor that changed NOTHING about the rule turned a
 * `src/` suite red — and the desktop's own gates could not see it, because the
 * assertion lives over here.
 *
 * ⚠ COUNT, NOT LOCATION, IS THE ACTUAL INVARIANT. H2 is enforced by there being
 * exactly ONE reader of the stored posture; WHICH file holds it is an
 * implementation detail the desktop is free to move. This survives the move and
 * still fails on the thing that matters — a second reader appearing.
 */
export function desktopMainFilesContaining(needle: string): string[] {
  const dir = resolve(process.cwd(), "dopl-desktop-app/main");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .filter((f) => readFileSync(resolve(dir, f), "utf8").includes(needle));
}

const noop = () => {};

/** The agent half on its own, with the two desktop-only halves injected — the view
 *  renders with no window and no bridge, which is the whole reason it is split from
 *  `ChannelAgentSettings`. */
export function agentView(over: Partial<ChannelAgentSettingsViewProps> = {}) {
  return render(
    <ChannelAgentSettingsView
      profile="full"
      onSetToolProfile={noop}
      toolProfileBusy={false}
      posture={DEFAULT_PERMISSION_PRESET}
      postureBusy={false}
      onChangePosture={noop}
      folder={null}
      {...over}
    />
  );
}

/** Rendered copy, the way a person reads it — assertions span elements. */
export const copy = (over: Partial<ChannelAgentSettingsViewProps> = {}) =>
  agentView(over).container.textContent ?? "";

/** ⚠ The root suite has no jest-dom — `toBeDisabled` does not exist here. */
export const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

// ⚠ NAMED FOR THE RECORD THEY READ (2026-08-20). These selects wrote the single-use
// ARM until the split; they write the DURABLE LAUNCH POSTURE now, and the arm went
// back to the request card — the only surface that can honestly show a fuse.
// `use-channel-launch-posture.ts` states the split.
export const postureTools = () =>
  screen.getByLabelText("Permissions for agents you launch");
export const postureSends = () =>
  screen.getByLabelText("Sends for agents you launch");
