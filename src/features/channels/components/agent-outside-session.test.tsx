// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AttributionPill, ProvenanceChip } from "./attribution-pill";
import { indexMembers } from "./view-model";
import { channelRows, type MessageRow } from "./view-model-rows";
import { ME, member, message } from "./test-fixtures";

/**
 * **AN OUTSIDE SESSION SAYS SO ON THE ROW** (2026-09-18, Samuel's ruling on the
 * external-session group tag).
 *
 * ⚠ **ONE CHIP, FOUR SURFACES.** `attribution-pill.tsx › ProvenanceChip` is the only
 * place a message row says "an outside session typed this", and every host mounts it
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
 * ⚠ **NOT `span.rounded-full` — THE FACE IS ONE TOO** (its fallback initial),
 * and it sorts first in document order. The chip is identified by its own recipe:
 * a rounded pill at `text-micro`, which nothing else on this row wears.
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
  it("says `outside session` when the client is unknown", () => {
    const { container } = render(<ProvenanceChip />);
    expect(chipText(container)).toBe("outside session");
  });

  it("is grey and carries no paint: an outside session holds no colour", () => {
    const chip = render(<ProvenanceChip />).container.querySelector("span");
    expect(chip?.className).toContain("bg-bg-inset");
    expect(chip?.className).toContain("text-text-muted");
    expect(chip?.getAttribute("style")).toBeNull();
  });

  it("wears no hardcoded colour, size or shadow — tokens and kit only", () => {
    const html = render(<ProvenanceChip />).container.innerHTML;
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

  it("draws no chip on an ordinary agent row: the frame and bar say agent", () => {
    const { container } = render(
      <AttributionPill author={person} authorLabel="Samuel Wang" agent radius="full" time="now" />,
    );
    expect(chipText(container)).toBeNull();
    expect(container.textContent).not.toMatch(/\bagent\b/);
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

// ── "via <client>" (`lib/message-via.ts`) ───────────────────────────────────
describe("the via chip", () => {
  const VERIFIED = { label: "Claude", verified: true, detail: "claude.ai · claude-ai 0.1.0" };
  const DECLARED = { label: "Claude Code", verified: false, detail: "claude-code 2.1.0 · self-reported" };

  it("replaces `outside session` with the client; the tooltip carries version + provenance", () => {
    const { container } = render(<ProvenanceChip via={DECLARED} />);
    expect(chipText(container)).toBe("via Claude Code");
    const chip = container.querySelector("[title]");
    expect(chip?.getAttribute("title")).toBe("claude-code 2.1.0 · self-reported");
    expect(container.querySelector("[data-via-verified]")).toBeNull();
    expect(container.querySelector('[aria-label="verified"]')).toBeNull();
  });

  it("marks a verified client — and only a verified one", () => {
    const { container } = render(<ProvenanceChip via={VERIFIED} />);
    expect(chipText(container)).toBe("via Claude");
    expect(container.querySelector("[data-via-verified]")).not.toBeNull();
    expect(container.querySelector('[aria-label="verified"]')).not.toBeNull();
  });

  it("never rides a non-outside row, and wears no literal colour/size", () => {
    const { container } = render(
      <AttributionPill author={person} authorLabel="Samuel Wang" agent via={VERIFIED} radius="full" time="now" />,
    );
    expect(chipText(container)).toBeNull();
    const html = render(<ProvenanceChip via={VERIFIED} />).container.innerHTML;
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(html).not.toMatch(/\btext-(xs|sm|base|lg)\b/);
  });

  it("renders a hostile label as text, never markup", () => {
    const { container } = render(
      <ProvenanceChip via={{ label: "<img src=x onerror=alert(1)>", verified: false, detail: "" }} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(chipText(container)).toBe("via <img src=x onerror=alert(1)>");
  });
});

describe("MessageRow.via — the stale-payload fallback", () => {
  const INDEX = indexMembers([member({ userId: ME, displayName: "Sam Wang" })], ME);
  const rowOf = (metadata: Record<string, unknown>) =>
    channelRows([message({ authorKind: "agent", metadata })], [], INDEX, (iso) => iso)[0] as MessageRow;

  it("a cached outside-session row with no `via` is an explicit null — the plain chip renders", () => {
    const row = rowOf({ external_session: true });
    expect(row.external).toBe(true);
    expect(row.via).toBeNull();
  });

  it("a stamped row carries the projection; a non-outside row never does", () => {
    const via = { client: { name: "claude-code", version: "2.1.0" } };
    expect(rowOf({ external_session: true, via }).via).toEqual({
      label: "Claude Code",
      verified: false,
      detail: "claude-code 2.1.0 · self-reported",
    });
    expect(rowOf({ via }).via).toBeNull();
  });

  it("renders through the pill end to end", () => {
    const row = rowOf({ external_session: true, via: { vendor: "Grok", host: "grok.com" } });
    const { container } = render(
      <AttributionPill author={person} authorLabel="Samuel Wang" agent external via={row.via} radius="full" time="now" />,
    );
    expect(chipText(container)).toBe("via Grok");
  });
});
