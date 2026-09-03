/**
 * THE PROFILE-SCOPED TOOL OFFER — the `X-Dopl-Tool-Profile` mechanism, end to
 * end through the REAL `createServer` over a real transport (2026-09-02, MCP v2
 * wave B slice B5; the wave A version of this file drove the same seam over an
 * EMPTY table).
 *
 * FOUR CLAIMS, and every row anybody adds must keep all four:
 *
 *   1. NARROWING-ONLY: a row is an ALLOW set intersected with what the
 *      registrars register, so no row can name a tool into existence, and no
 *      claim off the wire can serve MORE than a connection that claims nothing.
 *   2. AN UNPLACEABLE CLAIM FAILS CLOSED: an unknown name, a near-miss, a value
 *      this server cannot read — all resolve to the NARROWEST profile, never to
 *      the whole surface. ⚠ Only an ABSENT header means "no claim", and that is
 *      the one answer that serves everything (`tool-profile-header.ts` is what
 *      keeps "present but unreadable" out of that arm).
 *   3. THE OFFER IS NEVER WIDER THAN THE MACHINE'S OWN DENY LIST. The header
 *      reports containment the desktop has ALREADY applied, so a tool offered
 *      past it is a tool the session would be refused locally.
 *   4. GENERICITY: the vocabulary is CONTAINMENT, and nothing on the served
 *      surface or in this code path describes what an operator's sessions do for
 *      each other. That is a test here, not a convention.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";

import { createServer } from "./server.js";
import {
  NARROWEST_TOOL_PROFILE,
  TOOL_PROFILES,
  offeredToolsFor,
} from "./gating.js";

const WS: WorkspaceListItem = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerId: "owner",
  name: "Alpha",
  slug: "alpha",
  publicId: "pub-1",
  description: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  role: "owner",
};

function stubClient(): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [WS] }),
    getWorkspaceId: vi.fn(() => null),
    setWorkspaceId: vi.fn(),
  } as unknown as DoplClient;
}

/** Everything one boot publishes: the names, and the text they cost. */
interface Served {
  names: string[];
  text: string;
}

/**
 * Boot a session claiming `toolProfile` and capture what it is served.
 *
 * ⚠ AN OFFER OF NOTHING REGISTERS NOTHING, so the SDK never declares the `tools`
 * capability and `tools/list` answers "Method not found". That is the honest
 * shape of a session the machine denies the whole server to — captured here as
 * an empty surface rather than smoothed over, so the read_only row below is a
 * claim about the wire and not about this helper.
 */
async function serve(toolProfile?: string | null): Promise<Served> {
  const server = createServer(stubClient(), {
    directory: [WS],
    workspace: WS,
    role: "owner",
    workspaceSource: "sole membership",
    scopes: ["dopl.read", "dopl.write"],
    toolProfile,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "profile-probe", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  const tools = client.getServerCapabilities()?.tools
    ? (await client.listTools()).tools
    : [];
  const text = `${client.getInstructions() ?? ""}\n${JSON.stringify(tools)}`;
  await client.close();
  return { names: tools.map((t) => t.name).sort(), text };
}

const servedTools = async (p?: string | null) => (await serve(p)).names;

let whole: Served;

beforeAll(async () => {
  whole = await serve();
});

afterAll(() => {
  // ⚠ The suite's own premise: a boot with no header serves a real surface, or
  // every "unchanged" assertion below passes over an empty list.
  expect(whole.names.length).toBeGreaterThan(5);
});

describe("the vocabulary is the four CONTAINMENT profiles", () => {
  it("is pinned as a VALUE, so a fifth name cannot arrive unnoticed", () => {
    // ⚠ THE GENERICITY GATE, first half. Adding a profile is a deliberate act
    // that edits this line; `dopl-desktop-app/test/tool-profile-stamp.test.mjs`
    // holds the same list against the desktop's `KNOWN_PROFILES`, so the two
    // sides cannot drift into each other's blind spot.
    expect([...TOOL_PROFILES]).toEqual([
      "read_only",
      "dopl_only",
      "channel_agent",
      "full",
    ]);
  });

  it("names a floor, and the floor is the narrowest row there is", () => {
    expect(NARROWEST_TOOL_PROFILE).toBe("read_only");
    const floor = offeredToolsFor(NARROWEST_TOOL_PROFILE) ?? new Set<string>();
    for (const profile of TOOL_PROFILES) {
      const row = offeredToolsFor(profile);
      // `null` is the whole surface, which contains the floor trivially.
      if (row === null) continue;
      for (const name of floor) expect(row.has(name)).toBe(true);
    }
  });
});

describe("GENERICITY — the surface describes containment and nothing else", () => {
  /**
   * ⚠ THE WORDS A PRODUCT SURFACE MAY NOT LEARN. One account runs sessions that
   * direct each other; another runs one session and nothing else. Neither
   * arrangement is a Dopl concept, and a profile named after one would publish
   * it to every connection. Kept short and concrete on purpose — this is a
   * vocabulary gate, not a style checker.
   */
  const PERSONA_WORDS = [
    "orchestrator",
    "sub-agent",
    "subagent",
    "supervisor",
    "courier",
    "persona",
  ];

  /**
   * ⚠ WHOLE WORDS ONLY, and the reason is live on the surface: `dopl_agent`
   * serves the word `personal` (the shelf), which contains `persona`. A
   * substring scan would fail on a real product noun and teach the next author
   * to delete the test rather than the vocabulary.
   */
  const personaWordIn = (text: string): string | undefined =>
    PERSONA_WORDS.find((word) =>
      new RegExp(`\\b${word.replace(/-/g, "[- ]?")}s?\\b`, "i").test(text),
    );

  it("no profile name is one", () => {
    for (const profile of TOOL_PROFILES) {
      expect(personaWordIn(profile.replace(/_/g, " ")), profile).toBeUndefined();
    }
  });

  it("nothing an agent is SERVED is one — instructions, descriptions, schemas", async () => {
    // ⚠ Over the whole surface AND over a narrowed one: the served text is what
    // every connection pays for, and a row that narrowed by naming somebody's
    // arrangement of sessions would cost more, not less.
    for (const served of [whole, await serve("dopl_only")]) {
      expect(personaWordIn(served.text)).toBeUndefined();
    }
  });

  it("neither is the code path that reads the header", () => {
    // ⚠ SOURCE TEXT, because the failure this catches is a COMMENT that teaches
    // the next author the table is keyed on who an agent works for. `role` is on
    // the list for the same reason: the word is what invited the table.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const gating = readFileSync(path.join(here, "gating.ts"), "utf8");
    expect(personaWordIn(gating)).toBeUndefined();
    expect(gating).not.toMatch(/\brole\b/i);
  });
});

describe("what each profile is offered", () => {
  it("a connection that claims NOTHING keeps the whole surface", async () => {
    // ⚠ The OAuth connector, the stdio binary and any desktop older than the
    // header all send nothing. Absent is the only "no claim" there is.
    expect(await servedTools()).toEqual(whole.names);
    expect(await servedTools(null)).toEqual(whole.names);
  });

  it("`full` is the whole surface — it is the coding lane", async () => {
    expect(await servedTools("full")).toEqual(whole.names);
  });

  it("`channel_agent` is too: it differs from `full` in BUILT-INs", async () => {
    // ⚠ `full` minus `Bash`, and `Bash` is not a tool this server serves, so the
    // difference is real and lands entirely on the desktop's deny list.
    expect(await servedTools("channel_agent")).toEqual(whole.names);
  });

  it("`dopl_only` is the whole surface MINUS `dopl_channel`, by name", async () => {
    // ⚠ Asserted BY NAME in both directions: the exclusion is the point (a
    // `dopl_only` spawn denies `dopl_channel` locally, so offering it would
    // publish a tool the machine refuses), and the vacuous pass this catches is
    // `dopl_channel` having quietly left the surface entirely.
    expect(whole.names).toContain("dopl_channel");
    expect(await servedTools("dopl_only")).toEqual(
      whole.names.filter((n) => n !== "dopl_channel"),
    );
  });

  it("`read_only` is offered NOTHING — the machine denies it the whole server", async () => {
    // ⚠ NOT AN OVERSIGHT AND NOT A DEGRADED STATE. `tool-profiles.js ›
    // buildDeniedTools` puts the bare `mcp__dopl` prefix in a read_only spawn's
    // deny list, so every tool served to one is a tool it is shown and refused.
    // This is the largest saving on the surface: no description, no schema.
    expect(await servedTools("read_only")).toEqual([]);
  });
});

describe("a claim can only NARROW", () => {
  it("every profile is served a SUBSET of what claiming nothing serves", async () => {
    for (const profile of TOOL_PROFILES) {
      const served = await servedTools(profile);
      expect(whole.names).toEqual(expect.arrayContaining(served));
    }
  });

  it("a name no registrar registers cannot be served into existence", () => {
    // ⚠ THE PROPERTY EVERY ROW DEPENDS ON. The rows are ALLOW sets intersected
    // with the registrars, so a stale name loses a tool and never invents one —
    // asserted here as "every name written in a row is live on the surface".
    for (const profile of TOOL_PROFILES) {
      for (const name of offeredToolsFor(profile) ?? []) {
        expect(whole.names).toContain(name);
      }
    }
  });

  it("an UNPLACEABLE claim gets the floor, never the surface", async () => {
    // 🔒 THE DIRECTION THAT MAY NOT FAIL. A value this server cannot place
    // describes a containment it does not know — including the empty string
    // `tool-profile-header.ts` answers with when a header is present and
    // unreadable, which is the duplicate-header fold that used to un-narrow the
    // request entirely.
    const floor = await servedTools(NARROWEST_TOOL_PROFILE);
    for (const claim of ["", "unknown_profile", "FULL", "full_plus", "fu ll"]) {
      expect(await servedTools(claim), claim).toEqual(floor);
    }
  });

  it("SECURITY: an inherited object key resolves to the floor, not to a function", () => {
    // ⚠ The value is a lookup key off a request header. It is normalized against
    // the vocabulary BEFORE any lookup, so `constructor` becomes the floor
    // rather than reaching `Object.prototype` — the reason the table no longer
    // needs to be a `Map`.
    const floor = offeredToolsFor(NARROWEST_TOOL_PROFILE);
    for (const key of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(offeredToolsFor(key), key).toBe(floor);
    }
  });

  it("only a non-string is `null` — the whole surface", () => {
    expect(offeredToolsFor(undefined)).toBeNull();
    expect(offeredToolsFor(null)).toBeNull();
    // ⚠ AND THE EMPTY STRING IS NOT ONE. A `!claimed` check here would serve an
    // unreadable header everything; the check is on the TYPE for that reason.
    expect(offeredToolsFor("")).not.toBeNull();
  });
});
