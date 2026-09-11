import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 🔒 THE SETTINGS SIDEBAR STANDS ON THE CHANNEL SWITCHER'S GRAY (Samuel,
 * 2026-09-11: *"make the left, where the sidebar is, gray. It should be the
 * gray that we have as the background color where the channel switcher is"*).
 * That ground is `--home-panel`, by reference — `/home`'s base panel
 * (`pages/home/index.tsx › bg-home-panel`). Read from the stylesheet because
 * jsdom loads none.
 */
describe("settings modal nav ground", () => {
  const css = readFileSync(
    new URL("./settings-modal.module.css", import.meta.url),
    "utf8"
  );
  const nav = css.slice(css.indexOf("\n.nav {"), css.indexOf("}", css.indexOf("\n.nav {")));

  it("paints the nav on --home-panel with the panel's own line", () => {
    expect(nav).toMatch(/background:\s*var\(--home-panel\)/);
    expect(nav).toMatch(/border-right:.*var\(--home-panel-line\)/);
    expect(nav).not.toMatch(/shell-surface|#[0-9a-f]{3,6}\b/i);
  });
});
