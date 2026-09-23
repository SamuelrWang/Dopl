// @vitest-environment jsdom
/** Shared render harness for the Settings tab's agent-half suites. Not a `*.test.tsx` name, so vitest
 *  imports it but never collects it. */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import {
  ChannelAgentSettingsView,
  type ChannelAgentSettingsViewProps,
} from "./settings-agent";
import { launchSelectionStub } from "../hooks/launch-selection-harness";

/** A `dopl-desktop-app/main` file, off `process.cwd()`: under jsdom a module-relative URL misses the tree. */
export function desktopSource(file: string) {
  return readFileSync(resolve(process.cwd(), "dopl-desktop-app/main", file), "utf8");
}

/**
 * Files under `dopl-desktop-app/main/` (recursive) containing `needle`, relative to `main/` — pins a
 * consumer COUNT, which survives a pure move where a filename pin breaks (F-237).
 */
export function desktopMainFilesContaining(needle: string): string[] {
  const root = resolve(process.cwd(), "dopl-desktop-app/main");
  const walk = (dir: string, prefix: string, out: string[]): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(resolve(dir, entry.name), rel, out); continue; }
      if (entry.name.endsWith(".js")) out.push(rel);
    }
    return out;
  };
  return walk(root, "", []).filter((f) =>
    readFileSync(resolve(root, f), "utf8").includes(needle)
  );
}

const noop = () => {};

/** The view alone, with no window and no bridge. */
export function agentView(over: Partial<ChannelAgentSettingsViewProps> = {}) {
  return render(
    <ChannelAgentSettingsView
      profile="full"
      onSetToolProfile={noop}
      toolProfileBusy={false}
      // The stub's defaults are the restrictive, no-runtime lane; suites that care override it.
      selection={launchSelectionStub()}
      folder={null}
      {...over}
    />
  );
}

/** Rendered copy, the way a person reads it — assertions span elements. */
export const copy = (over: Partial<ChannelAgentSettingsViewProps> = {}) =>
  agentView(over).container.textContent ?? "";

/** The root suite has no jest-dom — `toBeDisabled` does not exist here. */
export const disabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled;

// Named for the record fields they read (`tools` / `messages`), not the row labels; Messaging
// covers both directions.
export const postureTools = () =>
  screen.getByLabelText("Tool use for agents you launch");
export const postureSends = () =>
  screen.getByLabelText("Messaging for agents you launch");
