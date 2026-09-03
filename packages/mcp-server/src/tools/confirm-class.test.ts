/**
 * THE MECHANISMS MCP SURFACE V2 WAVE A ADDS, checked where they bite.
 * ⚠ **THIS FILE WAS `shelf-confirm.test.ts` UNTIL 2026-09-02**; it was renamed
 * with the axis it named.
 *
 *   A. THE `dopl_kb` CREATE WRITE — one surviving assertion; the SHELF AXIS
 *      this file was named for is deleted (2026-09-02, slice B15, ruling B10)
 *      and the section comment below says what went with it.
 *
 *   B. 🔒 THE CONFIRM CLASS — dry run, then an opaque single-use token bound to
 *      the exact payload, the caller and the room. ⚠ IT IS A TRIPWIRE, NOT A
 *      FENCE (`confirm-token.ts`'s header), and these tests pin what it does
 *      buy: nothing is written on the first call, a replayed / expired /
 *      re-aimed token writes nothing either, and the class does NOT widen to
 *      ordinary writes.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { DoplClient, KnowledgeBase } from "@dopl/client";

import { opCreateBase } from "./knowledge-ops-write";
import { opCreate } from "./agent-ops-write";
import { stub } from "./narration-fixtures";
import { __resetConfirmTokensForTest } from "./confirm-token";

const ME = "user-1";
const PEER = "user-2";

const BASE: KnowledgeBase = {
  id: "kb-1",
  workspaceId: "ws-1",
  name: "Notes",
  slug: "notes",
  publicId: "pub-1",
  description: null,
  agentWriteEnabled: true,
  visibility: "private",
  accessMode: "workspace",
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  deletedAt: null,
};

const TEMPLATE = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-1",
  name: "Researcher",
  description: null,
  instructions: null,
  model: null,
  fields: [],
  visibility: "workspace" as const,
  teamIds: [],
  knowledgeBases: [],
  createdBy: ME,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

function workspaceStub(
  kind: "standard" | "link",
  memberCount: number | undefined,
) {
  return {
    getWorkspaceId: vi.fn(() => "ws-1"),
    listWorkspaces: vi.fn(async () => ({
      workspaces: [
        {
          id: "ws-1",
          slug: "acme",
          name: "Acme",
          kind,
          role: "owner",
          memberCount,
        },
      ],
    })),
  };
}

/** A `kind='link'` container with a PEER in it — the only room the class fires in. */
const sharedContainer = () => workspaceStub("link", 2);

/** The token the preview handed back. */
function tokenIn(text: string): string {
  const m = /confirm_token="([^"]+)"/.exec(text);
  expect(m, `no confirm_token in:\n${text}`).not.toBeNull();
  return m![1];
}

afterEach(() => {
  __resetConfirmTokensForTest();
  vi.useRealTimers();
});

// ── A. The shelf axis — 🔒 DELETED 2026-09-02 (slice B15, ruling B10) ─────
//
// ⚠ **NINE CASES STOOD HERE AND ALL NINE ARE GONE, NOT ADAPTED.** They pinned
// the `personal` → `home` wire mapping, the asymmetric absent-argument rule, the
// `homeScopedBaseIds` sibling label (present, absent and fail-safe), the
// local personal+public contradiction, the fence's 403 and the no-shelf-move
// refusal on `update_base`. Every one of them was an assertion about the
// `home_scoped` BOOLEAN, which the migration drops: a personal base is now an
// ordinary row in the caller's own `kind='personal'` container, so there is no
// axis left to map, label, contradict or refuse a move along.
//
// ⚠ **WHAT SURVIVES IS ONE LINE OF THE OLD SECTION, MOVED INTO THE CREATE
// ASSERTION BELOW**: the write still SENDS `visibility` explicitly rather than
// leaving it to the server's credential-dependent default, and that rule is
// nothing to do with shelves — it is what stops a shared credential resolving to
// `public`, tripping G16 and answering an unanswerable 400.

describe("dopl_kb — the create write", () => {
  it("SENDS visibility explicitly, and sends no shelf of any kind", async () => {
    const create = vi.fn(async () => BASE);
    await opCreateBase(
      stub({ ...workspaceStub("standard", 3), createKbBase: create }) as DoplClient,
      ME,
      { name: "Notes" },
    );
    expect(create).toHaveBeenCalledWith({
      name: "Notes",
      description: undefined,
      visibility: "private",
    });
  });
});


// ── B. The confirm class ─────────────────────────────────────────────

describe("the confirm class fires only where the audience changes", () => {
  it("a PRIVATE template in a shared container needs no preview", async () => {
    const create = vi.fn(async () => ({ ...TEMPLATE, visibility: "private" as const }));
    const res = await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "private" },
    );
    expect(res.isError).toBeUndefined();
    expect(create).toHaveBeenCalled();
  });

  it("a WORKSPACE template in a STANDARD workspace needs no preview", async () => {
    // ⚠ Deliberate: `set_visibility` has published rows workspace-wide with no
    // confirm since long before this wave, and gating one door and not the
    // other would be theatre.
    const create = vi.fn(async () => TEMPLATE);
    const res = await opCreate(
      stub({ ...workspaceStub("standard", 9), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" },
    );
    expect(res.isError).toBeUndefined();
    expect(create).toHaveBeenCalled();
  });

  it("a SOLO container needs no preview — the class exists because a PEER arrived", async () => {
    const create = vi.fn(async () => TEMPLATE);
    await opCreate(
      stub({ ...workspaceStub("link", 1), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" },
    );
    expect(create).toHaveBeenCalled();
  });

  it("an UNREADABLE workspace fails CLOSED — unknown is treated as a shared room", async () => {
    const create = vi.fn();
    const res = await opCreate(
      stub({
        getWorkspaceId: vi.fn(() => "ws-1"),
        listWorkspaces: vi.fn(async () => {
          throw new Error("boom");
        }),
        createAgentTemplate: create,
      }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" },
    );
    expect(create).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("could not be read");
  });

  it("a stray token on a non-audience-changing call is REFUSED, not ignored", async () => {
    const create = vi.fn();
    const res = await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "private", confirm_token: "whatever" },
    );
    expect(res.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("not audience-changing");
  });
});

describe("the dry-run → token round trip", () => {
  it("the first call WRITES NOTHING and previews what, where and who", async () => {
    const create = vi.fn();
    const res = await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace" },
    );
    const text = textOf(res);

    expect(res.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(text).toContain("NOTHING WAS CREATED");
    expect(text).toContain("**What would be created:**");
    expect(text).toContain("**Where:**");
    expect(text).toContain("**Who would see it:**");
    // 🔒 The honest sentence has to reach the AGENT, not just the module header.
    expect(text).toContain("a step that makes you LOOK, not a permission check");
    expect(tokenIn(text).length).toBeGreaterThan(8);
  });

  it("echoing the token back performs the write exactly once", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const args = { name: "Researcher", visibility: "workspace" as const };

    const token = tokenIn(textOf(await opCreate(client, ME, args)));
    const done = await opCreate(client, ME, { ...args, confirm_token: token });

    expect(done.isError).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("REPLAY — a spent token creates nothing a second time", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const args = { name: "Researcher", visibility: "workspace" as const };

    const token = tokenIn(textOf(await opCreate(client, ME, args)));
    await opCreate(client, ME, { ...args, confirm_token: token });
    const replay = await opCreate(client, ME, { ...args, confirm_token: token });

    expect(replay.isError).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    expect(textOf(replay)).toContain("already used");
  });

  it("EXPIRY — a token older than its TTL is refused and says so", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const args = { name: "Researcher", visibility: "workspace" as const };

    vi.useFakeTimers();
    const token = tokenIn(textOf(await opCreate(client, ME, args)));
    vi.setSystemTime(new Date(Date.now() + 6 * 60_000));
    const late = await opCreate(client, ME, { ...args, confirm_token: token });

    expect(late.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(textOf(late)).toContain("EXPIRED");
  });

  it("PAYLOAD MISMATCH — a token cannot be re-aimed at a different write", async () => {
    // ⚠ THE POINT OF BINDING. Without it the preview shows one thing and the
    // confirmed call lands another, which is worse than no preview at all.
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;

    const token = tokenIn(
      textOf(await opCreate(client, ME, { name: "Researcher", visibility: "workspace" })),
    );
    const swapped = await opCreate(client, ME, {
      name: "Exfiltrator",
      visibility: "workspace",
      confirm_token: token,
    });

    expect(swapped.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(textOf(swapped)).toContain("DIFFERENT payload");
  });

  it("a token is bound to the CALLER who previewed", async () => {
    const create = vi.fn(async () => TEMPLATE);
    const client = stub({
      ...sharedContainer(),
      createAgentTemplate: create,
    }) as DoplClient;
    const args = { name: "Researcher", visibility: "workspace" as const };

    const token = tokenIn(textOf(await opCreate(client, ME, args)));
    const other = await opCreate(client, PEER, { ...args, confirm_token: token });

    expect(other.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it("an invented token is refused, and the refusal does not invite guessing", async () => {
    const create = vi.fn();
    const res = await opCreate(
      stub({ ...sharedContainer(), createAgentTemplate: create }) as DoplClient,
      ME,
      { name: "Researcher", visibility: "workspace", confirm_token: "made-up" },
    );
    expect(create).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("Do not guess a token");
  });
});

describe("the knowledge half of the confirm class", () => {
  it("a PUBLIC base in a shared container previews, then writes on confirm", async () => {
    const create = vi.fn(async () => ({ ...BASE, visibility: "public" as const }));
    const client = stub({
      ...sharedContainer(),
      createKbBase: create,
    }) as DoplClient;
    const args = { name: "Notes", visibility: "public" as const };

    const first = await opCreateBase(client, ME, args);
    expect(first.isError).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(textOf(first)).toContain("read everything you put in it");

    const token = tokenIn(textOf(first));
    const done = await opCreateBase(client, ME, { ...args, confirm_token: token });
    expect(done.isError).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("a PRIVATE base in the same container writes straight through", async () => {
    const create = vi.fn(async () => BASE);
    const res = await opCreateBase(
      stub({ ...sharedContainer(), createKbBase: create }) as DoplClient,
      ME,
      { name: "Notes" },
    );
    expect(res.isError).toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
