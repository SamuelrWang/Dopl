/**
 * 🔒 **THE TWO DESTINATIONS** (Samuel's ruling 2026-09-18). One suite over both
 * write lanes and both list lanes, because the rule is ONE rule and splitting it
 * per tool is how the two surfaces started describing one model differently.
 *
 *   1. **HOME** — `container="home"`, or a connection bound to nothing. The
 *      caller's own personal container; `private` is the right value there.
 *   2. **A HOME CHANNEL** — created in that channel's container AND shared into
 *      the channel: `visibility: "workspace"` for a template, `shareToChannelId`
 *      for a knowledge base.
 *   3. 🚫 **PRIVATE AND UNGRANTED INSIDE A HOME CHANNEL** — no door reaches it.
 *
 * ⚠ **THE CHANNEL-BOUND CONNECTION IS THE CASE THAT MINTED THE ORPHANS AND IT
 * IS PINNED FIRST.** An agent running inside a home channel carries
 * `X-Workspace-Id` for that channel's container, so its BARE `op="create"` — no
 * `container=` anywhere — landed there, at the surface's `private` default,
 * while the served `container` description told it `home` was "your default".
 * Nothing in these cases passes a container argument, deliberately: that IS the
 * shape under test.
 *
 * ⚠ **THESE ARE THE SURFACE'S HALF, NOT THE FENCE.** The fence is the server's
 * (`src/features/workspaces/server/home-channel-destination.ts`), pinned by its
 * own suite; every probe here fails OPEN, and the last case pins that too.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, AgentTemplate, KnowledgeBase } from "@dopl/client";

import { opList } from "./agent-ops-read";
import { opCreate } from "./agent-ops-write";
import { opListBases } from "./knowledge-ops-read";
import { opCreateBase } from "./knowledge-ops-base-write";
import { stub } from "./narration-fixtures";
import type { WorkspaceDirectory } from "../workspace-directory";

const ME = "user-1";
const ROOM = "ws-room";
const HOME = "ws-home";
const CHANNEL = "chan-1";

/** A directory that answers ONE container's kind — the only thing
 *  `resolveHomeChannelContainer` asks it for. */
function directory(kinds: Record<string, string>): WorkspaceDirectory {
  return {
    getWorkspaceList: async () => [],
    resolveWorkspaceRef: async () => null,
    resolveContainerRef: async () => null,
    homeContainer: async () => null,
    containerKindIndex: async () =>
      new Map(Object.entries(kinds)) as ReadonlyMap<string, never>,
    lockedWorkspaceId: () => null,
  } as unknown as WorkspaceDirectory;
}

const ROOM_IS_CHANNEL = directory({ [ROOM]: "home_channel" });
const HOME_IS_PERSONAL = directory({ [HOME]: "personal" });

/** The one channel inside `ROOM` — `getHomeChannels` is `scope=account`, so the
 *  row carries its container and the filter is the POSITIVE `kind === "link"`. */
const CHANNELS = {
  channels: [
    { id: CHANNEL, workspaceId: ROOM, container: { kind: "link" } },
    // ⚠ A WORKSPACE CHANNEL IN THE SAME ANSWER, so the positive filter is doing
    // work rather than passing because there is only one row.
    { id: "chan-ws", workspaceId: "ws-standard", container: { kind: "standard" } },
  ],
};

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspaceId: ROOM,
    name: "Researcher",
    description: null,
    instructions: null,
    model: null,
    fields: [],
    visibility: "workspace",
    teamIds: [],
    knowledgeBases: [],
    createdBy: ME,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: "kb-1",
    workspaceId: ROOM,
    name: "Handover",
    slug: "handover",
    description: null,
    visibility: "private",
    accessMode: "workspace",
    agentWriteEnabled: false,
    createdBy: ME,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  } as KnowledgeBase;
}

const textOf = (res: { content: Array<{ text: string }> }) =>
  res.content.map((c) => c.text).join("\n");

// ── 1. dopl_agent op="create" ───────────────────────────────────────────────

describe("dopl_agent op=create — the two destinations", () => {
  function agentClient(over: Record<string, unknown> = {}) {
    const createAgentTemplate = vi.fn(
      async (body: { visibility?: string }) =>
        template({ visibility: body.visibility as AgentTemplate["visibility"] }),
    );
    return {
      createAgentTemplate,
      client: stub({
        getWorkspaceId: () => ROOM,
        // ⚠ A SOLO ROOM, so the confirm class does not fire and the DESTINATION
        // is what these cases measure. The shared-room preview has its own case
        // below — it is unchanged by this wave and must stay so.
        listWorkspaces: async () => ({
          workspaces: [{ id: ROOM, name: "Room", memberCount: 1 }],
        }),
        createAgentTemplate,
        ...over,
      }) as DoplClient,
    };
  }

  it("🔒 A CHANNEL-BOUND CONNECTION, NO container= ANYWHERE — lands at destination 2", async () => {
    // ⚠ THE ORPHAN-MINTING SHAPE. Before 2026-09-18 this wrote `private` into
    // the channel's container, where nothing lists it.
    const { client, createAgentTemplate } = agentClient();
    const res = await opCreate(
      client,
      ME,
      { name: "Researcher" },
      ROOM_IS_CHANNEL,
    );
    expect(res.isError).toBeFalsy();
    expect(createAgentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "workspace" }),
    );
    expect(textOf(res)).toContain("Shared in this channel");
  });

  it("the HOME space keeps the `private` default — destination 1 is untouched", async () => {
    const { client, createAgentTemplate } = agentClient({
      getWorkspaceId: () => HOME,
    });
    await opCreate(client, ME, { name: "Researcher" }, HOME_IS_PERSONAL);
    expect(createAgentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
    );
  });

  it("🔒 A STANDARD WORKSPACE IS UNCHANGED — kind='workspace' is out of scope", async () => {
    // ⚠ Samuel scoped the ruling to the home space. A workspace lists its own
    // private templates on its own Agents page, so there is no orphan there and
    // nothing for this to refuse.
    const { client, createAgentTemplate } = agentClient({
      getWorkspaceId: () => "ws-standard",
    });
    await opCreate(
      client,
      ME,
      { name: "Researcher" },
      directory({ "ws-standard": "workspace" }),
    );
    expect(createAgentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
    );
  });

  it("an EXPLICIT private inside a channel is refused, and nothing is sent", async () => {
    const { client, createAgentTemplate } = agentClient();
    const res = await opCreate(
      client,
      ME,
      { name: "Researcher", visibility: "private" },
      ROOM_IS_CHANNEL,
    );
    expect(res.isError).toBe(true);
    expect(createAgentTemplate).not.toHaveBeenCalled();
    // ⚠ BOTH DESTINATIONS NAMED. A refusal with no accepted value is a dead end
    // an agent retries verbatim.
    expect(textOf(res)).toContain('visibility="workspace"');
    expect(textOf(res)).toContain('container="home"');
  });

  it("🔒 THE CONFIRM PREVIEW STILL FIRES when the channel has other members", async () => {
    // ⚠ **UNCHANGED BY THIS WAVE, AND PINNED SO IT STAYS THAT WAY.** Defaulting
    // to `workspace` inside a channel means the COMMON call now lands in the
    // publish class; the tripwire that shows an operator what is about to be
    // published into a peer's room must still run.
    const { client, createAgentTemplate } = agentClient({
      listWorkspaces: async () => ({
        workspaces: [{ id: ROOM, name: "Room", memberCount: 2 }],
      }),
    });
    const res = await opCreate(client, ME, { name: "Researcher" }, ROOM_IS_CHANNEL);
    expect(res.isError).toBe(true);
    expect(createAgentTemplate).not.toHaveBeenCalled();
    expect(textOf(res)).toContain("confirm_token");
  });

  it("🔓 FAILS OPEN when the directory cannot answer — the SERVER holds the refusal", async () => {
    const { client, createAgentTemplate } = agentClient();
    await opCreate(client, ME, { name: "Researcher" }, directory({}));
    expect(createAgentTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ visibility: "private" }),
    );
  });
});

// ── 2. dopl_kb op="create_base" ─────────────────────────────────────────────

describe("dopl_kb op=create_base — the two destinations", () => {
  function kbClient(over: Record<string, unknown> = {}) {
    const createKbBase = vi.fn(async () => base());
    return {
      createKbBase,
      client: stub({
        getWorkspaceId: () => ROOM,
        listWorkspaces: async () => ({
          workspaces: [{ id: ROOM, name: "Room", memberCount: 1 }],
        }),
        getHomeChannels: async () => CHANNELS,
        createKbBase,
        ...over,
      }) as DoplClient,
    };
  }

  it("🔒 A CHANNEL-BOUND CONNECTION, NO container= — creates AND shares in ONE call", async () => {
    const { client, createKbBase } = kbClient();
    const res = await opCreateBase(
      client,
      ME,
      { name: "Handover" },
      ROOM_IS_CHANNEL,
    );
    expect(createKbBase).toHaveBeenCalledWith(
      // ⚠ STILL `private` — "private + a visible grant" IS "readable in this
      // channel and nowhere else"; the grant is the audience answer.
      expect.objectContaining({ visibility: "private", shareToChannelId: CHANNEL }),
    );
    expect(textOf(res)).toContain("Shared in this channel");
  });

  it("the HOME space sends NO shareToChannelId", async () => {
    const { client, createKbBase } = kbClient({ getWorkspaceId: () => HOME });
    await opCreateBase(client, ME, { name: "Handover" }, HOME_IS_PERSONAL);
    expect(createKbBase).toHaveBeenCalledWith(
      expect.objectContaining({ shareToChannelId: undefined }),
    );
  });

  it("🔓 AN UNRESOLVABLE CHANNEL IS NOT WORKED AROUND — the call goes out unshared", async () => {
    // ⚠ Two rows for one container is treated as unresolvable rather than
    // picked: filing a grant in a room the caller did not name is worse than
    // letting the server refuse.
    const { client, createKbBase } = kbClient({
      getHomeChannels: async () => ({
        channels: [
          { id: "a", workspaceId: ROOM, container: { kind: "link" } },
          { id: "b", workspaceId: ROOM, container: { kind: "link" } },
        ],
      }),
    });
    await opCreateBase(client, ME, { name: "Handover" }, ROOM_IS_CHANNEL);
    expect(createKbBase).toHaveBeenCalledWith(
      expect.objectContaining({ shareToChannelId: undefined }),
    );
  });
});

// ── 3. THE LISTS ────────────────────────────────────────────────────────────

describe("op=list / op=list_bases — container first, then the audience", () => {
  it("dopl_agent groups the channel's rows, the LEGACY ones, and the home shelf", async () => {
    const mine = template({ id: "22222222-2222-4222-8222-222222222222", name: "Mine", visibility: "private", workspaceId: HOME });
    const orphan = template({ id: "33333333-3333-4333-8333-333333333333", name: "Orphan", visibility: "private" });
    const text = textOf(
      await opList(
        stub({
          getWorkspaceId: () => ROOM,
          listAgentTemplatesPayload: async () => ({
            templates: [template(), orphan, mine],
            homeScopedTemplateIds: [mine.id],
          }),
        }) as DoplClient,
        ROOM_IS_CHANNEL,
      ),
    );
    expect(text).toContain("### Shared in this channel");
    expect(text).toContain("### Legacy — not visible anywhere in the app");
    expect(text).toContain("### Home (personal)");
    // ⚠ **NO UNDIFFERENTIATED "Private to you"** — that heading spanned both
    // destinations and is what made an agent treat an orphan as a live row.
    expect(text).not.toContain("Private to you");
  });

  it("a STANDARD workspace keeps the visibility headings", async () => {
    const text = textOf(
      await opList(
        stub({
          getWorkspaceId: () => "ws-standard",
          listAgentTemplatesPayload: async () => ({
            templates: [template({ visibility: "private" })],
            homeScopedTemplateIds: [],
          }),
        }) as DoplClient,
        directory({ "ws-standard": "workspace" }),
      ),
    );
    expect(text).toContain("### Private to you");
    expect(text).not.toContain("Shared in this channel");
  });

  it("dopl_kb splits on the GRANT, not on the visibility column", async () => {
    const shared = base({ id: "kb-shared", name: "Shared", slug: "shared" });
    const orphan = base({ id: "kb-orphan", name: "Orphan", slug: "orphan" });
    const mine = base({ id: "kb-mine", name: "Mine", slug: "mine", workspaceId: HOME });
    const text = textOf(
      await opListBases(
        stub({
          getWorkspaceId: () => ROOM,
          getHomeChannels: async () => CHANNELS,
          listKbBasesPayload: async (opts: { channelId?: string }) => {
            expect(opts.channelId).toBe(CHANNEL);
            return {
              bases: [shared, orphan, mine],
              homeScopedBaseIds: [mine.id],
              channelGrants: { "kb-shared": { level: "visible", guestWrite: false } },
            };
          },
        }) as DoplClient,
        ROOM_IS_CHANNEL,
      ),
    );
    expect(text).toContain("### Shared in this channel");
    expect(text).toContain("### Legacy — not visible anywhere in the app");
    expect(text).toContain("### Home (personal)");
  });
});

// ── 4. §8 — A STALE PAYLOAD IS A STATE, NOT A CRASH ─────────────────────────

describe("🔒 §8 — a cached payload missing the sibling keys", () => {
  it("dopl_agent: no `homeScopedTemplateIds` ⇒ no personal heading, no crash", async () => {
    const text = textOf(
      await opList(
        stub({
          getWorkspaceId: () => ROOM,
          // ⚠ THE KEY IS ABSENT, not empty — a bundle that predates it.
          listAgentTemplatesPayload: async () => ({ templates: [template()] }),
        }) as DoplClient,
        ROOM_IS_CHANNEL,
      ),
    );
    expect(text).toContain("### Shared in this channel");
    expect(text).not.toContain("Home (personal)");
  });

  it("dopl_kb: no `channelGrants` and no `homeScopedBaseIds` ⇒ the flat list, no crash", async () => {
    // ⚠ **ABSENT IS "NOT ASKED", NEVER "NONE GRANTED".** Reading `{}` as "none"
    // would file every row in the channel under LEGACY on a stale payload —
    // stating a grant fact this response never measured.
    const text = textOf(
      await opListBases(
        stub({
          getWorkspaceId: () => ROOM,
          getHomeChannels: async () => CHANNELS,
          listKbBasesPayload: async () => ({ bases: [base()] }),
        }) as DoplClient,
        ROOM_IS_CHANNEL,
      ),
    );
    expect(text).toContain("Handover");
    expect(text).not.toContain("Legacy — not visible anywhere in the app");
  });
});
