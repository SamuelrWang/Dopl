/**
 * The OLD channels page's composer, after the intent pill retired
 * (wiring plan Phase 3).
 *
 * ⚠ WHAT THIS FILE PINS IS AN ABSENCE, and the absence is the feature. The
 * plain composer is human chat, full stop: no mode control, no subject, no
 * addressee picker, no unaddressed hint. Raising an agent request is the "New
 * agent thread" panel's job (`components/channels-v2/composer.tsx`), and a
 * composer that can quietly become a request again is the shape that ruling
 * exists to end.
 *
 * The DECISION logic that used to live in `lib/composer-mode.ts` has no
 * successor here because there is no decision left — one draft, one payload.
 * This repo's vitest runs in the node environment with no DOM, so what these
 * cases read is the rendered markup.
 */

import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageComposer, type SendOptions } from "./message-composer";

const noop: (body: string, opts?: SendOptions) => Promise<void> = async () => {};

/** The composer's markup at rest. */
function markup(placeholder?: string) {
  return renderToStaticMarkup(
    <MessageComposer onSend={noop} placeholder={placeholder} />
  );
}

describe("MessageComposer — the intent pill is GONE", () => {
  it("renders no mode control of any kind", () => {
    const html = markup("Message Ada");
    // The pill was a menu button whose accessible name carried the picked mode.
    expect(html).not.toContain('aria-haspopup="menu"');
    expect(html).not.toContain("Send as");
    expect(html).not.toContain(">Request<");
    expect(html).not.toContain('role="tablist"');
  });

  it("states the ONE consequence under the composer, unconditionally", () => {
    // ⚠ It used to change with the mode; there is one thing this does now.
    expect(markup()).toContain("Message the channel. No agent is started.");
  });

  it("carries none of request mode's chrome", () => {
    const html = markup("Message #general");
    expect(html).not.toContain('aria-label="Subject"');
    expect(html).not.toContain("Ask a specific agent");
    // The unaddressed hint was request-mode-only and retires with it.
    expect(html).not.toContain(
      "No agent will pick this up unless you address it."
    );
  });

  /**
   * ⚠ THE STRUCTURAL HALF. A markup assertion cannot notice a module that has
   * been re-added but not yet wired to a visible surface, and "the plain
   * composer is human chat" is a rule about what CAN be built here, not only
   * about what is rendered today.
   */
  it("and the modules behind it are deleted, not merely unrendered", () => {
    for (const rel of [
      "./composer-intent-pill.tsx",
      "../lib/composer-mode.ts",
      "../lib/composer-mode.test.ts",
    ]) {
      expect(
        existsSync(new URL(rel, import.meta.url)),
        `${rel} is back — the composer intent pill retired in wiring plan Phase 3`
      ).toBe(false);
    }
  });
});

describe("MessageComposer — what it still is", () => {
  it("renders exactly one textarea and one send button", () => {
    const html = markup();
    expect((html.match(/<textarea/g) ?? []).length).toBe(1);
    expect(html).toContain("Send message");
  });

  it("disables send on an empty draft", () => {
    const html = markup();
    const sendAt = html.indexOf('aria-label="Send message"');
    const openedAt = html.lastIndexOf("<button", sendAt);
    expect(html.slice(openedAt, sendAt)).toContain("disabled");
  });

  it("uses no em dashes in the composer's own copy", () => {
    expect(markup()).not.toContain("—");
  });
});

describe("MessageComposer chrome (shared with the desktop thread window)", () => {
  it("uses the ONE shared send button, not a local send recipe", () => {
    const html = markup();
    // The thread window's face: raised black kit class, 30px, 8px radius.
    expect(html).toContain("auth-btn-3d");
    expect(html).toContain("h-[30px]");
    expect(html).toContain("w-[30px]");
    expect(html).toContain("rounded-[8px]");
    // The arrow glyph is the thread window's path, not a lucide icon.
    expect(html).toContain("M8 13V3.6M8 3.2 3.9 7.3M8 3.2l4.1 4.1");
    expect(html).not.toContain("lucide-send-horizontal");
    // The accessible name the composer has always used is preserved.
    expect(html).toContain('aria-label="Send message"');
  });

  it("caps the auto-grow at three lines and scrolls past it", () => {
    const html = markup();
    // 1.625em per line (leading-relaxed) + 8px of py-1 padding: one line at rest,
    // three lines at the cap. The hook's inline height rides inside this clamp.
    expect(html).toContain("min-h-[calc(1.625em_+_8px)]");
    expect(html).toContain("max-h-[calc(4.875em_+_8px)]");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain('rows="1"');
    // The old fixed 10rem cap is gone.
    expect(html).not.toContain("max-h-40");
  });

  it("never hardcodes a hex color (design tokens only)", () => {
    expect(markup()).not.toMatch(/#[0-9a-fA-F]{6}/);
  });
});

describe("MessageComposer — the surfaces that are GONE", () => {
  // The `@` mention popup and the `/new-agent` slash hint both existed to reach
  // NAMED AGENTS, and went with them (rollback §1). Pinned as absences so a
  // future composer change cannot quietly reintroduce either.
  it("offers no slash-command hint", () => {
    expect(markup()).not.toContain("/new-agent");
  });

  it("offers no agent mention list, and the modules behind one are gone", () => {
    // ⚠ A composer at rest shows a placeholder, never a member list — and it no
    // longer even receives a roster, which is the stronger statement.
    for (const rel of [
      "./mention-popup.tsx",
      "../lib/mention.ts",
      "../lib/composer-commands.ts",
    ]) {
      expect(
        existsSync(new URL(rel, import.meta.url)),
        `${rel} is back — it was deleted in the channels rollback §1`
      ).toBe(false);
    }
  });
});
