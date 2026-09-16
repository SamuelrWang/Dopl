// @vitest-environment jsdom
/**
 * **WHAT THE JUMP-TO-MESSAGE FLASH PAINTS** — Samuel, 2026-09-16: *"when I click on a
 * mention in the info tab, and it auto scrolls to said mention, it will like highlight the
 * message for a few seconds, which looks great, but the highlight is in blue. I would like
 * that highlight to be in like a light gray. not blue."*
 *
 * ⚠ **THE REFUSAL IS THE POINT OF THIS FILE.** `--link` is this surface's ROUTING colour —
 * a resolved `@handle` in a body, the composer's live tint, the unread dot — so it is the
 * one value that must not come back here by accident when somebody "tidies" a class string.
 * Both faces of the row are pinned because both carry the tint from one constant, and a
 * second spelling is how they came to disagree about geometry twice before.
 *
 * ⚠ **THE GREY IS ASSERTED AS THE RAMP TOKEN, NEVER AS A COMPUTED COLOUR** — the same rule
 * `agent-post-accent-face.test.tsx` keeps for the palette: `bg-surface-raised-3` is a
 * design-system handle, and re-tuning the ramp behind it must not turn this suite red.
 */

import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AuthoredRow, FLASH_TINT } from "./authored-row";
import { agentPostAccent } from "./agent-box-rule";

afterEach(cleanup);

const renderRow = (flash: boolean, accented: boolean) =>
  render(
    <AuthoredRow
      id="m1"
      side="peer"
      author={{
        userId: "u1",
        email: null,
        displayName: "Bug Reviewer",
        avatarUrl: null,
      }}
      authorLabel="Bug Reviewer"
      time="09:41"
      agent={accented}
      agentId={accented ? "ab12cd34" : null}
      continuation={false}
      flash={flash}
      accent={accented ? agentPostAccent({ color: "agent-07" }) : null}
    >
      <p>the parser is fixed</p>
    </AuthoredRow>
  );

const article = (c: HTMLElement) => c.querySelector("article")!;

describe("the flash tint", () => {
  it("is the light-grey elevation tint, never the link blue", () => {
    expect(FLASH_TINT).toBe("bg-surface-raised-3");
    expect(FLASH_TINT).not.toMatch(/link/);
  });

  it("paints a flashed BARE row grey", () => {
    const { container } = renderRow(true, false);
    expect(article(container).className).toContain(FLASH_TINT);
    expect(article(container).className).not.toMatch(/bg-link/);
  });

  it("paints a flashed ACCENTED row from the same constant", () => {
    const { container } = renderRow(true, true);
    expect(article(container).className).toContain(FLASH_TINT);
    expect(article(container).className).not.toMatch(/bg-link/);
  });

  it("paints nothing at rest — the tint is the whole signal", () => {
    expect(article(renderRow(false, false).container).className).not.toContain(FLASH_TINT);
  });
});
