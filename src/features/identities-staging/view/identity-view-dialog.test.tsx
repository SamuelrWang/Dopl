// @vitest-environment jsdom
//
// The view popup is client-only (a portal opened by a click), so `curl` on /playground/identities
// proves the PAGE renders and says nothing about the popup. This is the cheapest honest proof that
// it mounts, that all four tabs switch, and that Edit hands over rather than editing in place.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IdentityViewDialog } from "./identity-view-dialog";
import { SEED_IDENTITIES, STAGING_CATALOGS, identityCardFace, identityCardStats } from "../data";

const tick = async (ms = 400) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

/** "Coder": instructions, two knowledge refs, fields, a runtime, and one running agent. */
const CODER = SEED_IDENTITIES.find((i) => i.id === "id-coder")!;

function open(onEdit = () => {}) {
  return render(
    <IdentityViewDialog
      identity={CODER}
      face={identityCardFace(CODER)}
      stats={identityCardStats(CODER)}
      marker={null}
      catalogs={STAGING_CATALOGS}
      onClose={() => {}}
      onEdit={onEdit}
    />
  );
}

describe("the identity view popup", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens read-only on Identity, and every tab switches", async () => {
    vi.useFakeTimers();
    open();
    await tick();

    // Read-only: the popup holds no text input anywhere, on any tab.
    const noFields = () => {
      expect(document.querySelectorAll("input, textarea").length).toBe(0);
    };

    expect(screen.getByRole("dialog", { name: "Coder" })).toBeTruthy();
    // Tab 1 shows the real row: its instructions and its knowledge.
    expect(screen.getByText(/read INVARIANTS first/)).toBeTruthy();
    noFields();

    for (const [tab, probe] of [
      ["Tools and rules", /Never push to master/],
      ["Activity", /Rebuilt the identity card/],
      ["Running", /Card overhaul/],
    ] as const) {
      fireEvent.click(screen.getByRole("tab", { name: new RegExp(tab) }));
      await tick();
      expect(screen.getByText(probe)).toBeTruthy();
      noFields();
    }
  });

  it("Edit hands the row over instead of editing in place", async () => {
    vi.useFakeTimers();
    const onEdit = vi.fn();
    open(onEdit);
    await tick();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});
