import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { KB_SECTION_NUDGE_CHARS } from "@/shared/knowledge/caps";
import {
  DocBodySkeleton,
  WriteRuleWarnings,
  writeRuleLabels,
} from "./doc-pane-chrome";

/**
 * No local `animate-pulse` Bar clones (src/shared/ui/skeleton.tsx): the clone
 * this replaced had drifted to `surface-raised-3` where the kit uses
 * `surface-raised-2`, ghosting the knowledge body darker than every other
 * skeleton.
 */
describe("DocBodySkeleton", () => {
  const html = renderToStaticMarkup(<DocBodySkeleton />);

  it("is composed from the shared atom, at the shared tint", () => {
    const ghosts = html.match(/data-slot="skeleton"/g) ?? [];
    expect(ghosts.length).toBeGreaterThan(0);
    expect((html.match(/animate-pulse/g) ?? []).length).toBe(ghosts.length);
    expect(html).toContain("bg-surface-raised-2");
    expect(html).not.toContain("bg-surface-raised-3");
  });

  it("keeps the editor's geometry so the swap to real content doesn't reflow", () => {
    expect(html).toContain("max-w-3xl");
    expect(html).toContain("px-6");
  });

  it("keeps the 0%-width entries that read as paragraph breaks", () => {
    expect(html).toContain("width:0%");
  });

  it("announces itself instead of being hidden outright", () => {
    // Not `aria-hidden`: that leaves a screen reader silent where the body is
    // about to appear.
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading document");
  });
});

/**
 * 🔒 **THE HUMAN HALF OF SAMUEL'S KB WRITE RULES** (2026-09-18) — *"Human
 * typing in the app: warn only, never blocked."*
 *
 * ⚠ **"NEVER BLOCKED" IS A PROPERTY OF WHERE THE VALUE IS USED**, not of how the
 * warning looks, so the last case here reads `doc-pane.tsx` as text and pins the
 * label list to exactly ONE consumer — the render. The moment somebody guards a
 * save on it, the count moves and this fails.
 */
describe("the KB write-rule warnings", () => {
  const LONG = "x".repeat(KB_SECTION_NUDGE_CHARS + 1);

  it("says nothing about an entry nobody has typed into", () => {
    expect(writeRuleLabels({ title: "Untitled", description: "", body: "" })).toEqual([]);
    expect(
      writeRuleLabels({ title: "Untitled", description: "", body: "   \n " }),
    ).toEqual([]);
  });

  it("flags a missing summary, and stops as soon as one is written", () => {
    expect(writeRuleLabels({ title: "Fuel", description: "", body: "Body." })).toEqual([
      "No summary",
    ]);
    expect(
      writeRuleLabels({ title: "Fuel", description: "Fuel", body: "Body." }),
    ).toEqual(["No summary"]);
    expect(
      writeRuleLabels({
        title: "Fuel",
        description: "The 2026 peg and why it replaced the table.",
        body: "Body.",
      }),
    ).toEqual([]);
  });

  it("flags a long unsectioned page, and BOTH when both are true", () => {
    expect(
      writeRuleLabels({ title: "Fuel", description: "A real summary here.", body: LONG }),
    ).toEqual(["Long page, no headings"]);
    expect(writeRuleLabels({ title: "Fuel", description: "", body: LONG })).toEqual([
      "No summary",
      "Long page, no headings",
    ]);
  });

  it("renders LABEL ONLY — no explainer, no control, no dismiss", () => {
    const html = renderToStaticMarkup(
      <WriteRuleWarnings labels={["No summary", "Long page, no headings"]} />,
    );
    expect(html).toContain("No summary");
    expect(html).toContain("Long page, no headings");
    // ⚠ Samuel's minimal-UI ruling: a label and nothing else. A button here
    // would be a control with no verb — the entry is already saved.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
    // The existing recipe and tokens, at no new size or colour.
    expect(html).toContain("text-caption");
    expect(html).toContain("text-warning/80");
    // ⚠ `note`, never `alert`: it reports, it does not interrupt.
    expect(html).toContain('role="note"');
  });

  it("renders NOTHING when the draft is clean, so a good entry gains no chrome", () => {
    expect(renderToStaticMarkup(<WriteRuleWarnings labels={[]} />)).toBe("");
  });

  it("🔒 the editor never GATES on the labels — exactly one consumer, the render", () => {
    const source = readFileSync(
      join(process.cwd(), "src/features/knowledge/components/doc-pane.tsx"),
      "utf8",
    );
    // The `useMemo` binding plus its single JSX use, and nothing else.
    expect((source.match(/\bruleLabels\b/g) ?? []).length).toBe(2);
    expect(source).toContain("<WriteRuleWarnings labels={ruleLabels} />");
  });
});
