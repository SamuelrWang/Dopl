// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaCard } from "./meta-card";

/**
 * The base overview's Details card, pinned at the STORAGE row it just grew.
 *
 * Same three-state contract the home grid follows, and it is the whole reason
 * the meter is a shared component rather than two hand-placed bars: a base
 * reading "full" on its card and "fine" on its overview would be worse than
 * showing neither. Unknown on EITHER half renders nothing at all — never an
 * empty track, which would read as "0 bytes used" to anyone looking at it.
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
    // The default for every caller that has not been threaded yet.
    renderCard();
    expect(screen.queryByText("Storage")).toBeNull();
  });

  it("shows the frozen note at the cap, not one byte later", () => {
    // `used >= limit` IS the entitlement verdict here: the write gate refuses
    // when `used + delta > limit`, so at exactly the cap every growth is
    // already refused.
    renderCard({ storageBytes: 5_000_000, storageLimit: 5_000_000 });
    const note = screen.getByText(/Nothing was deleted/);
    expect(note.textContent).toContain("Upgrade for more room");
    expect(note.textContent).toContain("still works");
  });

  it("shows no note while there is room left", () => {
    renderCard({ storageBytes: 4_999_999, storageLimit: 5_000_000 });
    expect(screen.queryByText(/Nothing was deleted/)).toBeNull();
  });

  it("leaves the rest of the Details card exactly as it was", () => {
    renderCard({ storageBytes: 1_250_000, storageLimit: 5_000_000 });
    expect(screen.getByText("12 August 2026")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("Only you")).toBeTruthy();
  });
});
