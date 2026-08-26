// @vitest-environment jsdom
/**
 * `bits.tsx › MetaRow` — the shared metadata row, and the two properties that
 * fail QUIETLY once it hosts an operator-authored, REMOVABLE custom row.
 *
 *  - **THE REMOVE × KEEPS THE BARE 32px HIT AREA.** `IconButton bare` grows the
 *    hit area to 32px on purpose (icon-button.tsx: "THE HIT AREA GROWS RATHER
 *    THAN SHRINKS"). The caller passing `h-6 w-6` let twMerge SHRINK it back to
 *    24px — invisible in the DOM until you try to click a 24px target. The pin
 *    for the PanelRight toggle lives in `message-pane.test.tsx`; this is the pin
 *    for the OTHER `bare` caller.
 *  - **THE LABEL TRUNCATES.** A custom-row label can reach 40 chars
 *    (`info-card.ts › INFO_CARD_LABEL_MAX`) in a fixed `h-9` row, so the label
 *    span must carry `truncate`/`min-w-0` or it shoves the value off the edge or
 *    grows the row.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Mail } from "lucide-react";
import { MetaRow } from "./bits";

afterEach(cleanup);

describe("MetaRow remove affordance", () => {
  it("renders the × at the bare 32px hit area — never a shrunk 24px", () => {
    render(
      <MetaRow icon={Mail} label="Email" onRemove={vi.fn()}>
        <span>ada@x.dev</span>
      </MetaRow>
    );
    const remove = screen.getByRole("button", { name: "Remove Email from this card" });
    // 32px, the bare floor — asserted directly so an `h-6 w-6` override cannot
    // creep back and quietly shrink the target.
    expect(remove.className).toMatch(/\bh-8\b/);
    expect(remove.className).toMatch(/\bw-8\b/);
    expect(remove.className).not.toMatch(/\bh-6\b/);
    expect(remove.className).not.toMatch(/\bw-6\b/);
  });

  it("truncates a long label instead of growing the row or shoving the value", () => {
    render(
      <MetaRow icon={Mail} label={"L".repeat(40)} onRemove={vi.fn()}>
        <span>value</span>
      </MetaRow>
    );
    const label = screen.getByText("L".repeat(40));
    expect(label.className).toMatch(/\btruncate\b/);
    expect(label.className).toMatch(/\bmin-w-0\b/);
  });

  it("shows no × for a fixed row — absent onRemove is what every legacy caller gets", () => {
    render(
      <MetaRow icon={Mail} label="Email">
        <span>ada@x.dev</span>
      </MetaRow>
    );
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });
});
