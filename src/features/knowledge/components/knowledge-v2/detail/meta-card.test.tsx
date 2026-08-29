// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaCard } from "./meta-card";

/**
 * Details card STORAGE row. Same three-state contract as the home grid — the
 * reason the meter is ONE shared component: a base reading "full" on its card
 * and "fine" on its overview is worse than showing neither. ⚠ Unknown on
 * EITHER half renders nothing, never an empty track (reads as "0 bytes used").
 */

afterEach(cleanup);

function renderCard(over: Partial<React.ComponentProps<typeof MetaCard>> = {}) {
  render(
    <MetaCard
      name="Product specs"
      description="What we ship"
      canEdit
      onNameChange={vi.fn()}
      onDescriptionChange={vi.fn()}
      onFlush={vi.fn()}
      createdAt="1 January 2026"
      updatedAt="12 August 2026"
      scopeLabel="Private"
      accessLabel="Only you"
      {...over}
    />
  );
}

describe("MetaCard storage meter", () => {
  it("renders used against the plan cap in human bytes", () => {
    renderCard({ storageBytes: 1_250_000, storageLimit: 5_000_000 });
    expect(screen.getByText("Storage")).toBeTruthy();
    expect(screen.getByText("1.3 MB / 5 MB")).toBeTruthy();
  });

  it("renders an empty bar for a real zero", () => {
    renderCard({ storageBytes: 0, storageLimit: 5_000_000 });
    expect(screen.getByText("0 B / 5 MB")).toBeTruthy();
  });

  it("renders NOTHING when the counter is unknown", () => {
    renderCard({ storageBytes: null, storageLimit: 5_000_000 });
    expect(screen.queryByText("Storage")).toBeNull();
  });

  it("renders NOTHING when the cap is unknown", () => {
    renderCard({ storageBytes: 1_250_000, storageLimit: null });
    expect(screen.queryByText("Storage")).toBeNull();
  });

  it("renders NOTHING when neither was passed at all", () => {
    renderCard();
    expect(screen.queryByText("Storage")).toBeNull();
  });

  it("shows the frozen note at the cap, not one byte later", () => {
    // `used >= limit` IS the entitlement verdict: the write gate refuses when
    // `used + delta > limit`, so at the cap every growth is already refused.
    renderCard({ storageBytes: 5_000_000, storageLimit: 5_000_000 });
    const note = screen.getByText(/Nothing was deleted/);
    expect(note.textContent).toContain("Upgrade for more room");
    expect(note.textContent).toContain("still works");
  });

  it("shows no note while there is room left", () => {
    renderCard({ storageBytes: 4_999_999, storageLimit: 5_000_000 });
    expect(screen.queryByText(/Nothing was deleted/)).toBeNull();
  });

  it("🔒 keeps the description field inside the section", () => {
    // 🔒 Samuel's live review, 2026-08-28: the textarea overflowed its card
    // with the resize handle on the border. The containment is a THREE-part
    // chain and this pins the half that lives in the markup — `RAISED_INPUT`'s
    // `w-full` plus the module's capped block. The CSS half (`resize: none`,
    // `max-width`, the parent's `min-width: 0`) is pinned in
    // `../layout-rules.test.ts`, because jsdom has no layout to overflow.
    renderCard();
    const field = screen.getByPlaceholderText(/What's in this knowledge base/);
    expect(field.tagName).toBe("TEXTAREA");
    expect(field.className).toContain("w-full");
    expect(field.className).toContain("fieldBlock");
  });

  it("leaves the rest of the Details card exactly as it was", () => {
    renderCard({ storageBytes: 1_250_000, storageLimit: 5_000_000 });
    expect(screen.getByText("12 August 2026")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Only you")).toBeTruthy();
  });
});
