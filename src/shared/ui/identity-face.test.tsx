// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IdentityFace } from "./identity-face";
import { IdentityStack } from "./avatar-stack";

afterEach(cleanup);

const face = () => document.querySelector("[data-identity-face]") as HTMLElement;

describe("IdentityFace", () => {
  it("renders spans only, so it nests inside a <p> without a React warning", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <p>
        <IdentityFace size="s" photo="/a.png" ring="agent-03" runtimeLogo="/claude.svg" online />
      </p>
    );
    expect(face().querySelectorAll("div")).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("rings an agent in its colour token, at the ratio's 2px", () => {
    render(<IdentityFace size="m" photo="/a.png" ring="agent-03" />);
    const ring = face().firstElementChild as HTMLElement;
    expect(ring.style.border).toBe("2px solid var(--agent-color-03)");
    expect(ring.style.padding).toBe("2px");
    expect(face().style.width).toBe("30px");
  });

  it("rings a saved identity in the raised hairline", () => {
    render(<IdentityFace size="m" photo="/a.png" ring="neutral" />);
    expect((face().firstElementChild as HTMLElement).style.border).toBe(
      "2px solid var(--raised-light-line)"
    );
  });

  it("draws the runtime badge at half size only when a ringed face has a logo", () => {
    const { rerender } = render(<IdentityFace size="m" ring="agent-01" runtimeLogo="/claude.svg" />);
    const badge = face().querySelector('img[src="/claude.svg"]')?.parentElement as HTMLElement;
    expect(badge.style.width).toBe("15px");
    expect(badge.style.right).toBe("-4.5px");
    rerender(<IdentityFace size="m" ring="agent-01" />);
    expect(face().querySelectorAll("img")).toHaveLength(0);
    rerender(<IdentityFace size="m" runtimeLogo="/claude.svg" />);
    expect(face().querySelectorAll("img")).toHaveLength(0);
  });

  it("falls back to an initial, or the profile glyph when nothing names it", () => {
    const { rerender } = render(<IdentityFace size="s" name="daniel ortiz" />);
    expect(face().textContent).toBe("D");
    rerender(<IdentityFace size="s" name="Scout" ring="agent-02" />);
    expect(face().textContent).toBe("S");
    rerender(<IdentityFace size="s" ring="neutral" />);
    expect(face().querySelector("svg")).toBeTruthy();
  });

  it("shows a presence dot only when online", () => {
    const { rerender } = render(<IdentityFace size="s" name="A" online />);
    expect(face().querySelector('[data-presence="online"]')).toBeTruthy();
    rerender(<IdentityFace size="s" name="A" />);
    expect(face().querySelector("[data-presence]")).toBeNull();
  });

  it("is decorative unless labelled", () => {
    const { rerender } = render(<IdentityFace size="s" name="A" />);
    expect(face().getAttribute("aria-hidden")).toBe("true");
    rerender(<IdentityFace size="s" name="A" label="Owner A" />);
    expect(screen.getByRole("img", { name: "Owner A" })).toBe(face());
  });
});

it("draws the scale's px, and a raw px only when given one", () => {
  const { rerender } = render(<IdentityFace size="xs" name="A" />);
  expect(face().style.width).toBe("16px");
  rerender(<IdentityFace size="s" name="A" />);
  expect(face().style.width).toBe("20px");
  rerender(<IdentityFace size="l" name="A" />);
  expect(face().style.width).toBe("40px");
  rerender(<IdentityFace size="m" px={52} name="A" />);
  expect(face().style.width).toBe("52px");
});

describe("IdentityStack", () => {
  const faces = ["Ada", "Ben", "Cy", "Dee", "Eve"].map((name) => ({ key: name, name }));

  it("overlaps the faces and counts the hidden ones", () => {
    render(<IdentityStack faces={faces} size="s" max={3} label="Assigned to five" />);
    const stack = screen.getByRole("img", { name: "Assigned to five" });
    const shown = stack.querySelectorAll("[data-identity-face]");
    expect(shown).toHaveLength(3);
    expect(shown[0].className).not.toContain("-ml-1.5");
    expect(shown[1].className).toContain("-ml-1.5");
    expect(stack.textContent).toContain("+2");
  });

  it("is decorative without a label and renders nothing when empty", () => {
    const { container, rerender } = render(<IdentityStack faces={faces.slice(0, 2)} size="s" />);
    expect((container.firstElementChild as HTMLElement).getAttribute("aria-hidden")).toBe("true");
    rerender(<IdentityStack faces={[]} size="s" />);
    expect(container.firstElementChild).toBeNull();
  });
});
