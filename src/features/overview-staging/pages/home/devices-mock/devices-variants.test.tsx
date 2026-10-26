// @vitest-environment jsdom
//
// ITEM 4E: the three variants, measured in BOTH states (hosts present, and none) and against the
// three defects Samuel's screenshot showed. `curl` proves the section renders; it cannot prove
// that a variant stopped repeating `Dopl · Claude` under every agent or that the caps-labels are
// gone, and those are the actual asks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEVICES_MOCK } from "@/features/overview-staging/overview-mock-data";
import { DevicesBands } from "./devices-variant-bands";
import { DevicesTree } from "./devices-variant-tree";
import { DevicesPanes } from "./devices-variant-panes";
import { DevicesCards } from "./devices-variant-cards";
import { VARIANT_OPTIONS, type HostHandlers } from "./devices-variant-types";

const handlers: HostHandlers = {
  onRename: vi.fn(),
  onRemove: vi.fn(),
  onRenameEndpoint: vi.fn(),
  onRemoveEndpoint: vi.fn(),
};

const VARIANTS = [
  { key: "bands", Render: DevicesBands },
  { key: "tree", Render: DevicesTree },
  { key: "panes", Render: DevicesPanes },
  { key: "cards", Render: DevicesCards },
] as const;

const hosts = DEVICES_MOCK.hosts;
const firstHost = hosts[0];

describe("every variant is a complete answer", () => {
  afterEach(cleanup);

  it("offers exactly the variants the switcher names", () => {
    expect(VARIANT_OPTIONS.map((v) => v.key)).toEqual(VARIANTS.map((v) => v.key));
  });

  for (const { key, Render } of VARIANTS) {
    describe(key, () => {
      it("names every computer, and the selected one's agents and reaches", () => {
        render(<Render hosts={hosts} handlers={handlers} />);
        // Question 1 of the 5-second test: what computers exist. All of them, in every variant.
        for (const host of hosts) {
          expect(screen.getAllByText(host.name).length).toBeGreaterThan(0);
        }
        // Questions 2 and 3: what runs on it, what it reaches. `panes` shows one host at a time by
        // design, so the FIRST host is the one every variant must be able to answer for.
        for (const agent of firstHost.agents) {
          expect(screen.getAllByText(agent.name).length).toBeGreaterThan(0);
        }
        for (const ep of firstHost.endpoints) {
          expect(screen.getAllByText(ep.name).length).toBeGreaterThan(0);
        }
      });

      it("drops the repeated meta and the caps-labels (the screenshot's defects)", () => {
        const { container } = render(<Render hosts={hosts} handlers={handlers} />);
        const text = container.textContent ?? "";
        // ⚠ The runtime is the BADGE on the agent's face now. A variant that prints it again in
        // the row text has re-introduced the defect this round exists to remove.
        expect(text).not.toContain("Dopl · Claude");
        // Ownership is the variant's own mechanism; a floating caps-label is not a mechanism.
        expect(text).not.toContain("AGENTS");
        expect(text).not.toContain("REACHES");
        // The host spec is ONE demoted string, so the four-fact version must be absent.
        expect(text).not.toContain("This computer · ");
      });

      it("survives the empty state without inventing a host", () => {
        render(<Render hosts={[]} handlers={handlers} />);
        expect(screen.getByText(/No devices|Nothing running/)).toBeTruthy();
      });
    });
  }

  describe("cards (D) speaks the design language", () => {
    it("shows Connected pills and monospace function chips, not decoration", () => {
      render(<DevicesCards hosts={hosts} handlers={handlers} />);
      expect(screen.getAllByText("Connected").length).toBeGreaterThan(0);
      // The G2's real functions, as chips under the device.
      const fns = screen.getByRole("list", { name: "Even G2 functions" });
      expect(fns.textContent).toBe("displaymictouch");
      expect(screen.getByLabelText("Battery 64%")).toBeTruthy();
    });

    it("wears the identity face (photo + runtime badge) on every agent", () => {
      const { container } = render(<DevicesCards hosts={hosts} handlers={handlers} />);
      const shown = hosts.flatMap((h) => h.agents.slice(0, 3));
      // Each PairedAvatar draws the owner photo and the runtime logo: two images per agent.
      expect(container.querySelectorAll(".dvd-row img").length).toBe(shown.length * 2);
    });

    it("drops rows past the cap rather than shrinking them", () => {
      const crowded = [
        {
          ...firstHost,
          agents: [1, 2, 3, 4, 5].map((n) => ({ ...firstHost.agents[0], id: `x${n}`, name: `Agent ${n}` })),
        },
      ];
      render(<DevicesCards hosts={crowded} handlers={handlers} />);
      expect(screen.queryByText("Agent 4")).toBeNull();
      expect(screen.getByText("2 more")).toBeTruthy();
    });
  });
});
