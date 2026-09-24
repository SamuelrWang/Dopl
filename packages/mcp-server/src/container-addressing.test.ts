/**
 * 🔒 **R-32 — THE CONTAINER ADDRESS, END TO END** (Samuel, 2026-09-17: *home
 * must be structurally distinct, never just a prompt line*).
 *
 * Four claims, and each one is a thing that was impossible before:
 *   1. the GRAMMAR — `home` per caller, a slug for either addressable kind, an
 *      id anywhere, and `workspace=` mapped to the same resolver for one
 *      release;
 *   2. the KIND is a TYPED field on every row that names a container — the
 *      census below reads the tools' real output rather than their source;
 *   3. `dopl_map` draws **Home space** as its own top-level node;
 *   4. an unaddressed MINT is REFUSED rather than filed into the home space.
 *
 * ⚠ The budget halves of the same ruling live in `tool-budget.test.ts`, which
 * is where a rise has to be argued.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import type { ContainerKind } from "@dopl/contracts";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const registry = vi.hoisted(() => ({
  tools: new Map<string, Handler>(),
  schemas: new Map<string, unknown>(),
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerResource() {}
    registerTool(name: string, config: { inputSchema?: unknown }, handler: Handler) {
      registry.tools.set(name, handler);
      registry.schemas.set(name, config?.inputSchema);
    }
  },
}));

import { createServer } from "./server.js";
import {
  CONTAINER_ARG_DESCRIPTION,
} from "./registrar.js";
import { createWorkspaceDirectory, HOME_ADDRESS } from "./workspace-directory.js";
import { UNADDRESSED_WRITE_REFUSALS, WORKSPACE_ARG_OPS } from "./workspace-arg.js";
import { WRITE_OPS } from "./gating.js";

function wsItem(
  id: string,
  slug: string,
  name: string,
  kind?: "standard" | "link" | "personal",
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name,
    slug,
    publicId: `pub-${id}`,
    description: null,
    ...(kind ? { kind } : {}),
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
  };
}

const WS = wsItem("id-ws", "acme", "Acme", "standard");
/** ⚠ ITS SLUG IS ITS CHANNEL'S — both are minted from the same name by
 *  `home/server/service-writes.ts › createHomeChannel`, and a link container
 *  holds exactly ONE channel. */
const ROOM = wsItem("id-room", "with-dana", "With Dana", "link");
const HOME = wsItem("id-home", "sam", "Sam", "personal");

function mockClient(directory: WorkspaceListItem[]): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    listKbBases: vi.fn().mockResolvedValue([]),
    listKbBasesPayload: vi.fn().mockResolvedValue({ bases: [] }),
    listSkills: vi.fn().mockResolvedValue([]),
    listAgentIdentitiesPayload: vi.fn().mockResolvedValue({ identities: [] }),
    getOntology: vi.fn().mockResolvedValue({ ontologies: [], objects: {} }),
    getAccountStatus: vi.fn().mockResolvedValue({
      since: null,
      operatorOnline: false,
      truncated: { channels: false, unread: false, waiting: false },
      channels: [
        {
          channelId: "ch-1",
          channelSlug: "with-dana",
          channelName: "With Dana",
          workspaceId: ROOM.id,
          lastSeq: 7,
          unread: null,
          sessions: [],
          waiting: [],
        },
        {
          channelId: "ch-2",
          channelSlug: "general",
          channelName: "General",
          workspaceId: WS.id,
          lastSeq: 3,
          unread: null,
          sessions: [],
          waiting: [],
        },
      ],
    }),
    listChats: vi.fn().mockResolvedValue({ chats: [], hiddenCount: 0 }),
    listChatFolders: vi.fn().mockResolvedValue([]),
    consumeCredits: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as DoplClient;
}

/** A server with no bound container — the shape R-32's default rule is about. */
function build(directory: WorkspaceListItem[], bound: WorkspaceListItem | null = null) {
  registry.tools.clear();
  registry.schemas.clear();
  createServer(mockClient(directory), {
    scopes: ["dopl.read", "dopl.write"],
    directory,
    workspace: bound,
    role: bound ? "owner" : null,
    workspaceSource: bound ? "header pin" : null,
  });
}

const tool = (name: string): Handler => {
  const h = registry.tools.get(name);
  if (!h) throw new Error(`${name} was not registered`);
  return h;
};
const textOf = (r: { content: Array<{ text: string }> }) =>
  r.content.map((c) => c.text).join("");

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. THE GRAMMAR ──────────────────────────────────────────────────────────

describe("the container address grammar", () => {
  const directory = () =>
    createWorkspaceDirectory(mockClient([WS, ROOM, HOME]), {
      directory: [WS, ROOM, HOME],
    });

  it("`home` is the CALLER's personal container, and nothing else is", async () => {
    expect(await directory().resolveContainerRef(HOME_ADDRESS)).toEqual(HOME);
    // ⚠ Case-folded: an agent that types `Home` means its home space, and a
    // slug is lower-case by construction so nothing legitimate is shadowed.
    expect(await directory().resolveContainerRef("Home")).toEqual(HOME);
    expect(await directory().resolveContainerRef(" home ")).toEqual(HOME);
  });

  it("`home` REFUSES rather than falling back when the caller has none", async () => {
    // 🔒 §G.3 rule 4 — a resolver refuses; a fallback files a row into somebody
    // else's tenancy. The caller is in two containers and neither is theirs.
    const d = createWorkspaceDirectory(mockClient([WS, ROOM]), {
      directory: [WS, ROOM],
    });
    expect(await d.resolveContainerRef(HOME_ADDRESS)).toBeNull();
    expect(await d.homeContainer()).toBeNull();
  });

  it("a home-channel container is addressed by its channel's slug", async () => {
    expect(await directory().resolveContainerRef("with-dana")).toEqual(ROOM);
  });

  it("a workspace is addressed by its slug, and every kind by its id", async () => {
    expect(await directory().resolveContainerRef("acme")).toEqual(WS);
    for (const w of [WS, ROOM, HOME]) {
      expect(await directory().resolveContainerRef(w.id)).toEqual(w);
    }
  });

  it("an unknown ref is null — a refusal, never the caller's own container", async () => {
    expect(await directory().resolveContainerRef("no-such-thing")).toBeNull();
  });

  it("routes a call, and names the container it landed in", async () => {
    build([WS, ROOM, HOME]);
    const text = textOf(await tool("dopl_map")({ container: "with-dana" }));
    expect(text).toContain("active_workspace: `With Dana`");
    expect(text).toContain("kind=`home_channel`");
    expect(text).toContain("workspace_source: per-call arg");
  });

  it("`workspace=` reaches the resolver NOWHERE — the alias is retired", async () => {
    // 🔒 2026-09-18: the one-release window closed. The handler never sees the
    // key (the SDK refuses it at the schema), so what this case pins is that
    // nothing downstream still MAPS it: a caller's `workspace=` must not be
    // quietly honoured by a second code path after the schema stopped
    // publishing it.
    build([WS, ROOM, HOME]);
    const text = textOf(
      await tool("dopl_map")({ workspace: "acme" } as Record<string, unknown>),
    );
    expect(text).not.toContain("active_workspace: `Acme`");
    expect(text).not.toMatch(/DEPRECATED/);
  });

  it("a BLANK container= is refused, and names the argument the caller sent", async () => {
    build([WS, ROOM, HOME]);
    const res = await tool("dopl_map")({ container: "  " });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("`container` argument was blank");
  });

  it("an unresolvable one is refused and points at `home` by name", async () => {
    build([WS, ROOM, HOME]);
    const res = await tool("dopl_map")({ container: "nope" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("Container not found: `nope`");
    expect(textOf(res)).toContain("`home`");
  });
});

// ── 2. THE KIND, AS A CENSUS OVER REAL OUTPUT ───────────────────────────────

const KINDS: ContainerKind[] = ["personal", "home_channel", "workspace"];

describe("every list that NAMES a container renders its typed kind", () => {
  /**
   * ⚠ **A CENSUS OVER THE TOOLS' OUTPUT, NOT OVER THEIR SOURCE.** A grep for
   * `containerKind` proves a function is called; this proves the value reached
   * an agent. Each row names the tool and what it must carry.
   */
  const CENSUS: Array<{ tool: string; args: Record<string, unknown>; expect: ContainerKind[] }> = [
    { tool: "dopl_workspaces", args: {}, expect: ["workspace", "home_channel", "personal"] },
    { tool: "dopl_map", args: {}, expect: ["workspace", "home_channel", "personal"] },
    { tool: "dopl_status", args: {}, expect: ["workspace", "home_channel"] },
  ];

  for (const row of CENSUS) {
    it(`${row.tool} — ${row.expect.join(", ")}`, async () => {
      build([WS, ROOM, HOME]);
      const text = textOf(await tool(row.tool)(row.args));
      for (const kind of row.expect) {
        expect(text, `${row.tool} never renders kind=\`${kind}\``).toContain(
          `kind=\`${kind}\``,
        );
      }
      // ⚠ AND NOTHING OUTSIDE THE CLOSED SET — a `kind=` naming a value the
      // union does not hold is the drift `@dopl/contracts` exists to deny.
      for (const found of text.matchAll(/kind=`([a-z_]+)`/g)) {
        expect(KINDS).toContain(found[1] as ContainerKind);
      }
    });
  }

  it("a single-container list names its container's kind on the ONE footer line", async () => {
    // ⚠ `dopl_kb(op="list_bases")` lists BASES, not containers: its rows name
    // no container, so the kind rides `_dopl_status` — one declaration, paid
    // for once per response rather than once per row.
    build([WS, ROOM, HOME], HOME);
    const text = textOf(await tool("dopl_kb")({ op: "list_bases" }));
    expect(text).toContain("kind=`personal`");
  });

  // ⚠ THE REGISTRAR THREADS THE KNOB, and this is the end-to-end half of
  // `status-footer.test.ts` (S37/S54, 2026-09-18): the footer is appended AFTER
  // the handler, so only the wrapper can see what the call asked for.
  it("`concise` drops that footer, through the real registrar", async () => {
    build([WS, ROOM, HOME], HOME);
    const text = textOf(
      await tool("dopl_kb")({ op: "list_bases", response_format: "concise" }),
    );
    expect(text).not.toContain("_dopl_status:");
    expect(text).not.toContain("active_workspace:");
  });
});

// ── 3. THE HOME-SPACE NODE ──────────────────────────────────────────────────

describe("dopl_map draws Home space as its own top-level node", () => {
  it("three nodes, the caller's own first and labelled the default", async () => {
    build([WS, ROOM, HOME]);
    const text = textOf(await tool("dopl_map")({}));
    const heads = text.split("\n").filter((l) => l.startsWith("## "));
    expect(heads.slice(0, 3)).toEqual([
      "## Home space — your default container",
      "## Home channels (1)",
      "## Workspaces (1)",
    ]);
    expect(text).toContain("container=`home`");
    expect(text).toContain("container=`with-dana`");
    expect(text).toContain("container=`acme`");
  });

  it("a caller with no personal container gets ABSENT, never an empty node", async () => {
    build([WS]);
    const text = textOf(await tool("dopl_map")({}));
    expect(text).toContain("## Home space — your default container");
    expect(text).toContain("you have no home space");
  });
});

// ── 4. THE UNADDRESSED MINT ─────────────────────────────────────────────────

describe("an unaddressed MINT is refused, and an unaddressed READ is not", () => {
  it("every refusing row is a list/create op that is also a WRITE", () => {
    // ⚠ THE TABLE IS DERIVED, NOT TYPED TWICE. A row that names a read, or an
    // op the tool does not take an address on, is a rule guarding nothing.
    for (const [name, ops] of Object.entries(UNADDRESSED_WRITE_REFUSALS)) {
      const addressable = WORKSPACE_ARG_OPS[name];
      expect(addressable, `${name} takes no address at all`).toBeDefined();
      for (const op of ops) {
        expect(addressable === null || addressable.has(op), `${name}.${op}`).toBe(true);
        expect(WRITE_OPS[name]?.has(op), `${name}.${op} is not a write`).toBe(true);
      }
    }
    // The op the ruling names by hand.
    expect(UNADDRESSED_WRITE_REFUSALS.dopl_chats.has("export")).toBe(true);
  });

  it("dopl_chats(op=\"export\") with no address REFUSES and says why", async () => {
    build([WS, ROOM, HOME]);
    const res = await tool("dopl_chats")({ op: "export", title: "x", body: "y" });
    expect(res.isError).toBe(true);
    const text = textOf(res);
    expect(text).toContain("needs an explicit `container=`");
    expect(text).toContain("orphan");
    // ⚠ A refusal with no accepted value is a dead end an agent retries.
    expect(text).toContain('`container="home"`');
  });

  it("the same op RUNS once it is addressed", async () => {
    build([WS, ROOM, HOME]);
    const res = await tool("dopl_chats")({ op: "list", container: "acme" });
    expect(res.isError).toBeFalsy();
  });

  it("a READ with no address is untouched — it still resolves to home", async () => {
    build([WS, ROOM, HOME]);
    const res = await tool("dopl_kb")({ op: "list_bases" });
    expect(res.isError).toBeFalsy();
  });

  it("a BOUND connection may still mint — it named a container at the transport", async () => {
    // ⚠ The refusal is about the silent fall-through to the home space, not
    // about writes in general: `X-Workspace-Id` IS the operator pointing.
    build([WS, ROOM, HOME], WS);
    const res = await tool("dopl_chats")({ op: "folders" });
    expect(res.isError).toBeFalsy();
  });
});

// ── 5. THE INJECTED PAIR (C9, carried forward from `server.test.ts`) ────────
//
// ⚠ THIS DESCRIPTION IS MULTIPLIED BY THE DOMAIN-TOOL COUNT ON EVERY
// CONNECTION, before an agent has called anything. It was a 717-char paragraph
// across 14 tools — ~10,000 served chars, measured 2026-09-02 — restating the
// rule `instructions.ts` states once. That is the cost these cases exist to
// keep from growing back (C9), and R-32 added a SECOND key to the same nine
// schemas, which is why they moved here beside the grammar they belong to.

/**
 * ⚠ A CEILING THAT ONLY EVER MOVES DOWN, exactly like `tool-budget.test.ts`'s
 * description ratchet. Raising it is how a budget stops being a budget: the
 * rule belongs in the instructions, which are pushed ONCE.
 */
const CONTAINER_ARG_MAX_CHARS = 96;

/** ⚠ `registerMetaTool` injects NO addressing arg — an account-wide lookup is
 *  user-scoped — so these are the complement of the set that must carry it, and
 *  deriving the expectation that way keeps the cases honest as tools are
 *  added or deleted. */
const META_TOOLS = ["dopl_workspaces", "dopl_status"];

/** One injected arg's served description, read off the registered schema. */
function argOf(schema: unknown, arg: "workspace" | "container"): string | undefined {
  const shape = (schema as { shape?: Record<string, { description?: string }> })?.shape;
  return shape?.[arg]?.description;
}

const domainTools = () =>
  [...registry.schemas.keys()].filter((n) => !META_TOOLS.includes(n)).sort();

describe("the injected addressing pair (C9 + R-32)", () => {
  beforeEach(() => {
    build([WS, ROOM, HOME], WS);
  });

  it(`is a contract, not a paragraph — \u2264 ${CONTAINER_ARG_MAX_CHARS} chars`, () => {
    expect(CONTAINER_ARG_DESCRIPTION.length).toBeLessThanOrEqual(
      CONTAINER_ARG_MAX_CHARS,
    );
    // ⚠ **THE ADDRESS GRAMMAR IS THE CONTRACT** — all three forms, and a trim
    // that deletes one makes the shorter string a wrong string.
    expect(CONTAINER_ARG_DESCRIPTION).toContain("slug");
    expect(CONTAINER_ARG_DESCRIPTION).toContain("id");
    expect(CONTAINER_ARG_DESCRIPTION).toContain("`home`");
    // ⚠ THE RETIREMENT CLAUSE IS PART OF THE CONTRACT (B13). Without it the arg
    // is a promise the registrar no longer keeps on most ops.
    expect(CONTAINER_ARG_DESCRIPTION).toContain("Ignored");
  });

  it("does not restate what `instructions.ts` states once", () => {
    expect(CONTAINER_ARG_DESCRIPTION).not.toMatch(/dopl_workspaces|REQUIRED/);
  });

  it("is the byte-identical string on every domain tool — 9 of them today", () => {
    const carrying = [...registry.schemas]
      .filter(([, schema]) => argOf(schema, "container") === CONTAINER_ARG_DESCRIPTION)
      .map(([name]) => name);
    // A scan over nothing is not a guard.
    expect(carrying.length).toBeGreaterThan(5);
    expect(carrying.sort()).toEqual(domainTools());
  });

  it("publishes the alias NOWHERE — it retired on 2026-09-18", () => {
    // 🔒 **THE DEPRECATION RAN ITS COURSE.** The key was published bare, and
    // undescribed, for ONE release so a caller still sending the old spelling
    // got its answer rather than a `-32602`; that release shipped, and the key
    // cost ~21 chars on each of nine schemas, on every connection, to advertise
    // an argument nobody should newly adopt. Now `strictInput` answers it with
    // `-32602 … Unrecognized key: "workspace"`, which NAMES the field — the
    // outcome a window defers and a finished deprecation is for.
    // ⚠ **THE MONEY IS THE POINT**: those 189 characters are what funded this
    // wave's additions (`tool-budget.test.ts › SERVED_TOTAL_CEILING`).
    for (const name of domainTools()) {
      const shape = (registry.schemas.get(name) as { shape?: Record<string, unknown> })
        ?.shape;
      expect(shape, name).not.toHaveProperty("workspace");
      expect(shape, name).toHaveProperty("container");
    }
  });

  it("is NOT injected onto the meta path — neither meta tool carries either key", () => {
    // ⚠ The meta path must never grow the domain path's routing contract: an
    // account-wide answer cannot be scoped to one container, so an argument
    // saying it could would only ever be wrong.
    for (const name of META_TOOLS) {
      expect(argOf(registry.schemas.get(name), "container"), name).toBeUndefined();
      expect(argOf(registry.schemas.get(name), "workspace"), name).toBeUndefined();
    }
  });
});
