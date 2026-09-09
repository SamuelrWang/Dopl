import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BridgeRequestOpts } from "#/lib/dopl-bridge";
import { bridgeCalls, installBridge } from "#/test-utils/bridge";
import { CHANNEL_ID, renderHome, routes } from "./home-test-harness";
import {
  PIPELINE_ID,
  SHARES,
  SHARES_PATH,
  ontologyRoutes,
} from "./ontology-test-harness";

/**
 * SHARING AN ONTOLOGY INTO A HOME CHANNEL — the popup, the payload, and the
 * delete confirm that names the cascade.
 *
 * ⚠ THE PAYLOAD IS THE POINT. Three independent levels per channel is Samuel's
 * ruling stated as a row (I5), so what is asserted here is the exact body the
 * PUT carries — not that a dialog opened.
 *
 * 🔒 UNSHARING IS A ROW DELETE, NEVER THREE STORED `none`s (I4). A share row is
 * a COMPLETE statement about three audiences, so the absence of the row and the
 * triple of `none` have to be the same answer — and only one of them is
 * writable.
 */

const apiRequest = vi.hoisted(() => vi.fn());

vi.mock(
  "@/features/channels/components/channels-v2/channel-surface-standalone",
  () => ({
    StandaloneChannelSurface: () => <div data-testid="channel-surface" />,
  })
);

/** `undefined` = the harness default (`canManage: true`). */
let shares: unknown;

beforeEach(() => {
  shares = undefined;
  apiRequest.mockReset();
  apiRequest.mockImplementation(
    (path: string, opts: BridgeRequestOpts = {}) =>
      ontologyRoutes(path, opts, shares ?? SHARES) ??
      routes(path, opts) ??
      Promise.reject(new Error(`unexpected: ${path}`))
  );
  installBridge({ apiRequest });
});

async function openShare(): Promise<void> {
  await screen.findByRole("tab", { name: "Overview" });
  fireEvent.click(screen.getByText("Ontology"));
  const name = await screen.findByText("Pipeline");
  const card = name.parentElement as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Share" }));
  await screen.findByRole("dialog", { name: /Share Pipeline/i });
}

describe("the popup", () => {
  it("shows one row per HOME CHANNEL, at the levels the server stored", async () => {
    renderHome();
    await openShare();

    // The channel comes off `GET /api/home/channels` — the read the page has
    // already mounted, so the popup asks for nothing new.
    expect(
      await screen.findByRole("tablist", { name: "Members in Priya Shah" })
    ).toBeInTheDocument();

    const members = screen.getByRole("tablist", { name: "Members in Priya Shah" });
    expect(within(members).getByRole("tab", { name: "View" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const guests = screen.getByRole("tablist", { name: "Guests in Priya Shah" });
    expect(within(guests).getByRole("tab", { name: "None" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    const agents = screen.getByRole("tablist", {
      name: "My agents in Priya Shah",
    });
    expect(within(agents).getByRole("tab", { name: "Edit" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });

  it("offers the LADDER, in order, and nothing else", async () => {
    // ⚠ THE ORDER IS THE LADDER (`none < view < edit`, I2) and the roster is
    // DERIVED from `ONTOLOGY_LEVELS`, so a fourth spelling of a stored level
    // cannot reach a control that then writes it.
    renderHome();
    await openShare();

    const members = await screen.findByRole("tablist", {
      name: "Members in Priya Shah",
    });
    expect(
      within(members)
        .getAllByRole("tab")
        .map((tab) => tab.textContent)
    ).toEqual(["None", "View", "Edit"]);
  });

  it("PUTs the WHOLE triple for the channel that moved, and only that one", async () => {
    renderHome();
    await openShare();

    const guests = await screen.findByRole("tablist", {
      name: "Guests in Priya Shah",
    });
    fireEvent.click(within(guests).getByRole("tab", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const writes = bridgeCalls(apiRequest).filter((c) =>
        c.path.startsWith(SHARES_PATH)
      );
      const put = writes.find((c) => c.opts.method === "PUT");
      expect(put?.opts.body).toEqual({
        channelId: CHANNEL_ID,
        membersLevel: "view",
        guestsLevel: "view",
        ownerAgentsLevel: "edit",
      });
      expect(writes.filter((c) => c.opts.method === "PUT")).toHaveLength(1);
    });
  });

  it("writes NOTHING when nothing moved", async () => {
    renderHome();
    await openShare();
    await screen.findByRole("tablist", { name: "Members in Priya Shah" });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    // ⚠ THE READ IS NOT A WRITE — the bridge stamps `method: "GET"` on every
    // call, so the filter names the two write verbs rather than "not undefined".
    expect(
      bridgeCalls(apiRequest).filter(
        (c) =>
          c.path.startsWith(SHARES_PATH) &&
          (c.opts.method === "PUT" || c.opts.method === "DELETE")
      )
    ).toHaveLength(0);
  });

  it("🔒 UNSHARES WITH A DELETE when all three fall to `none` — never three stored nones", async () => {
    renderHome();
    await openShare();

    for (const label of ["Members", "Guests", "My agents"]) {
      const row = await screen.findByRole("tablist", {
        name: `${label} in Priya Shah`,
      });
      fireEvent.click(within(row).getByRole("tab", { name: "None" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const writes = bridgeCalls(apiRequest).filter((c) =>
        c.path.startsWith(SHARES_PATH)
      );
      expect(writes.some((c) => c.opts.method === "DELETE")).toBe(true);
      expect(writes.some((c) => c.opts.method === "PUT")).toBe(false);
    });
  });
});

describe("read-only", () => {
  it("🔒 renders the SUMMARY and no control when the server says canManage is false", async () => {
    // 🔒 `canManage` IS THE SERVER'S, the same predicate the write applies — so
    // the dialog cannot offer an editor the PUT will refuse.
    shares = { ...SHARES, canManage: false };
    renderHome();
    await openShare();

    expect(
      await screen.findByText(
        "Members: view · Guests: none · My agents: edit"
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tablist", { name: "Members in Priya Shah" })
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

describe("deleting", () => {
  it("NAMES the channels the delete unshares from", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.click(screen.getByText("Ontology"));
    const card = (await screen.findByText("Pipeline")).parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));

    expect(
      await screen.findByText(/unshares it from Priya Shah/)
    ).toBeInTheDocument();
  });

  it("DELETEs the cluster once confirmed", async () => {
    renderHome();
    await screen.findByRole("tab", { name: "Overview" });
    fireEvent.click(screen.getByText("Ontology"));
    const card = (await screen.findByText("Pipeline")).parentElement as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Delete" }));
    await screen.findByText(/unshares it from Priya Shah/);

    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" })
    );

    await waitFor(() => {
      expect(
        bridgeCalls(apiRequest).some(
          (c) =>
            c.path === `/api/ontology/clusters/${PIPELINE_ID}` &&
            c.opts.method === "DELETE"
        )
      ).toBe(true);
    });
  });
});
