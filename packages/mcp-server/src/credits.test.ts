/**
 * INVARIANT SUITE — MCP credits at the registrar seam. ⚠ The registrar's
 * `wrapped` is the ONLY exactly-once-per-tool-call seam (one tool call makes
 * 0..N loopback requests), so the three ways the charge can be wrong:
 *
 *   1. EXACTLY ONCE on BOTH terminal paths (session-default branch and
 *      `workspace=`-arg branch), against the RIGHT workspace id.
 *   2. EXHAUSTION HARD-BLOCKS: the handler never runs, and the refusal names
 *      the upgrade URL the server handed back.
 *   3. INFRASTRUCTURE FAILURE FAILS OPEN — a closed gate here bricks every
 *      agent in the product on a transient blip.
 *
 * ⚠ Plus the exemptions: meta-tools are never charged, and a call refused by an
 * earlier gate is not charged either — ordering is load-bearing and a refusal
 * must cost nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetUnmeteredLogForTests } from "./credits-unmetered";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

type Handler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

const registry = vi.hoisted(() => ({ tools: new Map<string, Handler>() }));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    // ⚠ THE MCP RESOURCE SEAM (2026-09-02). `createServer` publishes
    // `dopl://doctrine/channels` through `registerResource` (`resources.ts`), so
    // a double without this method throws before a single tool is registered.
    // ⚠ IT IS A NO-OP HERE ON PURPOSE — these suites assert over TOOLS. The
    // resource's own content is pinned in `channel-doctrine.test.ts`, and that
    // it is registered at all in `server.test.ts`.
    registerResource() {}
    registerTool(name: string, _config: unknown, handler: Handler) {
      registry.tools.set(name, handler);
    }
  },
}));

import { createServer } from "./server.js";

function wsItem(id: string, slug: string, name: string): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name,
    slug,
    publicId: `pub-${id}`,
    description: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
  };
}

const WS1 = wsItem("id-1", "alpha", "Alpha");
const WS2 = wsItem("id-2", "beta", "Beta");

const UPGRADE = "https://www.usedopl.com/billing?billing=upgrade";
/** ⚠ A DIFFERENT LINK, HENCE A SEPARATE CONSTANT — `upgradeUrlFor` appends
 *  `plan=pro` for a FREE personal wallet; reusing the seat URL would leave the
 *  two arms indistinguishable and the pin would survive a swap. */
const UPGRADE_PRO = `${UPGRADE}&plan=pro`;

function allowed(used = 1) {
  return {
    allowed: true,
    used,
    limit: 500,
    remaining: 500 - used,
    periodStart: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-09-01T00:00:00.000Z",
    upgradeUrl: UPGRADE,
  };
}

function exhausted() {
  return { ...allowed(500), allowed: false, remaining: 0 };
}

/**
 * An exhausted answer that NAMES ITS WALLET. ⚠ `exhausted()` above deliberately
 * carries NO `wallet` key — it is the older-server shape, and the pins that use
 * it are the fallback's own proof.
 */
function exhaustedOn(
  wallet: "personal" | "seat",
  over: Record<string, unknown> = {},
) {
  return { ...exhausted(), wallet, ...over };
}

function mockClient(directory: WorkspaceListItem[]) {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
    consumeCredits: vi.fn().mockResolvedValue(allowed()),
    listKbBases: vi.fn().mockResolvedValue([]),
    listSkills: vi.fn().mockResolvedValue([]),
    getOntology: vi.fn().mockResolvedValue({ ontologies: [], objects: {} }),
  } as unknown as DoplClient & {
    consumeCredits: ReturnType<typeof vi.fn>;
    listKbBases: ReturnType<typeof vi.fn>;
  };
}

/** Boot a session. `sole` gives it a session-default workspace; otherwise the
 *  caller must pass `workspace=` (the two terminal paths). */
function build(opts: { sole: boolean }) {
  registry.tools.clear();
  const directory = opts.sole ? [WS1] : [WS1, WS2];
  const client = mockClient(directory);
  createServer(client, {
    scopes: ["dopl.read", "dopl.write"],
    directory,
    workspace: opts.sole ? WS1 : null,
    role: opts.sole ? "owner" : null,
    workspaceSource: opts.sole ? "header pin" : null,
  });
  const map = registry.tools.get("dopl_map");
  if (!map) throw new Error("dopl_map was not registered");
  return { map, client };
}

function tool(name: string): Handler {
  const h = registry.tools.get(name);
  if (!h) throw new Error(`${name} was not registered`);
  return h;
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exactly once, on both terminal paths", () => {
  it("charges the session default EXACTLY ONCE per tool call", async () => {
    const { map, client } = build({ sole: true });
    await map({});
    expect(client.consumeCredits).toHaveBeenCalledTimes(1);
    expect(client.consumeCredits).toHaveBeenCalledWith("id-1");
  });

  it("charges the RESOLVED workspace on the `workspace=` branch, once", async () => {
    const { map, client } = build({ sole: false });
    await map({ container: "beta" });
    expect(client.consumeCredits).toHaveBeenCalledTimes(1);
    expect(client.consumeCredits).toHaveBeenCalledWith("id-2");
  });

  it("charges once PER CALL — three calls, three credits", async () => {
    const { map, client } = build({ sole: true });
    await map({});
    await map({});
    await map({});
    expect(client.consumeCredits).toHaveBeenCalledTimes(3);
  });

  it("charges BEFORE the handler runs", async () => {
    const order: string[] = [];
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockImplementation(async () => {
      order.push("charge");
      return allowed();
    });
    client.listKbBases.mockImplementation(async () => {
      order.push("handler");
      return [];
    });
    await map({});
    expect(order[0]).toBe("charge");
    expect(order).toContain("handler");
  });
});

describe("exhaustion", () => {
  it("refuses the call, names the upgrade URL, and never runs the handler", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(exhausted());

    const res = await map({});
    expect(res.isError).toBe(true);
    const text = textOf(res);
    // ⚠ THE PIN MOVED ON PURPOSE, 2026-09-05 (Samuel: "it's not MCP credits,
    // it's credits" — the agent should read "out of credits"). Every assertion
    // in this file that quoted "out of MCP credits" was re-pointed at the new
    // true text; the SENTENCE is what changed, not the refusal it proves.
    expect(text).toContain("out of credits");
    expect(text).toContain(`Upgrade to continue: ${UPGRADE}`);
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  it("refuses on the `workspace=` branch too", async () => {
    const { map, client } = build({ sole: false });
    client.consumeCredits.mockResolvedValue(exhausted());

    const res = await map({ container: "beta" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("out of credits");
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  it("still refuses when the server sent no upgrade url — message, no dangling link", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({ ...exhausted(), upgradeUrl: "" });

    const text = textOf(await map({}));
    expect(text).toContain("out of credits");
    expect(text).not.toContain("Upgrade to continue:");
  });
});

describe("fail direction", () => {
  it("FAILS OPEN when the consume call throws — the tool call proceeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockRejectedValue(new Error("loopback refused"));

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.listKbBases).toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  /**
   * ⚠ ONLY AN EXPLICIT `allowed === false` REFUSES. The fail-open promise covers
   * a THROWN error; a 200 whose body does not parse into our shape (proxy error
   * page, truncated response, future shape change) is the MORE likely failure,
   * and a truthiness test reads `undefined` as a refusal — fail-OPEN on the
   * rare path, fail-CLOSED on the common one.
   */
  it.each([
    ["a body with no `allowed` key", { used: 1, limit: 500, upgradeUrl: UPGRADE }],
    ["an empty object", {}],
    ["`allowed: undefined`", { ...allowed(), allowed: undefined }],
    ["`allowed` as a non-boolean", { ...allowed(), allowed: "true" }],
  ])("FAILS OPEN on %s — the tool call proceeds", async (_label, body) => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(body);

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).not.toContain("out of credits");
    expect(client.listKbBases).toHaveBeenCalled();
  });

  it("FAILS OPEN on a null/absent body rather than refusing", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(null);

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.listKbBases).toHaveBeenCalled();
  });

  it("still refuses on an EXPLICIT false — the fix does not disarm the gate", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({ ...allowed(), allowed: false });

    const res = await map({});
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("out of credits");
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  /**
   * 🔒 ⚠ THE FAIL-OPEN IS FOR TRANSPORT FAILURES, AND A GUEST IS NOT ONE
   * (2026-08-26, F-325): a re-raised consume floor 403s, THROWS, and takes the
   * other arm — which the headline assertion below is what discriminates.
   * ⚠ **THIS ASSERTED "AND LOGS NOTHING HERE" UNTIL 2026-09-14, AND THAT WAS THE
   * HOLE** — a degraded answer means the call ran UNCHARGED, so the one
   * deploy-ordering bug that unmeters the whole estate was silent. It now says so
   * ONCE per process (`credits-unmetered.ts`).
   */
  it("a degraded-but-ALLOWED 200 proceeds, and says so ONCE", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    resetUnmeteredLogForTests();
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({
      ...allowed(0),
      used: 0,
      limit: 0,
      remaining: 0,
      degraded: true,
    });

    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(textOf(res)).not.toContain("out of credits");
    expect(client.listKbBases).toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    const line = String(error.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("answered DEGRADED");
    expect(line).not.toContain("FAILED");
    error.mockRestore();
  });
});

describe("what is NOT charged", () => {
  it("the orientation meta tool is exempt — `dopl_workspaces` costs nothing", async () => {
    const { client } = build({ sole: true });
    await tool("dopl_workspaces")({});
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("an app-only DELETE refusal fires first and costs nothing", async () => {
    // ⚠ ORDERING, made executable: the delete block is unconditional and must
    // never become reachable only after another gate — or a billing round trip
    // — lets the call through.
    // ⚠ Driven through `dopl_kb` since 2026-09-02: `dopl_kb_admin` and its four
    // siblings are deleted, and `delete-policy.ts › DELETE_BLOCKED_OPS` moved
    // onto the DOMAIN tools as the fence against a delete op coming back. The
    // op is not in the enum, so this call only exists at this layer — which is
    // exactly the layer the ordering claim is about.
    const { client } = build({ sole: true });
    const res = await tool("dopl_kb")({ op: "delete_base", baseId: "b-1" });
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  /**
   * ⚠ **THE M-3 REFUSAL IS GONE, AND WITH IT THE ONE CALL THAT WAS FREE FOR
   * BEING REFUSED** (B10/B13). An unbound connection is now answered, so it is
   * also METERED — against the first container the session may list, which is
   * `registrar.ts › billingTarget` and the same rule the meta path uses.
   */
  it("an UNBOUND connection is answered, and is charged the first listable container", async () => {
    const { map, client } = build({ sole: false });
    const res = await map({});
    expect(res.isError).toBeFalsy();
    expect(client.consumeCredits).toHaveBeenCalledTimes(1);
    expect(client.consumeCredits).toHaveBeenCalledWith("id-1");
  });

  it("a blank `workspace=` is refused before any charge", async () => {
    const { map, client } = build({ sole: false });
    const res = await map({ container: "   " });
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });

  it("an unknown `workspace=` ref is refused before any charge", async () => {
    const { map, client } = build({ sole: false });
    const res = await map({ container: "does-not-exist" });
    expect(res.isError).toBe(true);
    expect(client.consumeCredits).not.toHaveBeenCalled();
  });
});

/**
 * ⚠ **THE REFUSAL NAMES WHOSE COUNTER STOPPED** (Samuel, 2026-09-07: an
 * allocation is per person and "not pooled"). A member whose SEAT ran out is
 * told about their seat — "this workspace is out of credits" would send them to
 * an admin with nothing to refill — and a home-space caller is told about their
 * personal wallet.
 *
 * ⚠ **AND THE UPGRADE LINE FOLLOWS THE URL, NOT THE WALLET** (Samuel,
 * 2026-09-08: a personal PRO tier exists). Both wallets upsell on a FREE verdict
 * and neither on a PAID one, so these pins are a 2×2 over wallet × `upgradeUrl`.
 *
 * ⚠ The `wallet`-less case is not a leftover: a client always outlives some
 * servers, and the field is OPTIONAL on the wire for exactly that release
 * window. Guessing a wallet there would tell a workspace member their PERSONAL
 * credits ran out.
 */
describe("which wallet the refusal names", () => {
  it("a SEAT on a free workspace — names the seat, the counters, the reset, and the upgrade", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(
      exhaustedOn("seat", { used: 5000, limit: 5000, upgradeCredits: 5000 }),
    );

    const text = textOf(await map({}));
    // ⚠ Thousands separators are `toLocaleString("en-US")`, pinned here because
    // a raw `5000` is the shape a template literal produces by default.
    expect(text).toContain(
      "Your seat in this workspace is out of credits for this period (5,000/5,000). Resets 2026-09-01.",
    );
    expect(text).toContain(
      `Upgrade to Team for 5,000 credits per member: ${UPGRADE}`,
    );
    expect(client.listKbBases).not.toHaveBeenCalled();
  });

  /** ⚠ EMPTY URL = NOTHING TO BUY (a seat on an already-paid workspace), not a
   *  missing link. Offering "upgrade" there sends a paying member to a page that
   *  has no answer for them. */
  it("a SEAT on a PAID workspace — same sentence, and NO upgrade line", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(
      exhaustedOn("seat", { used: 5000, limit: 5000, upgradeUrl: "" }),
    );

    const text = textOf(await map({}));
    expect(text).toBe(
      "Your seat in this workspace is out of credits for this period (5,000/5,000). Resets 2026-09-01.",
    );
    expect(text).not.toContain("Upgrade");
  });

  /**
   * 🔒 **THE HOME SPACE HAS SOMETHING TO SELL SINCE 2026-09-08 (Samuel's Pro
   * ruling), AND THESE TWO ARE THE PINS THAT SAY SO.** The arm dropped the link
   * unconditionally for one wave, on the surface where most agents run — so an
   * EMPTY url here means ALREADY ON PRO, exactly as it does on a seat, and a
   * non-empty one names **Pro** and the PERSONAL link, never Team's.
   */
  it.each([
    ["on PRO (no url)", "", 5000, ""],
    [
      "on FREE",
      UPGRADE_PRO,
      500,
      `\n\nUpgrade to Pro for 5,000 credits a month: ${UPGRADE_PRO}`,
    ],
  ])("a PERSONAL wallet %s", async (_label, upgradeUrl, spent, tail) => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(
      exhaustedOn("personal", { used: spent, limit: spent, upgradeUrl, upgradeCredits: 5000 }),
    );

    const n = (spent as number).toLocaleString("en-US");
    expect(textOf(await map({}))).toBe(
      `Your personal credits are used up for this month (${n}/${n}). Resets 2026-09-01.${tail}`,
    );
  });

  it("an OLDER SERVER sends no `wallet` — the generic sentence, with the url it did send", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(exhausted());

    const text = textOf(await map({}));
    expect(text).toContain("out of credits");
    expect(text).toContain(`Upgrade to continue: ${UPGRADE}`);
    expect(text).not.toContain("Your seat");
    expect(text).not.toContain("Your personal credits");
  });

  it("`wallet: null` (nothing was metered) reads as the older server does", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({ ...exhausted(), wallet: null });

    const text = textOf(await map({}));
    expect(text).toContain("out of credits");
    expect(text).not.toContain("Your seat");
    expect(text).not.toContain("Your personal credits");
  });

  /**
   * ⚠ **A MISSING OR UNPARSEABLE `periodEnd` OMITS THE SENTENCE, IT DOES NOT
   * PRINT ONE.** "Resets Invalid Date" / "Resets undefined" is a refusal that
   * tells an agent to wait for a date that never comes.
   */
  it.each([
    ["absent", undefined],
    ["not a date", "soon"],
    ["a plausible shape that is not a real day", "2026-13-45T00:00:00.000Z"],
  ])("a `periodEnd` that is %s — no Resets sentence, everything else intact", async (
    _label,
    periodEnd,
  ) => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue(
      exhaustedOn("seat", { periodEnd, upgradeUrl: "" }),
    );

    const text = textOf(await map({}));
    expect(text).toBe(
      "Your seat in this workspace is out of credits for this period (500/500).",
    );
    expect(text).not.toContain("Resets");
    expect(text).not.toContain("Invalid");
    expect(text).not.toContain("undefined");
  });

  /** ⚠ A degraded-shaped refusal has no usable counters; `(undefined/undefined)`
   *  is worse than no parenthetical at all. */
  it("counters the server did not send are omitted, not printed", async () => {
    const { map, client } = build({ sole: true });
    client.consumeCredits.mockResolvedValue({
      allowed: false,
      wallet: "personal",
      periodEnd: "2026-09-01T00:00:00.000Z",
      upgradeUrl: "",
    });

    const text = textOf(await map({}));
    expect(text).toBe(
      "Your personal credits are used up for this month. Resets 2026-09-01.",
    );
  });
});
