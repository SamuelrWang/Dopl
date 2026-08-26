// @vitest-environment jsdom
/**
 * THE CHANNEL KNOWLEDGE TAB — one component, both sides (Home Knowledge Panels
 * M4, §5.5).
 *
 * ⚠ THE TRANSPORT IS MOCKED, NOT THE HOOKS. Everything between the click and
 * `apiRequest` is the real thing — the real paths, the real cache keys, the real
 * `select` (stale-cache fallbacks included) and the real mutation config. A test
 * that stubbed `use-channel-knowledge.ts` would assert that a component renders
 * an array, which is not what this milestone had to buy. What it had to buy is
 * that **the surface never issues a request it will get 403 on**, and that means
 * the URLs are part of what is under test.
 *
 * ⚠ WHY THERE IS NO SEPARATE "GUEST" RENDER CASE. There is one component and it
 * takes no viewer argument: the operator on /home and a link-claimed guest on
 * `/c` mount THESE reads with THESE props. What differs between the two hosts is
 * one capability flag, and that is pinned where it is written — the two hosts'
 * own source (last describe below), the pass-through in
 * `channel-surface.test.tsx`, and the tab row in `info-panel.test.tsx`. Faking a
 * "guest" by re-rendering the same component with the same props would prove
 * nothing except that React is deterministic.
 *
 * ⚠ MUTATION-VERIFY: point any read at `/api/knowledge/**` and the URL case
 * fails; drop `canEdit` from the entry view and the read-only case draws a pen;
 * drop `expectedVersion` from the save and the CAS case fails; revert the
 * `channelId` reset effect and the channel-switch case keeps the stale base.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { request } = vi.hoisted(() => ({
  request: vi.fn<(path: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@/shared/api/api-client", async () => {
  const envelope = await import("@/shared/api/api-envelope");
  return { ...envelope, apiRequest: request };
});
vi.mock("@/shared/ui/toast", () => ({ toast: vi.fn() }));

import { stripComments } from "@/shared/auth/route-floor-parser";
import { ChannelKnowledgeTab, groupEntries } from "./knowledge-tab";
import type {
  KnowledgeBase,
  KnowledgeEntry,
  KnowledgeFolder,
} from "@/features/knowledge/types";

const CHANNEL = "44444444-4444-4444-8444-444444444444";
const WS = "33333333-3333-4333-8333-333333333333";
const BASE = "55555555-5555-4555-8555-555555555555";

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: BASE,
    name: "Handbook",
    description: "How we work together",
    workspaceId: WS,
    ...over,
  } as KnowledgeBase;
}

function folder(over: Partial<KnowledgeFolder> = {}): KnowledgeFolder {
  return {
    id: "f-1",
    knowledgeBaseId: BASE,
    parentId: null,
    name: "Policies",
    position: 0,
    ...over,
  } as KnowledgeFolder;
}

function entry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    id: "e-1",
    knowledgeBaseId: BASE,
    folderId: null,
    title: "Working hours",
    excerpt: null,
    body: "We start at **nine**.",
    position: 0,
    updatedAt: "2026-08-20T10:00:00.000Z",
    ...over,
  } as KnowledgeEntry;
}

/** Payloads this run answers with, keyed by the shape of the path. */
interface Lane {
  bases?: unknown;
  tree?: unknown;
  entry?: unknown;
  /** Per-entry override, for the cases where WHICH entry is the point. */
  entriesById?: Record<string, unknown>;
}
let lane: Lane = {};

function answer(path: string): unknown {
  if (path.endsWith("/knowledge/bases")) return lane.bases;
  if (path.includes("/knowledge/bases/")) return lane.tree;
  if (path.includes("/knowledge/entries/")) {
    const id = path.slice(path.lastIndexOf("/") + 1);
    return lane.entriesById?.[id] ?? lane.entry;
  }
  throw new Error(`the tab asked for an unexpected path: ${path}`);
}

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (path) => {
    const body = answer(path);
    if (body === undefined) throw new Error(`no fixture for ${path}`);
    return body;
  });
  lane = {
    bases: { bases: [base()], grants: { [BASE]: { level: "visible", guestWrite: false } } },
    tree: { base: base(), folders: [], entries: [entry()] },
    entry: { entry: entry() },
  };
});
afterEach(cleanup);

function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChannelKnowledgeTab channelId={CHANNEL} workspaceId={WS} />
    </QueryClientProvider>
  );
}

/** Every path the tab actually requested this run. */
function requested(): string[] {
  return request.mock.calls.map(([path]) => path);
}

describe("the granted list", () => {
  it("lists the bases the channel was granted, with their descriptions", async () => {
    lane.bases = {
      bases: [base(), base({ id: "b-2", name: "Brand", description: null })],
      grants: {},
    };
    mount();
    expect(await screen.findByText("Handbook")).toBeTruthy();
    expect(screen.getByText("How we work together")).toBeTruthy();
    expect(screen.getByText("Brand")).toBeTruthy();
  });

  it("reads the CHANNEL lane — the one route family a guest is not 403'd on", async () => {
    mount();
    await screen.findByText("Handbook");
    expect(requested()).toEqual([
      `/api/channels/${CHANNEL}/knowledge/bases`,
    ]);
    // The workspace routes are at the viewer default; a guest's role resolves to
    // no access level at all, so one of these would be a permanent 403.
    expect(requested().some((p) => p.startsWith("/api/knowledge"))).toBe(false);
  });

  it("says so in ONE sentence when nothing is shared", async () => {
    lane.bases = { bases: [], grants: {} };
    mount();
    expect(
      await screen.findByText("Nothing has been shared into this channel yet.")
    ).toBeTruthy();
  });

  it("survives a §8 stale cache — the payload's keys are GONE, not empty", async () => {
    lane.bases = {};
    mount();
    // Renders the empty state rather than throwing on `undefined.map`, which is
    // what blanks a pane on the first paint after an upgrade.
    expect(
      await screen.findByText("Nothing has been shared into this channel yet.")
    ).toBeTruthy();
  });

  it("offers a retry, and says the read failed rather than that nothing is shared", async () => {
    request.mockRejectedValue(new Error("offline"));
    mount();
    expect(await screen.findByText("Couldn't load shared knowledge.")).toBeTruthy();
    // ⚠ The two sentences are different on purpose: "we could not ask" and
    // "the answer is nothing" are not the same claim (INVARIANTS §11).
    expect(
      screen.queryByText("Nothing has been shared into this channel yet.")
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("open → tree → entry", () => {
  it("walks down to one entry's body and back up again", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    // The tree: base name as the heading, the entry as a row.
    expect(await screen.findByRole("heading", { name: "Handbook" })).toBeTruthy();
    fireEvent.click(screen.getByText("Working hours"));
    // The body is MARKDOWN, LEXED to elements — never printed raw and never
    // handed to the DOM as an HTML string (`message-markdown.tsx`, rule 1).
    expect(await screen.findByText("nine")).toBeTruthy();
    expect(screen.queryByText("We start at **nine**.")).toBeNull();

    // Back to the base, then back to the list.
    fireEvent.click(screen.getByRole("button", { name: /Handbook/ }));
    expect(await screen.findByText("Working hours")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Shared knowledge/ }));
    expect(await screen.findByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("asks the lane for the tree and the entry, and nothing else", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByText("Working hours"));
    await screen.findByText("nine");
    expect(requested()).toEqual([
      `/api/channels/${CHANNEL}/knowledge/bases`,
      `/api/channels/${CHANNEL}/knowledge/bases/${BASE}/tree`,
      `/api/channels/${CHANNEL}/knowledge/entries/e-1`,
    ]);
  });

  it("groups entries under their folder and leaves the root ungrouped", async () => {
    lane.tree = {
      base: base(),
      folders: [folder()],
      entries: [entry(), entry({ id: "e-2", title: "Expenses", folderId: "f-1" })],
    };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByText("Working hours")).toBeTruthy();
    expect(screen.getByText("Policies")).toBeTruthy();
    expect(screen.getByText("Expenses")).toBeTruthy();
  });

  it("renders an empty base as empty, on a §8 stale tree with no key at all", async () => {
    lane.tree = { base: base() };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByText("This knowledge base is empty.")).toBeTruthy();
  });
});

describe("the edit path — `guestWrite` decides, on both sides", () => {
  it("draws NO pen on a read-only grant", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByText("Working hours"));
    await screen.findByText("nine");
    // ⚠ Absent, not disabled: the save would come back 403
    // `CHANNEL_GRANT_READ_ONLY`, and a control that cannot be used is a question
    // the reader has to answer.
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("saves through the lane PUT, carrying the entry's own version as the CAS token", async () => {
    lane.bases = {
      bases: [base()],
      grants: { [BASE]: { level: "visible", guestWrite: true } },
    };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByText("Working hours"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const box = screen.getByLabelText("Entry body") as HTMLTextAreaElement;
    expect(box.value).toBe("We start at **nine**.");
    fireEvent.change(box, { target: { value: "We start at **ten**." } });

    lane.entry = { entry: entry({ body: "We start at **ten**.", updatedAt: "2026-08-21T10:00:00.000Z" }) };
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const put = request.mock.calls.find(([, opts]) => opts?.method === "PUT");
      expect(put).toBeTruthy();
      expect(put![0]).toBe(`/api/channels/${CHANNEL}/knowledge/entries/e-1`);
      expect(put![1]).toMatchObject({
        method: "PUT",
        workspaceId: WS,
        body: {
          body: "We start at **ten**.",
          expectedVersion: "2026-08-20T10:00:00.000Z",
        },
      });
    });
    // The editor closes on the ACCEPTED write, and the reconciled body is what
    // is shown — never the buffer that was typed at the server.
    expect(await screen.findByText("ten")).toBeTruthy();
  });

  it("does NOT carry an open edit buffer to the NEXT entry", async () => {
    // ⚠ This component is not remounted between entries — same position in the
    // tree — so a buffer that did not carry its own entry id would be shown over
    // the next entry's title, and a save would write one document's text into
    // another one's row.
    lane.bases = {
      bases: [base()],
      grants: { [BASE]: { level: "visible", guestWrite: true } },
    };
    lane.tree = {
      base: base(),
      folders: [],
      entries: [entry(), entry({ id: "e-2", title: "Expenses" })],
    };
    lane.entriesById = {
      "e-1": { entry: entry() },
      "e-2": { entry: entry({ id: "e-2", title: "Expenses", body: "Receipts." }) },
    };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByText("Working hours"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Entry body"), {
      target: { value: "NOT THIS ENTRY'S TEXT" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Handbook/ }));
    fireEvent.click(await screen.findByText("Expenses"));

    expect(await screen.findByText("Receipts.")).toBeTruthy();
    expect(screen.queryByLabelText("Entry body")).toBeNull();
    expect(screen.queryByText("NOT THIS ENTRY'S TEXT")).toBeNull();
  });

  it("keeps the buffer when the save is refused, so nothing typed is thrown away", async () => {
    lane.bases = {
      bases: [base()],
      grants: { [BASE]: { level: "visible", guestWrite: true } },
    };
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    fireEvent.click(await screen.findByText("Working hours"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Entry body"), {
      target: { value: "half a sentence" },
    });
    request.mockRejectedValueOnce(new Error("412"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Entry body") as HTMLTextAreaElement).value
      ).toBe("half a sentence")
    );
  });
});

describe("switching channels under one mounted surface", () => {
  it("drops the open base — its ids belong to the channel that was left", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ChannelKnowledgeTab channelId={CHANNEL} workspaceId={WS} />
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(await screen.findByRole("heading", { name: "Handbook" })).toBeTruthy();

    const OTHER = "66666666-6666-4666-8666-666666666666";
    view.rerender(
      <QueryClientProvider client={client}>
        <ChannelKnowledgeTab channelId={OTHER} workspaceId={WS} />
      </QueryClientProvider>
    );
    // Back at the list — and reading the NEW channel's lane, not the old one's.
    expect(await screen.findByRole("button", { name: "Open" })).toBeTruthy();
    expect(requested()).toContain(`/api/channels/${OTHER}/knowledge/bases`);
  });
});

describe("groupEntries — the flat payload, grouped honestly", () => {
  it("names a nested folder by its FULL path, so two 'Notes' are not one heading", () => {
    const groups = groupEntries(
      [
        folder({ id: "a", name: "Team" }),
        folder({ id: "b", name: "Notes", parentId: "a" }),
      ],
      [entry({ id: "e-9", folderId: "b" })]
    );
    expect(groups.map((g) => g.path)).toEqual(["Team / Notes"]);
  });

  it("puts the root group first", () => {
    const groups = groupEntries(
      [folder({ id: "a", name: "Team" })],
      [entry({ id: "e-1", folderId: "a" }), entry({ id: "e-2", folderId: null })]
    );
    expect(groups[0].path).toBe("");
    expect(groups[0].entries.map((e) => e.id)).toEqual(["e-2"]);
  });

  it("falls an orphaned entry to the root rather than dropping it", () => {
    // A dropped row is the one failure the reader cannot see.
    const groups = groupEntries([], [entry({ id: "e-1", folderId: "gone" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["e-1"]);
  });

  it("terminates on a cycle in the payload", () => {
    // The walk runs over data the client did not build; a cycle would hang the
    // render, which is a blank screen with no error anywhere.
    const groups = groupEntries(
      [
        folder({ id: "a", name: "A", parentId: "b" }),
        folder({ id: "b", name: "B", parentId: "a" }),
      ],
      [entry({ id: "e-1", folderId: "a" })]
    );
    expect(groups).toHaveLength(1);
  });
});

/**
 * 🔒 THE TWO HOSTS THAT TURN IT ON, read out of their own source.
 *
 * The milestone's claim is "the guest sees exactly what the operator sees in
 * that tab", and it rests on both hosts passing the SAME capability. A render
 * test cannot see that — each host renders in a different tree — and a host that
 * silently lost the flag would ship a tab the operator has and the guest does
 * not, with nothing failing.
 */
describe("the capability, at both hosts", () => {
  const ROOT = join(import.meta.dirname, "../../../../..");
  const HOSTS = [
    "apps/desktop-ui/src/pages/home/relationship-record.tsx",
    "src/app/c/[workspaceId]/guest-channel.tsx",
  ];

  /** ⚠ COMMENTS STRIPPED. Both hosts EXPLAIN the flag in a docblock right above
   *  it, so a raw source scan stays green when the line itself is deleted — the
   *  exact mutation this pin exists to catch. Measured: without this, reverting
   *  either host is VACUOUS. */
  const codeOf = (rel: string): string =>
    stripComments(readFileSync(join(ROOT, rel), "utf8"));

  it.each(HOSTS)("%s passes `knowledge: true`", (rel) => {
    expect(codeOf(rel)).toMatch(/knowledge:\s*true/);
  });

  it("and the WORKSPACE channel page still does not (this wave, by decision)", () => {
    expect(
      codeOf("src/features/channels/components/channels-v2/channels-v2-core.tsx")
    ).not.toMatch(/knowledge:\s*true/);
  });
});
