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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  ChannelAgentSettingsView,
  type ChannelAgentSettingsViewProps,
} from "./settings-agent";
import { member as makeMember } from "./test-fixtures";
import { DEFAULT_PERMISSION_PRESET } from "../../hooks/use-channel-permission-preset";

/** The desktop modules these claims are ABOUT. ⚠ Off `process.cwd()` (the vitest
 *  root), not `import.meta.url`: under the jsdom environment these files declare, a
 *  module-relative URL misses the tree. */
export function desktopSource(file: string) {
  return readFileSync(resolve(process.cwd(), "dopl-desktop-app/main", file), "utf8");
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
      otherMembers={[makeMember({ userId: "u-alice", displayName: "Alice" })]}
      trustedIds={new Set()}
      trustBusyIds={new Set()}
      onToggleTrust={noop}
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
