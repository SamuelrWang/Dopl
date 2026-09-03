/**
 * `dopl_search(scope="everywhere")` — THE FAN-OUT, and the three things about it
 * that are decisions rather than mechanics:
 *
 *   1. **PER-LEG BILLING** (Samuel's ruling Q3 (b), 2026-08-28). One tool call
 *      does N workspaces' work, so it pays N times — minus the ONE the registrar
 *      already charged before the handler ran. ⚠ The exemption is matched BY ID,
 *      not by position: the resolved workspace is not always the first leg.
 *   2. **TRUNCATION IS NAMED.** A cap the result does not mention is a silent lie
 *      about coverage, and running out of credits mid-fan-out must not quietly
 *      shorten the answer.
 *   3. 🔒 **THE LEG LIST IS THE LOCKED LIST.** A container-locked session fans out
 *      over exactly its own room. `container-lock.test.ts` pins the `dopl_home`
 *      half of that rule; this pins the search half.
 *
 * ⚠ AND PROVENANCE IS STRUCTURAL: every hit renders under a per-scope heading
 * carrying the id to target with `workspace=`, and nothing is merged. A "flat,
 * deduplicated" rendering would delete the design, so the headings are asserted.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { registerSearchTool } from "./search";
import { MAX_SCOPES } from "./search-everywhere";
import type { RegisterTool, ToolResponse } from "./respond";
import type { WorkspaceDirectory } from "../workspace-directory";

function wsItem(id: string, slug: string, kind: "standard" | "link" = "standard"): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name: `${slug} workspace`,
    slug,
    publicId: `pub-${id}`,
    description: null,
    kind,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "member",
  };
}

/**
 * A home-channel CONTAINER, as a directory row. ⚠ **IT IS A DIRECTORY ROW AND
 * NOT A `GET /api/home/channels` PAYLOAD SINCE B13** — `searchLegs` derives
 * every leg from the one narrowed membership list, so a container reaches the
 * fan-out the same way a workspace does.
 */
function homeContainer(id: string, name: string): WorkspaceListItem {
  const row = wsItem(id, `${id}-seg`, "link");
  row.name = name;
  return row;
}

function directoryStub(
  workspaces: WorkspaceListItem[],
  locked: string | null = null,
): WorkspaceDirectory {
  return {
    getWorkspaceList: async () => workspaces,
    resolveWorkspaceRef: async () => null,
    lockedWorkspaceId: () => locked,
  };
}

const SKILL = {
  id: "sk-1",
  slug: "ship-it",
  name: "ship it",
  description: "Ships things.",
  whenToUse: "When shipping.",
  whenNotToUse: null,
  status: "active" as const,
  visibility: "public" as const,
  accessMode: "workspace" as const,
  folder: null,
};

function clientStub(over: Record<string, unknown> = {}) {
  return {
    getWorkspaceId: () => "ws-a",
    searchKb: vi.fn(async () => []),
    listSkills: vi.fn(async () => [SKILL]),
    getOntology: vi.fn(async () => ({ clusters: [], objects: {} })),
    listAgentTemplates: vi.fn(async () => []),
    getHomeChannels: vi.fn(async () => ({ channels: [], pendingLinks: [] })),
    ...over,
  } as unknown as DoplClient;
}

/** Drive the real registrar with all four dependencies. */
async function search(
  client: DoplClient,
  directory: WorkspaceDirectory,
  charge: (id: string) => Promise<ToolResponse | null>,
  args: Record<string, unknown>,
): Promise<string> {
  let handler: ((a: unknown) => Promise<ToolResponse>) | null = null;
  const cap = ((name: string, _d: string, _s: unknown, h: unknown) => {
    if (name === "dopl_search") handler = h as (a: unknown) => Promise<ToolResponse>;
  }) as RegisterTool;
  registerSearchTool(cap, client, directory, charge);
  if (!handler) throw new Error("dopl_search was not registered");
  const res = await (handler as (a: unknown) => Promise<ToolResponse>)(args);
  return res.content.map((c) => c.text).join("\n");
}

const noopCharge = async () => null;

// ── The default is untouched ─────────────────────────────────────────

describe("scope defaults to `here`", () => {
  it("omitting scope charges NOTHING extra and renders the single-scope result", async () => {
    const charge = vi.fn(async () => null);
    const text = await search(
      clientStub(),
      directoryStub([wsItem("ws-a", "acme"), wsItem("ws-b", "beta")]),
      charge,
      { query: "ship" },
    );
    // ⚠ The registrar already charged for the resolved workspace; a default-scope
    // call must not touch the meter again.
    expect(charge).not.toHaveBeenCalled();
    expect(text).toContain("## Skills");
    expect(text).not.toContain("Searched");
  });
});

// ── 1. Per-leg billing ───────────────────────────────────────────────

describe("per-leg billing", () => {
  it("charges every leg EXCEPT the one the registrar already paid for", async () => {
    const charge = vi.fn(async () => null);
    await search(
      clientStub({ getWorkspaceId: () => "ws-a" }),
      directoryStub([wsItem("ws-a", "acme"), wsItem("ws-b", "beta"), wsItem("ws-c", "gamma")]),
      charge,
      { query: "ship", scope: "everywhere" },
    );
    expect(charge.mock.calls.map((c) => c[0])).toEqual(["ws-b", "ws-c"]);
  });

  it("the exemption is matched by ID, not by position", async () => {
    // ⚠ The resolved workspace is whatever the session pinned — it is not
    // guaranteed to be first in the directory, and a positional exemption would
    // double-charge it while letting another leg through free.
    const charge = vi.fn(async () => null);
    await search(
      clientStub({ getWorkspaceId: () => "ws-c" }),
      directoryStub([wsItem("ws-a", "acme"), wsItem("ws-b", "beta"), wsItem("ws-c", "gamma")]),
      charge,
      { query: "ship", scope: "everywhere" },
    );
    expect(charge.mock.calls.map((c) => c[0])).toEqual(["ws-a", "ws-b"]);
  });

  it("home channels are legs too, and they are billed", async () => {
    const charge = vi.fn(async () => null);
    await search(
      clientStub({ getWorkspaceId: () => "ws-a" }),
      directoryStub([wsItem("ws-a", "acme"), homeContainer("home-1", "With Dana")]),
      charge,
      { query: "ship", scope: "everywhere" },
    );
    expect(charge.mock.calls.map((c) => c[0])).toEqual(["home-1"]);
  });

  it("charges BEFORE searching a leg — the meter gates the work", async () => {
    // ⚠ Same ordering the registrar keeps ("charge, then run"). A fan-out that
    // searched first and billed after would spend the work it could not charge
    // for, which is the failure per-leg billing exists to prevent.
    const order: string[] = [];
    const client = clientStub({
      getWorkspaceId: () => "ws-a",
      listSkills: vi.fn(async () => {
        order.push("search");
        return [];
      }),
    });
    await search(
      client,
      directoryStub([wsItem("ws-a", "acme"), wsItem("ws-b", "beta")]),
      async (id) => {
        order.push(`charge:${id}`);
        return null;
      },
      { query: "ship", scope: "everywhere" },
    );
    // leg A is exempt (already charged) → search; leg B → charge, then search.
    expect(order).toEqual(["search", "charge:ws-b", "search"]);
  });
});

// ── 2. Truncation is NAMED ───────────────────────────────────────────

describe("truncation is named, never silent", () => {
  it(`names the ${MAX_SCOPES}-scope CAP and says what was not searched`, async () => {
    const many = Array.from({ length: MAX_SCOPES + 3 }, (_, i) =>
      wsItem(`ws-${i}`, `w${i}`),
    );
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-0" }),
      directoryStub(many),
      noopCharge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain(`Searched ${MAX_SCOPES} scopes of ${MAX_SCOPES + 3}`);
    expect(text).toContain("TRUNCATED");
    expect(text).toContain(`${MAX_SCOPES}-scope cap`);
    expect(text).toContain("3 scope(s) were NOT searched");
  });

  it("says nothing about truncation when it searched everything", async () => {
    // ⚠ A warning that always fires is a warning agents skip.
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-a" }),
      directoryStub([wsItem("ws-a", "acme"), wsItem("ws-b", "beta")]),
      noopCharge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain("Searched 2 scopes of 2");
    expect(text).not.toContain("TRUNCATED");
  });

  it("RUNNING OUT OF CREDITS stops the fan-out, keeps the hits, and says so", async () => {
    const denial: ToolResponse = {
      isError: true,
      content: [{ type: "text", text: "out of MCP credits" }],
    };
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-a" }),
      directoryStub([wsItem("ws-a", "acme"), wsItem("ws-b", "beta"), wsItem("ws-c", "gamma")]),
      async (id) => (id === "ws-c" ? denial : null),
      { query: "ship", scope: "everywhere" },
    );
    // The two paid legs are still rendered — discarding them would waste credits
    // already spent.
    expect(text).toContain("acme workspace");
    expect(text).toContain("beta workspace");
    expect(text).toContain("Searched 2 scopes of 3");
    expect(text).toContain("ran out of MCP credits");
    expect(text).toContain("unknown, not empty");
  });

  it("a fan-out that searched NOTHING answers the credits refusal itself", async () => {
    // ⚠ Only when nothing was searched: a partial fan-out has real hits above it
    // and must not be replaced by an error that discards them.
    const denial: ToolResponse = {
      isError: true,
      content: [{ type: "text", text: "out of MCP credits" }],
    };
    const text = await search(
      clientStub({ getWorkspaceId: () => "nothing-matches" }),
      directoryStub([wsItem("ws-a", "acme")]),
      async () => denial,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toBe("out of MCP credits");
  });
});

// ── 3. Provenance and the lock ───────────────────────────────────────

describe("provenance is structural", () => {
  it("every scope gets its OWN heading, naming what it is and the id to target", async () => {
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-a" }),
      directoryStub([wsItem("ws-a", "acme"), homeContainer("home-1", "With Dana")]),
      noopCharge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain("## `acme workspace` (workspace · slug `acme` · id `ws-a`)");
    // ⚠ A container is rendered as a HOME CHANNEL, never as a workspace —
    // INVARIANTS §4A forbids advertising one as a workspace anywhere.
    expect(text).toContain("## `With Dana` (home channel · id `home-1`)");
    expect(text).not.toContain("With Dana` (workspace");
  });

  it("an EMPTY scope keeps its heading — searched-and-empty is not not-searched", async () => {
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-a", listSkills: vi.fn(async () => []) }),
      directoryStub([wsItem("ws-a", "acme")]),
      noopCharge,
      { query: "nothing", scope: "everywhere" },
    );
    expect(text).toContain("## `acme workspace`");
    expect(text).toContain("_No matches in this scope._");
  });

  it("a FAILED group inside one leg is named on THAT leg", async () => {
    const text = await search(
      clientStub({
        getWorkspaceId: () => "ws-a",
        listSkills: vi.fn(async () => {
          throw Object.assign(new Error("x"), { name: "DoplApiError", status: 500 });
        }),
      }),
      directoryStub([wsItem("ws-a", "acme")]),
      noopCharge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain("Skills (`HTTP 500`)");
    expect(text).toContain("1 of 4 groups could NOT be read");
  });

  it("says a wider SCOPE is not a wider DOMAIN", async () => {
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-a" }),
      directoryStub([wsItem("ws-a", "acme")]),
      noopCharge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain("A wider SCOPE is not a wider DOMAIN");
    expect(text).toContain("CHAT ARCHIVE, members, teams and channels are not searched in ANY scope");
  });

  /**
   * ⚠ **THE PARTIAL-READ CASE IT REPLACES IS GONE WITH ITS FAILURE MODE**
   * (B13). There used to be a SECOND read behind the leg list — `GET
   * /api/home/channels` — that could fail on its own and leave the home legs
   * silently unsearched, so the result carried a footnote saying so. One
   * narrowed list answers for both halves now: the legs are complete, or the
   * call has already thrown. What is asserted instead is that no half is
   * derived from a source the lock does not narrow.
   */
  it("every leg comes from the ONE narrowed list — no second read to fail", async () => {
    const getHomeChannels = vi.fn(async () => ({ channels: [] }));
    const text = await search(
      clientStub({ getWorkspaceId: () => "ws-a", getHomeChannels }),
      directoryStub([wsItem("ws-a", "acme"), homeContainer("home-1", "With Dana")]),
      noopCharge,
      { query: "ship", scope: "everywhere" },
    );
    expect(getHomeChannels).not.toHaveBeenCalled();
    expect(text).toContain("## `acme workspace`");
    expect(text).toContain("## `With Dana` (home channel · id `home-1`)");
  });
});

describe("🔒 the fan-out obeys the container lock", () => {
  it("a LOCKED session fans out over its own room ALONE", async () => {
    // ⚠ Both halves of the leg list are narrowed: `getWorkspaceList()` answers
    // `[container]` under a lock, and the home half goes through
    // `workspace-directory.ts › narrowToLock`. Neither the name nor the id of another
    // room may appear.
    // ⚠ The container's WORKSPACE name and its CHANNEL name are the same string
    // by construction (`features/home/schema.ts`: one name names both), so the
    // de-dupe keeping the directory row costs no information. The fixture says
    // so rather than inventing a disagreement the product cannot produce.
    const charge = vi.fn(async () => null);
    const locked = wsItem("home-1", "shared-c", "link");
    locked.name = "With Dana";
    const text = await search(
      clientStub({
        getWorkspaceId: () => "home-1",
        getHomeChannels: vi.fn(async () => ({
          channels: [
            homeChannel("home-1", "With Dana"),
            homeChannel("home-2", "With Sam"),
          ],
        })),
      }),
      directoryStub([locked], "home-1"),
      charge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain("## `With Dana` (home channel · id `home-1`)");
    // 🔒 Neither the NAME nor the ID of the operator's other room may appear.
    expect(text).not.toContain("With Sam");
    expect(text).not.toContain("home-2");
    expect(text).toContain("Searched 1 scope of 1");
    // The one leg is the already-charged one, so the meter is untouched.
    expect(charge).not.toHaveBeenCalled();
  });

  it("DE-DUPES a scope that is both a listed workspace and a home channel", async () => {
    // ⚠ A locked session's `getWorkspaceList()` answers `[container]` — the very
    // container the home list also names. Searching it twice would charge twice
    // and render two headings for one room.
    const charge = vi.fn(async () => null);
    const text = await search(
      clientStub({
        getWorkspaceId: () => "nothing",
        getHomeChannels: vi.fn(async () => ({
          channels: [homeChannel("home-1", "With Dana")],
        })),
      }),
      directoryStub([wsItem("home-1", "shared-c", "link")], "home-1"),
      charge,
      { query: "ship", scope: "everywhere" },
    );
    expect(text).toContain("Searched 1 scope of 1");
    expect(charge).toHaveBeenCalledTimes(1);
  });
});
