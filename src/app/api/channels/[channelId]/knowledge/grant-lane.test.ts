/**
 * 🔒 THE GUEST KNOWLEDGE LANE — THE ADVERSARIAL PIN, PART 1: THE CHANNEL AND
 * BASE FENCES (Home Knowledge Panels M2, plan §3.5; INVARIANTS §4A).
 *
 * A guest reaches knowledge ONLY through a `(knowledge_base, channel)` grant at
 * `visible`. These two files are the proof, written as an attack list rather
 * than a feature list: all but one assertion is a thing the lane must REFUSE.
 *
 *   HERE          : ① non-member ×4 pairs · ② the VIEWER on the public arm ·
 *                   ③ `agent_only` · ④ ungranted · ⑨ dead base · ⑩ the ABSENCE pin
 *   `grant-lane-entries.test.ts` : ⑤ read-only grant · ⑥ the guest write ·
 *                   ⑦ an entry chased up to an ungranted base · ⑧ cross-workspace
 *
 * ⚠ SPLIT ONLY BY THE 500-LINE CAP (§1) — the ten assertions are ONE contract.
 * Fixtures and mock wiring are shared through `lane-harness.ts`; the `vi.mock`
 * list stays in each file, because what a suite mocks is part of what it claims.
 *
 * ⚠ IT DRIVES THE REAL SERVICE AND THE REAL FENCES. Only the REPOSITORY layer,
 * the auth wrapper and the embedding scheduler are mocked. `loadVisibleChannel`,
 * `assertGrantVisible`, `assertGrantWritable`, `listGrantedBases`,
 * `getGrantedBaseTree`, `getGrantedEntry` and `updateGrantedEntry` all run for
 * real, composed by the real route handlers — a behavioural mock of any of them
 * would pass while the fence was gone, which is the failure mode the
 * `link-container-guard` technique exists to catch.
 *
 * ⚠ THE WRAPPER IS MOCKED, SO NO ASSERTION HERE SEES THE `minRole:"guest"`
 * FLOOR. That is `guest-route-floor.test.ts`'s job, and it reads route SOURCE
 * for exactly this reason. What these files test is everything BEHIND the floor.
 *
 * ⚠ MUTATION-VERIFY, MEASURED 2026-08-26 — 8 reverts, 8 failures, 0 vacuous,
 * over the four suites that cover this lane (120 tests: both pin files, the
 * floor pin, and the grant repo/service suites):
 *   1. drop `if (membership === null)` in `channel-knowledge-lane.ts`     : 5 red
 *   2. `row === null || row.level !== "visible"` → `row === null`         : 1 red
 *   3. drop `.eq("level", level)` in `listChannelGrantsAtLevel`           : 2 red
 *   4. drop `b.deletedAt === null` from `listGrantedBases`                : 2 red
 *   5. `findBaseById(baseId, false)` → `true` (admit a dead base)         : 1 red
 *   6. drop `!grant.guestWrite` from `assertGrantWritable`                : 1 red
 *   7. drop `entry.workspaceId !== ctx.workspaceId`                       : 1 red
 *   8. drop the grant gate in `resolveGrantedEntry`                       : 2 red
 * Reverts 2, 5 and 8 produce a WRONG 200 rather than a wrong 404 — the three
 * worth having.
 *
 * ⚠ REVERT 3 WAS VACUOUS ON FIRST MEASUREMENT, AND THAT IS WHY THE REPOSITORY
 * SUITE IS IN THE LIST. These files MOCK `repository-channel-grants`, so
 * deleting the `level` predicate from the real SQL left everything here green
 * while every `agent_only` grant in the container entered a guest's base list.
 * The fix was a pin one layer down (`repository-channel-grants.test.ts ›
 * listChannelGrantsAtLevel`), not a louder assertion here: a service test cannot
 * see a filter its own mock replaced.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { KnowledgeBase } from "@/features/knowledge/types";

vi.mock("@/shared/auth/with-workspace-auth", () => ({
  withWorkspaceAuth:
    (handler: (req: Request, ctx: Record<string, unknown>) => Promise<Response>) =>
    (req: Request, routeCtx: { params: Promise<Record<string, string>> }) =>
      routeCtx.params.then(async (params) => {
        // ⚠ DYNAMIC import: `vi.mock` is hoisted above the static imports, and a
        // top-level binding would be in its temporal dead zone when the factory
        // is evaluated.
        const { authState } = await import("./lane-harness");
        return handler(req, { ...authState.current, params });
      }),
}));

vi.mock("@/shared/supabase/admin", () => ({
  // A marker, not a client. Nothing here reaches Postgres: every repository
  // module that would use it is mocked, and the ONE real consumer left
  // (`service-storage.ts › resolveKbStorageLimit`) is documented to fail OPEN on
  // an unreadable meter, which is what a marker object produces.
  supabaseAdmin: () => ({ __marker: "admin-client" }),
}));

vi.mock("@/features/channels/server/repository");
vi.mock("@/features/channels/server/repository-messages");
vi.mock("@/features/channels/server/repository-collab");
vi.mock("@/features/knowledge/server/repository");
vi.mock("@/features/knowledge/server/repository-channel-grants");
vi.mock("@/features/knowledge/server/embeddings", () => ({
  scheduleEntryEmbedding: vi.fn(),
}));

import * as channelRepo from "@/features/channels/server/repository";
import * as kbRepo from "@/features/knowledge/server/repository";
import * as grantRepo from "@/features/knowledge/server/repository-channel-grants";

import { GET as BASES_GET } from "./bases/route";
import { GET as TREE_GET } from "./bases/[baseId]/tree/route";
import { GET as ENTRY_GET, PUT as ENTRY_PUT } from "./entries/[entryId]/route";
import {
  authState,
  basesReq,
  body,
  channelRow,
  CHANNEL,
  entryPutReq,
  entryReq,
  E_READ,
  E_WRITE,
  GRANTS,
  KB_AGENT,
  KB_DEAD,
  KB_NONE,
  KB_READ,
  KB_WRITE,
  makeAuth,
  treeReq,
  VIEWER,
  wireLaneMocks,
  withoutId,
  WS,
} from "./lane-harness";

/** Every pair of the lane, so a fence can be asserted across ALL FOUR rather
 *  than on whichever one the test author happened to reach for. */
const ALL_ROUTES: ReadonlyArray<readonly [string, () => Promise<Response>]> = [
  ["GET  …/knowledge/bases", () => BASES_GET(...basesReq())],
  ["GET  …/knowledge/bases/{id}/tree", () => TREE_GET(...treeReq(KB_READ))],
  ["GET  …/knowledge/entries/{id}", () => ENTRY_GET(...entryReq(E_READ))],
  [
    "PUT  …/knowledge/entries/{id}",
    () => ENTRY_PUT(...entryPutReq(E_WRITE, { body: "after" })),
  ],
];

beforeEach(() => {
  vi.clearAllMocks();
  wireLaneMocks();
});

// ════════════════════════════════════════════════════════════════════
// ① NON-MEMBER — all four pairs
// ════════════════════════════════════════════════════════════════════
describe("1. a workspace member who is NOT in the channel reaches nothing", () => {
  beforeEach(() => {
    // A PRIVATE channel and no `channel_members` row: `loadVisibleChannel`'s own
    // not-found arm.
    vi.mocked(channelRepo.findMembership).mockResolvedValue(null);
  });

  it.each(ALL_ROUTES)("%s → 404", async (_label, call) => {
    const res = await call();
    expect(res.status).toBe(404);
    // NOT-FOUND, never FORBIDDEN — a 403 would confirm the channel is there.
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe(
      "CHANNEL_NOT_FOUND"
    );
  });

  it("and never reads a grant row on the way out", async () => {
    await Promise.all(ALL_ROUTES.map(([, call]) => call()));
    expect(grantRepo.listChannelGrantsAtLevel).not.toHaveBeenCalled();
    expect(grantRepo.findChannelKnowledgeGrant).not.toHaveBeenCalled();
    expect(kbRepo.updateEntryRow).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// ② THE REGRESSION-PRONE ONE — a VIEWER on the PUBLIC arm
// ════════════════════════════════════════════════════════════════════
describe("2. a workspace VIEWER on a PUBLIC channel they never joined reaches nothing", () => {
  beforeEach(() => {
    // 🔒 The exact shape the plan called out. `mayReadPublicChannels` is TRUE for
    // a viewer, so `loadVisibleChannel` RETURNS — successfully, with
    // `membership: null`. Only the lane's own `membership !== null` refuses it.
    // F-327: nothing stops a public channel existing inside a container.
    authState.current = makeAuth("viewer", VIEWER);
    vi.mocked(channelRepo.findChannelById).mockResolvedValue(channelRow("public"));
    vi.mocked(channelRepo.findMembership).mockResolvedValue(null);
  });

  it.each(ALL_ROUTES)("%s → 404", async (_label, call) => {
    expect((await call()).status).toBe(404);
  });

  it("the fence is the LANE's, not `loadVisibleChannel`'s — it ADMITTED this caller", async () => {
    // Stated positively so the suite cannot pass for the wrong reason: prove the
    // channels gate says YES here, and the refusal above is therefore the one
    // line in `shared/api/channel-knowledge-lane.ts`.
    const { loadVisibleChannel } = await import(
      "@/features/channels/server/service"
    );
    const { channel, membership } = await loadVisibleChannel(
      {
        workspaceId: WS,
        userId: VIEWER,
        source: "user",
        role: "viewer",
        credentialSubjectUserId: VIEWER,
      },
      CHANNEL
    );
    expect(channel.id).toBe(CHANNEL);
    expect(membership).toBeNull();
  });

  it("…and a GUEST is refused one fence earlier, by the public-arm rule itself", async () => {
    authState.current = makeAuth("guest");
    expect((await BASES_GET(...basesReq())).status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════
// ③ agent_only — 404 AND omitted from the list
// ════════════════════════════════════════════════════════════════════
describe("3. an `agent_only` grant is invisible to a person, both ways", () => {
  it("the base is OMITTED from the list", async () => {
    const res = await BASES_GET(...basesReq());
    expect(res.status).toBe(200);
    const out = await body<{ bases: KnowledgeBase[] }>(res);
    expect(out.bases.map((b) => b.id)).not.toContain(KB_AGENT);
  });

  it("and 404s when named directly — existence must not leak", async () => {
    // Not a lower level: a DIFFERENT AUDIENCE. The operator said "my agent may
    // read this here"; the guest in the room was not in that sentence.
    expect((await TREE_GET(...treeReq(KB_AGENT))).status).toBe(404);
  });

  it("the level filter is pushed into SQL, so the row never enters the process", async () => {
    await BASES_GET(...basesReq());
    expect(grantRepo.listChannelGrantsAtLevel).toHaveBeenCalledWith(
      { __marker: "admin-client" },
      WS,
      CHANNEL,
      "visible",
      200
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// ④ no grant at all
// ════════════════════════════════════════════════════════════════════
describe("4. an UNGRANTED base is 404, and reads exactly like one that does not exist", () => {
  it("404 on the tree", async () => {
    expect((await TREE_GET(...treeReq(KB_NONE))).status).toBe(404);
  });

  it("the same 404, code for code, as a uuid naming nothing at all", async () => {
    const ABSENT = "cccccccc-0000-4000-8000-00000000ffff";
    const ungranted = await TREE_GET(...treeReq(KB_NONE));
    const nonexistent = await TREE_GET(...treeReq(ABSENT));
    expect(ungranted.status).toBe(nonexistent.status);
    expect(await withoutId(ungranted, KB_NONE)).toEqual(
      await withoutId(nonexistent, ABSENT)
    );
  });

  it("a MALFORMED base id is that same 404, not a 500", async () => {
    // It would otherwise reach a `uuid =` filter as a 22P02 cast failure — a 500
    // and a `system_events` row for every probe.
    const res = await TREE_GET(...treeReq("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(grantRepo.findChannelKnowledgeGrant).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑨ a grant whose base is gone
// ════════════════════════════════════════════════════════════════════
describe("9. a `visible` grant on a DELETED base grants nothing", () => {
  it("404 on the tree, though the grant row is there and says `visible`", async () => {
    expect(GRANTS.find((g) => g.resource_id === KB_DEAD)?.level).toBe("visible");
    expect((await TREE_GET(...treeReq(KB_DEAD))).status).toBe(404);
  });

  it("and it is dropped from the list rather than rendered as an empty base", async () => {
    const out = await body<{
      bases: KnowledgeBase[];
      grants: Record<string, unknown>;
    }>(await BASES_GET(...basesReq()));
    expect(out.bases.map((b) => b.id)).not.toContain(KB_DEAD);
    expect(out.grants[KB_DEAD]).toBeUndefined();
  });

  it("what SURVIVES is exactly the two live `visible` grants", async () => {
    // The positive half, so none of the exclusions above can pass vacuously.
    const out = await body<{
      bases: KnowledgeBase[];
      grants: Record<string, { level: string; guestWrite: boolean }>;
    }>(await BASES_GET(...basesReq()));
    expect(out.bases.map((b) => b.id).sort()).toEqual([KB_READ, KB_WRITE].sort());
    expect(out.grants[KB_READ]).toEqual({ level: "visible", guestWrite: false });
    expect(out.grants[KB_WRITE]).toEqual({ level: "visible", guestWrite: true });
  });
});

// ════════════════════════════════════════════════════════════════════
// ⑩ THE ABSENCE PIN
// ════════════════════════════════════════════════════════════════════
describe("10. the lane names no workspace gate (the link-container-guard technique)", () => {
  /**
   * ⚠ A BEHAVIOURAL TEST CANNOT SEE THIS. Routing the lane through
   * `assertBaseVisible` / `requireEffectiveAccess` / `canSeeBase` would look like
   * a tidy-up and would silently refuse every guest — `defaultLevelForRole
   * ("guest")` is `null` — while every fixture above still passed at role
   * `member`. So the SOURCE is read.
   *
   * ⚠ BOTH lane modules are scanned. M0 pinned `service-channel-grants.ts`
   * alone; M2 split the payloads into `service-channel-lane.ts`, and a pin that
   * covers one of two files is a pin with a door in it.
   */
  const LANE_MODULES = ["service-channel-grants.ts", "service-channel-lane.ts"] as const;

  const source = (name: string) =>
    readFileSync(
      resolve(__dirname, "../../../../../features/knowledge/server", name),
      "utf8"
    );

  it.each(LANE_MODULES)("%s imports nothing from service-shared", (name) => {
    // An import statement, not the docblock explaining its absence.
    expect(source(name)).not.toMatch(/from\s+["'][^"']*service-shared/);
  });

  it.each(LANE_MODULES)("%s calls no workspace visibility gate", (name) => {
    expect(source(name)).not.toMatch(
      /canSeeBase\(|assertBaseVisible\(|assertBaseWritable\(|requireEffectiveAccess\(|filterTeamVisibleBases\(/
    );
  });

  it("and reaches no base/tree/entry read that composes one", () => {
    // `getBaseById`, `getBaseTree` and `getEntry` all pass through the workspace
    // gate on the way to their payload. The lane re-composes from the REPOSITORY
    // readers instead, which is the difference between reusing a QUERY and
    // reusing an AUDIENCE.
    for (const name of LANE_MODULES) {
      expect(source(name)).not.toMatch(
        /from\s+["']\.\/(service-bases|service-folders|service-entries)["']/
      );
    }
  });

  it("the modules the lane DOES reuse are the repository readers", () => {
    // Positive half: an absence pin that would also pass on an empty file is not
    // a pin. §3.3 asks for reuse of the readers and the DTO, and here it is.
    const lane = source("service-channel-lane.ts");
    expect(lane).toMatch(/from\s+["']\.\/repository["']/);
    expect(lane).toMatch(/repo\.listFoldersForBase\(/);
    expect(lane).toMatch(/repo\.listEntriesForBase\(/);
    expect(lane).toMatch(/repo\.findEntryById\(/);
  });
});
