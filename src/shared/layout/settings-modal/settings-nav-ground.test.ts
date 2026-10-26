import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The settings rail stands on /home's panel ground — the one its New channel button sits on —
 * by reference. Read from the stylesheet because jsdom loads none.
 */
describe("settings modal nav ground", () => {
  const css = readFileSync(
    new URL("./settings-modal.module.css", import.meta.url),
    "utf8"
  );
  const nav = css.slice(css.indexOf("\n.nav {"), css.indexOf("}", css.indexOf("\n.nav {")));

  it("paints the nav on --bg-overlay with the panel's own line", () => {
    expect(nav).toMatch(/background:\s*var\(--bg-overlay\)/);
    expect(nav).toMatch(/border-right:.*var\(--home-panel-line\)/);
    expect(nav).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("is the token /home's panel takes off the Channels face", () => {
    const home = readFileSync(
      new URL("../../../../apps/desktop-ui/src/pages/home/home.module.css", import.meta.url),
      "utf8"
    );
    const page = home.slice(home.indexOf(".page {"), home.indexOf("}", home.indexOf(".page {")));
    expect(page).toMatch(/background:\s*var\(--bg-overlay\)/);
  });
});
