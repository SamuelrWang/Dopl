// @vitest-environment jsdom
/**
 * THE POPUP FORM KIT (2026-09-08) — the four pieces of the recipe Samuel approved on the New agent
 * popup, pinned HERE so the next dialog inherits them instead of re-deriving them.
 *
 * `channels/components/launch-agent-dialog.test.tsx` is the OTHER half of this proof and the more
 * interesting one: it drives the real dialog through the kit and passes UNEDITED across the
 * extraction. What belongs in THIS file is what that one cannot say — the properties a SECOND
 * caller depends on:
 *
 *  - **THE WEIGHT IS THE MODULE'S, NOT THE CALLER'S.** Samuel: *"All of the headers (name,
 *    description, template, etc), should be bolded"*. jsdom loads no stylesheet, so the rendered
 *    half of that is "one class, no `font-*` utility" and the declaration itself is a SOURCE read —
 *    the same two-layer pin `open-scale-button.test.tsx` uses, for the same reason.
 *  - **THE SWEEP IS A CLASS THE COMPONENT TOGGLES**, so `.lineActive` is a CONTRACT and not an
 *    implementation detail: a refactor to `:focus-within` would look identical in the app, pass
 *    every rendered assertion, and silently delete the only layer a test can see.
 *  - **A SINGLE CHOICE IS `plain` + `md`, FIXED BY THE WRAPPER.** Those two words are the ruling
 *    (gray fill, no hairline, 30px), and a caller that could pass a different pair would reach a
 *    fifth face with no review.
 *  - **BOTH FOOTER BUTTONS ARE `--action-h-sm`.** The 36px scale belongs to the PAGE button that
 *    opens a popup; a dialog cut to it is the drift the kit exists to stop.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FormDialog, FormSection, PillChoice, UnderlineField } from "./form-dialog";

afterEach(cleanup);

const css = () =>
  readFileSync(
    path.join(process.cwd(), "src", "shared", "ui", "form-dialog.module.css"),
    "utf8"
  );

/** One rule's DECLARATIONS, by selector — comments stripped, because this module argues for its
 *  properties in prose and an unstripped read would match the ARGUMENT with the rule deleted. */
function rule(selector: string): string {
  const bare = css().replace(/\/\*[\s\S]*?\*\//g, "");
  const at = bare.indexOf(`${selector} {`);
  expect(at).toBeGreaterThan(-1);
  return bare.slice(at, bare.indexOf("}", at));
}

// ── 1. THE SECTION LABEL ─────────────────────────────────────────────────────

describe("FormSection — the bold label above the control", () => {
  it("carries the module's own class and NO per-caller weight utility", () => {
    render(
      <FormSection label="Template">
        <span>control</span>
      </FormSection>
    );
    const label = screen.getByText("Template");
    expect(label.className).toMatch(/label/);
    // ⚠ THE FAILURE THIS CATCHES is a caller "fixing" a label by hand — one bold row among four
    // semi-bold ones is invisible in review and obvious on screen.
    expect(label.className).not.toMatch(/font-(semibold|medium|normal|bold)/);
  });

  it("declares the weight ONCE, in the module (600)", () => {
    expect(rule(".label")).toMatch(/font-weight:\s*600/);
  });

  it("is a <label> only when it has a control to point at", () => {
    // ⚠ A `<label>` WRAPPING A PILL ROW WOULD MAKE THE WORD CLICK THE FIRST OPTION, which is why
    // `htmlFor` decides the element rather than a second prop.
    const { rerender } = render(
      <FormSection label="Model">
        <span>control</span>
      </FormSection>
    );
    expect(screen.getByText("Model").tagName).toBe("SPAN");
    rerender(
      <FormSection label="Model" htmlFor="m">
        <input id="m" aria-label="Model field" />
      </FormSection>
    );
    expect(screen.getByText("Model").tagName).toBe("LABEL");
  });

  it("keeps a caption INSIDE the label, muted and one line", () => {
    render(
      <FormSection label="Runtime" caption="not connected">
        <span>control</span>
      </FormSection>
    );
    expect(screen.getByText("not connected").className).toMatch(/caption/);
    expect(rule(".caption")).toMatch(/color:\s*var\(--text-muted\)/);
  });
});

// ── 2. THE UNDERLINE ─────────────────────────────────────────────────────────

describe("UnderlineField — gray at rest, ink on focus", () => {
  function field(over: Partial<React.ComponentProps<typeof UnderlineField>> = {}) {
    render(
      <UnderlineField
        id="f"
        label="Title"
        value=""
        onChange={vi.fn()}
        ariaLabel="A title"
        {...over}
      />
    );
    return screen.getByLabelText("A title");
  }

  it("grows the black line on FOCUS and takes it back on BLUR", () => {
    const input = field();
    const line = input.parentElement as HTMLElement;
    expect(line.className).not.toMatch(/lineActive/);
    fireEvent.focus(input);
    expect(line.className).toMatch(/lineActive/);
    fireEvent.blur(input);
    expect(line.className).not.toMatch(/lineActive/);
  });

  it("draws the sweep with a TRANSFORM and honours reduced motion", () => {
    // ⚠ `transform`, NOT `width`: a width transition lays out every frame, which is the difference
    // between a sweep and a stutter. ⚠ AND REDUCED MOTION DROPS THE ANIMATION, NEVER THE STATE —
    // a field that gave no visible answer to a click is the defect that rule exists to avoid.
    expect(rule(".line::after")).toMatch(/transform:\s*scaleX\(0\)/);
    expect(rule(".lineActive::after")).toMatch(/transform:\s*scaleX\(1\)/);
    expect(css()).toMatch(/prefers-reduced-motion/);
  });

  it("is one line tall by default and a BOX when multiline — same label, same line", () => {
    const one = field();
    expect(one.tagName).toBe("INPUT");
    cleanup();
    const many = field({ multiline: true });
    expect(many.tagName).toBe("TEXTAREA");
    expect(many.className).toMatch(/inputMultiline/);
    // ⚠ THE FIXED `--action-h-sm` IS RELEASED, or the second line can never show.
    expect(rule(".inputMultiline")).toMatch(/height:\s*auto/);
  });

  it("reports every keystroke", () => {
    const onChange = vi.fn();
    fireEvent.change(field({ onChange }), { target: { value: "ship it" } });
    expect(onChange).toHaveBeenCalledWith("ship it");
  });
});

// ── 3. THE PILL ROW ──────────────────────────────────────────────────────────

describe("PillChoice — `plain` + `md`, fixed by the wrapper", () => {
  const OPTIONS = [
    { key: "a", label: "Alpha" },
    { key: "b", label: "Beta" },
  ] as const;

  it("names the tablist and marks the selected option", () => {
    render(
      <PillChoice
        label="Mode"
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        ariaLabel="Thread mode"
      />
    );
    const row = screen.getByRole("tablist", { name: "Thread mode" });
    expect(row.querySelector('[aria-selected="true"]')?.textContent).toBe("Alpha");
  });

  it("cuts every pill to `--action-h-sm`, gray-filled and BORDERLESS", () => {
    // 🔒 THE THREE HALVES OF THE RULING, ON THE RENDERED FACE: 30px (the token, never a number),
    // `--seg-fill` on the unselected pill, and NO `.seg-pill` hairline. A wrapper that stopped
    // fixing `variant`/`size` would still render pills — a different, unreviewed set of them.
    render(
      <PillChoice
        label="Mode"
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        ariaLabel="Thread mode"
      />
    );
    const unselected = screen.getByRole("tab", { name: "Beta" });
    expect(unselected.className).toContain("h-[var(--action-h-sm)]");
    expect(unselected.className).toContain("bg-[var(--seg-fill)]");
    expect(unselected.className).not.toMatch(/seg-pill/);
    // ⚠ REGULAR WEIGHT INSIDE THE PILL (Samuel: *"The text inside the pills should not be
    // bolded"*) — the bold on this row belongs to the label above it.
    expect(unselected.className).toMatch(/font-normal/);
  });

  it("leaves wrapping to the caller", () => {
    render(
      <PillChoice
        label="Mode"
        options={OPTIONS}
        value="a"
        onChange={vi.fn()}
        ariaLabel="Thread mode"
        className="flex-wrap"
      />
    );
    expect(screen.getByRole("tablist", { name: "Thread mode" }).className).toContain(
      "flex-wrap"
    );
  });
});

// ── 4. THE SHELL AND ITS FOOTER ──────────────────────────────────────────────

describe("FormDialog — one exit, two buttons, one height", () => {
  function open(primary: Partial<React.ComponentProps<typeof FormDialog>["primary"]> = {}) {
    const onDiscard = vi.fn();
    const onClick = vi.fn();
    render(
      <FormDialog
        open
        onDiscard={onDiscard}
        title="New thing"
        closeLabel="Close new thing"
        primary={{ label: "Create", onClick, ...primary }}
      >
        <p>body</p>
      </FormDialog>
    );
    return { onDiscard, onClick };
  }

  it("gives BOTH footer buttons the small-action height and an 8px radius", async () => {
    open();
    for (const name of ["Discard", "Create"]) {
      const btn = await screen.findByRole("button", { name });
      expect(btn.className).toContain("h-[var(--action-h-sm)]");
      expect(btn.className).toContain("rounded-[8px]");
    }
    // The verb is the kit's black CTA; Discard is the text face beside it.
    expect((await screen.findByRole("button", { name: "Create" })).className).toContain(
      "auth-btn-3d"
    );
  });

  it("routes the ×, the backdrop's Escape AND the Discard button to ONE callback", async () => {
    // ⚠ ONE EXIT, NOT TWO. A × that kept a draft the operator dismissed would be remembering a
    // decision they undid, and a second callback is how the two come to disagree.
    const { onDiscard } = open();
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));
    fireEvent.click(screen.getByRole("button", { name: "Close new thing" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDiscard).toHaveBeenCalledTimes(3);
  });

  it("DIMS a disabled verb and merely stops a BUSY one", async () => {
    // A control in flight has not become unavailable — dimming it would say it had.
    const { onClick } = open({ busy: true });
    const btn = (await screen.findByRole("button", { name: "Create" })) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.className).not.toMatch(/opacity-60/);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
    cleanup();
    open({ disabled: true, hint: "A thread needs a title" });
    const off = (await screen.findByRole("button", { name: "Create" })) as HTMLButtonElement;
    expect(off.className).toMatch(/opacity-60/);
    // ⚠ A DISABLED SUBMIT SAYS WHY (INVARIANTS §8, rule 4).
    expect(off.title).toBe("A thread needs a title");
  });
});
