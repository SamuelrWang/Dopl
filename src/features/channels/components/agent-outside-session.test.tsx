// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AgentChip, AttributionPill } from "./attribution-pill";

/**
 * **AN OUTSIDE SESSION SAYS SO ON THE ROW** (2026-09-18, Samuel's ruling on the
 * external-session group tag).
 *
 * ⚠ **ONE CHIP, FOUR SURFACES.** `attribution-pill.tsx › AgentChip` is the only
 * place a message row says "an agent typed this", and every host mounts it
 * through `AuthoredRow`: the CHANNELS page (web + the desktop SPA), the pop-out
 * THREAD WINDOW, the /home relationship record (through
 * `channel-surface-standalone.tsx`), and the marketing banner demo. So this one
 * test covers all four, and there is no second badge site to keep in step.
 *
 * ⚠ **LABEL ONLY — NO EXPLAINER COPY.** INVARIANTS §5's minimal-copy ruling: a
 * chip is a label, and what an outside session IS belongs in the doctrine an
 * agent pulls, not on every row a human scrolls past.
 */

const person = {
  userId: "u-1",
  displayName: "Samuel Wang",
  email: null,
  avatarUrl: null,
};

// ⚠ **EXPLICIT CLEANUP, AND EVERY QUERY IS CONTAINER-SCOPED.** This project's
// vitest config does not auto-clean between cases, so a bare `screen` query
// searches every container this FILE has rendered — which turned "the chip is
// absent" into "found two of them" and made three cases fail for a reason that
// had nothing to do with the component.
afterEach(cleanup);

/**
 * The chip's text inside ONE render, or null.
 *
 * ⚠ **NOT `span.rounded-full` — THE AVATAR IS ONE TOO** (its fallback initial),
 * and it sorts first in document order, so that selector silently answered "?"
 * for every case. The chip is identified by its own recipe: a rounded pill at
 * `text-micro`, which nothing else on this row wears.
 */
function chipText(container: HTMLElement): string | null {
  const chip = [...container.querySelectorAll("span")].find(
    (el) =>
      el.className.includes("rounded-full") &&
      el.className.includes("text-micro"),
  );
  return chip?.textContent ?? null;
}

describe("the chip", () => {
  it("says `outside session` instead of `agent`", () => {
    const { container } = render(<AgentChip external />);
    expect(chipText(container)).toBe("outside session");
    // ⚠ IT REPLACES THE WORD RATHER THAN QUALIFYING IT. `agent · outside
    // session` reads as two facts where there is one, and the retired
    // `Agent · <id>` chip is this repo's own precedent against that idiom.
    expect(chipText(container)).not.toBe("agent");
  });

  it("keeps the grey face even when a colour is handed to it", () => {
    // ⚠ NOT A NEW RULE — a consequence of the existing one. The colour says
    // WHICH agent, drawn from the channel's sixteen-key bank; an outside session
    // holds no `channel_sessions` row and therefore no key. There is nothing for
    // a paint to mean here, so it is ignored rather than honoured.
    const { container } = render(
      <AgentChip external paint="var(--agent-color-03)" />,
    );
    const chip = container.querySelector("span");
    expect(chip?.className).toContain("bg-bg-inset");
    expect(chip?.className).toContain("text-text-muted");
    expect(chip?.getAttribute("style")).toBeNull();
  });

  it("is byte-identical to the agent chip for a normal row", () => {
    const outside = render(<AgentChip external />).container.querySelector("span");
    const plain = render(<AgentChip />).container.querySelector("span");
    // ⚠ THE RECIPE IS REUSED BY REFERENCE, NOT RE-SPELLED — same shape classes,
    // same grey face, only the word differs.
    expect(outside?.className).toBe(plain?.className);
    expect(outside?.textContent).not.toBe(plain?.textContent);
  });

  it("wears no hardcoded colour, size or shadow — tokens and kit only", () => {
    // ⚠ The same sweep `agent-attribution.test.tsx` runs over the pill. A new
    // label must not be the thing that introduces a literal.
    const { container } = render(<AgentChip external />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).not.toMatch(/\btext-(xs|sm|base|lg)\b/);
    expect(html).not.toMatch(/\bshadow-\[/);
  });
});

describe("the pill", () => {
  it("renders the outside-session chip when the row says so", () => {
    const { container } = render(
      <AttributionPill author={person} authorLabel="Samuel Wang" agent external radius="full" time="now" />,
    );
    expect(chipText(container)).toBe("outside session");
  });

  it("leaves an ordinary agent row exactly as it was", () => {
    const { container } = render(
      <AttributionPill
        author={person}
        authorLabel="Samuel Wang"
        agent
        radius="full"
        time="now"
      />,
    );
    expect(chipText(container)).toBe("agent");
  });

  it("shows NO chip at all on a human row, whatever `external` says", () => {
    // 🔒 `external` NARROWS `agent`; it may never promote a human row to wearing
    // a chip. The write path cannot produce such a row, but the component must
    // not be the thing that trusts that.
    const { container } = render(
      <AttributionPill
        author={person}
        authorLabel="Samuel Wang"
        agent={false}
        external
        radius="full"
        time="now"
      />,
    );
    expect(chipText(container)).toBeNull();
  });
});
