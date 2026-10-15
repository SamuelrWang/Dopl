// @vitest-environment jsdom
/**
 * `GlassSlot` must ALWAYS land its content in the glass slot (2026-10-14: a
 * one-shot lookup lost the race with the auth layout and the installer never
 * mounted — slot present, 0 children). Pins the three recoveries.
 */

import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { useSlotFilled } from "@/shared/layout/auth-split/glass-tilt";
import { GlassSlot } from "./glass-slot";

const ID = "test-glass-slot";

function addSlot(): HTMLDivElement {
  const el = document.createElement("div");
  el.id = ID;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  cleanup();
  document.getElementById(ID)?.remove();
});

describe("GlassSlot", () => {
  it("portals into a slot that already exists", async () => {
    const slot = addSlot();
    render(
      <GlassSlot id={ID}>
        <div className="payload" />
      </GlassSlot>,
    );
    await waitFor(() => expect(slot.querySelector(".payload")).not.toBeNull());
  });

  it("mounts once a LATE slot appears (the race that hid the installer)", async () => {
    render(
      <GlassSlot id={ID}>
        <div className="payload" />
      </GlassSlot>,
    );
    // A few frames with no slot: nothing anywhere, nothing thrown.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(document.querySelector(".payload")).toBeNull();

    let slot!: HTMLDivElement;
    act(() => {
      slot = addSlot();
    });
    await waitFor(() => expect(slot.querySelector(".payload")).not.toBeNull());
  });

  it("re-targets when the slot node is REPLACED", async () => {
    const first = addSlot();
    render(
      <GlassSlot id={ID}>
        <div className="payload" />
      </GlassSlot>,
    );
    await waitFor(() => expect(first.querySelector(".payload")).not.toBeNull());

    const second = document.createElement("div");
    act(() => {
      first.remove();
      second.id = ID;
      document.body.appendChild(second);
    });
    await waitFor(() => expect(second.querySelector(".payload")).not.toBeNull());
  });

  it("refills a slot that was emptied behind React's back", async () => {
    const slot = addSlot();
    render(
      <GlassSlot id={ID}>
        <div className="payload" />
      </GlassSlot>,
    );
    await waitFor(() => expect(slot.querySelector(".payload")).not.toBeNull());

    act(() => slot.replaceChildren());
    await waitFor(() => expect(slot.querySelector(".payload")).not.toBeNull());
    // One host node, re-appended — not a second copy.
    expect(slot.childElementCount).toBe(1);
    expect(slot.querySelectorAll(".payload")).toHaveLength(1);
  });

  it("still trips the layout's tilt opt-in (`useSlotFilled`) through the host node", async () => {
    function Panel() {
      const ref = useRef<HTMLDivElement>(null);
      const filled = useSlotFilled(ref);
      return (
        <>
          <div ref={ref} id={ID} />
          <span data-filled={String(filled)} />
        </>
      );
    }
    const { container } = render(
      <>
        <Panel />
        <GlassSlot id={ID}>
          <div className="payload" />
        </GlassSlot>
      </>,
    );
    await waitFor(() =>
      expect(container.querySelector("[data-filled]")?.getAttribute("data-filled")).toBe("true"),
    );
    expect(document.getElementById(ID)?.querySelector(".payload")).not.toBeNull();
  });
});
