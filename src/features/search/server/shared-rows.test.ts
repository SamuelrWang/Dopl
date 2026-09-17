/**
 * 🔒 **ROWS LENT INTO A CONTAINER ARE FINDABLE, AND TEAM-SCOPED ONES ARE NOT
 * FINDABLE BY THE WRONG PERSON (F-716, RESOLVED 2026-09-17).**
 *
 * The old fence was `visibility = <widest> OR <owner> = caller`, written in SQL.
 * F-716 filed it as a MISS. It was also a LEAK: `visibility='public'` admits an
 * `access_mode='teams'` row, which `canSeeSkill` / `canSeeChat` refuse to a
 * member of none of the granted teams. **Both directions are pinned here**, over
 * the real repositories and a filtering in-memory database — INVARIANTS §14: a
 * `WHERE` clause that was WRITTEN is not a row that was EXCLUDED.
 *
 * ⚠ **AND THE LAST DESCRIBE IS THE PIN F-716 SAID WAS MISSING** — *"the subset
 * relationship is the claim and it is not pinned"* — in
 * `shared/tenancy/grant-read-arm.test.ts`'s idiom: a COMBINATION sweep asserting
 * the property rather than examples of it.
 *
 *   > **what search returns is exactly what the owning feature's `canSee*`
 *   > admits** — not a subset of it, and not a superset.
 *
 * A subset would be a silent miss; a superset is a leak. Asserting EQUALITY is
 * what makes a predicate that gains a NARROWING arm tomorrow fail here instead
 * of quietly disagreeing with its own page.
 *
 * MUTATION-VERIFY: 4 reverts, 4 failures, 0 vacuous (2026-09-17) — putting the
 * `visibility` SQL arm back on skills, dropping the grant read from
 * `visibleBases`, dropping `access_mode` from the skills projection, and
 * widening the container fence to every row each turn a case here red.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { supabaseAdmin } from "@/shared/supabase/admin";
import { canSeeSkill } from "@/features/skills/server/service-shared";
import type { Skill } from "@/features/skills/types";
import { fakeDb, type FakeTables } from "./_fake-db";
import { listReadableBases, searchSkills } from "./repository-container-rows";
import type { SearchCaller } from "./repository-visibility";

const ME = "11111111-1111-1111-1111-111111111111";
const PEER = "22222222-2222-2222-2222-222222222222";
const WS = "33333333-3333-3333-3333-333333333333";
const WS_TOO = "44444444-4444-4444-4444-444444444444";
const TEAM = "55555555-5555-5555-5555-555555555555";

const caller = (over: Partial<SearchCaller> = {}): SearchCaller => ({
  userId: ME,
  ownerUserId: ME,
  credentialSubjectUserId: ME,
  roleByContainer: new Map([
    [WS, "member"],
    [WS_TOO, "member"],
  ]),
  ...over,
});

function mount(tables: FakeTables) {
  const { client } = fakeDb(tables);
  vi.mocked(supabaseAdmin).mockReturnValue(client as never);
}

const base = (over: Record<string, unknown> = {}) => ({
  id: "kb-lent",
  name: "Handbook",
  workspace_id: WS,
  visibility: "private",
  created_by: PEER,
  deleted_at: null,
  ...over,
});

const containerGrant = (over: Record<string, unknown> = {}) => ({
  resource_type: "knowledge_base",
  resource_id: "kb-lent",
  scope_type: "container",
  scope_id: WS,
  level: "read",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("🔒 a row LENT into a container the caller is in", () => {
  it("is found — the arm the old SQL fence did not have", async () => {
    mount({
      knowledge_bases: [base()],
      resource_grants: [containerGrant()],
      workspace_members: [
        { workspace_id: WS, user_id: ME, status: "active", role: "member" },
      ],
    });
    const found = await listReadableBases([WS], caller());
    expect([...found.keys()]).toEqual(["kb-lent"]);
  });

  it("🔒 is NOT found when nothing lent it", async () => {
    mount({ knowledge_bases: [base()], resource_grants: [] });
    // A peer's private base, no grant: the answer the fence has always given,
    // restated so widening it cannot pass unnoticed.
    expect([...(await listReadableBases([WS], caller())).keys()]).toEqual([]);
  });

  it("🔒 is NOT found through an `agent_only` channel grant", async () => {
    mount({
      knowledge_bases: [base()],
      // ⚠ TWO AUDIENCES, NOT A HIGH/LOW PAIR — `agent_only` names the AGENT's
      // ceiling and must not widen a person's read
      // (`shared/tenancy/resource-grant-reach.ts`).
      resource_grants: [
        containerGrant({ scope_type: "channel", scope_id: "ch-1", level: "agent_only" }),
      ],
      channel_members: [{ channel_id: "ch-1", user_id: ME }],
    });
    expect([...(await listReadableBases([WS], caller())).keys()]).toEqual([]);
  });

  it("🔒 is NOT found by a credential standing for NOBODY", async () => {
    mount({
      knowledge_bases: [base()],
      resource_grants: [containerGrant()],
      workspace_members: [
        { workspace_id: WS, user_id: ME, status: "active", role: "member" },
      ],
    });
    // Arm 2 of every predicate: such a credential has no membership of the
    // granted scope to read the grant through, so it keeps the cheap SQL arm.
    const anon = caller({ ownerUserId: null, credentialSubjectUserId: null });
    expect([...(await listReadableBases([WS], anon)).keys()]).toEqual([]);
  });
});

describe("account scope spans containers", () => {
  it("finds a row lent from ANOTHER container the caller is also in", async () => {
    mount({
      knowledge_bases: [base({ id: "kb-far", workspace_id: WS_TOO })],
      resource_grants: [containerGrant({ resource_id: "kb-far", scope_id: WS })],
      workspace_members: [
        { workspace_id: WS, user_id: ME, status: "active", role: "member" },
        { workspace_id: WS_TOO, user_id: ME, status: "active", role: "member" },
      ],
    });
    const found = await listReadableBases([WS, WS_TOO], caller());
    expect([...found.keys()]).toEqual(["kb-far"]);
  });

  it("🔒 never names a container the caller is not in, grant or no grant", async () => {
    mount({
      knowledge_bases: [base({ id: "kb-foreign", workspace_id: "ws-theirs" })],
      resource_grants: [
        containerGrant({ resource_id: "kb-foreign", scope_id: WS }),
      ],
      workspace_members: [
        { workspace_id: WS, user_id: ME, status: "active", role: "member" },
      ],
    });
    // ⚠ **A GRANT WIDENS VISIBILITY, NEVER THE CANDIDATE SET.** The container
    // fence is the reach, and the reach is the only thing a query may name.
    expect([...(await listReadableBases([WS], caller())).keys()]).toEqual([]);
  });
});

const skill = (over: Record<string, unknown> = {}) => ({
  id: "sk-1",
  name: "Tax filing",
  description: null,
  workspace_id: WS,
  updated_at: "2026-09-01T00:00:00Z",
  visibility: "public",
  access_mode: "teams",
  created_by: PEER,
  deleted_at: null,
  ...over,
});

describe("🔒 a TEAM-scoped row is not visible to the wrong member", () => {
  it("is found by a member of a granted team", async () => {
    mount({
      skills: [skill()],
      team_members: [{ team_id: TEAM, user_id: ME, workspace_id: WS }],
      resource_grants: [
        {
          resource_type: "skill",
          resource_id: "sk-1",
          scope_type: "team",
          scope_id: TEAM,
          level: "read",
        },
      ],
    });
    expect((await searchSkills(WS, "tax", caller())).map((h) => h.id)).toEqual([
      "sk-1",
    ]);
  });

  it("🔒 is NOT found by a member of no granted team — the arm the OLD fence leaked", async () => {
    mount({ skills: [skill()], team_members: [], resource_grants: [] });
    // ⚠ `visibility='public'` ADMITTED THIS ROW under the SQL fence, and
    // `canSeeSkill` refuses it. F-716's "strict subset, so it can only be a
    // miss" was half true; this is the other half.
    expect(await searchSkills(WS, "tax", caller())).toEqual([]);
  });

  it("is found by a workspace ADMIN of that container", async () => {
    mount({ skills: [skill()], team_members: [], resource_grants: [] });
    const admin = caller({ roleByContainer: new Map([[WS, "admin"]]) });
    expect((await searchSkills(WS, "tax", admin)).map((h) => h.id)).toEqual([
      "sk-1",
    ]);
  });

  it("🔒 and admin ELSEWHERE is not admin HERE", async () => {
    mount({ skills: [skill()], team_members: [], resource_grants: [] });
    // The role map is per container precisely so this question has an answer.
    const elsewhere = caller({ roleByContainer: new Map([[WS_TOO, "admin"]]) });
    expect(await searchSkills(WS, "tax", elsewhere)).toEqual([]);
  });
});

/**
 * 🔒 **THE PIN F-716 ASKED FOR — the arms are not a subset, they are the SAME
 * ARMS.** `grant-read-arm.test.ts`'s idiom: a property over every combination,
 * driven through the REAL repository (so a SQL arm put back would fail here)
 * and compared against the feature's own predicate called directly.
 */
describe("🔒 search admits exactly what canSeeSkill admits", () => {
  const CREDENTIALS = {
    "a person at their keyboard": { ownerUserId: ME, credentialSubjectUserId: ME },
    "a credential standing for nobody": {
      ownerUserId: null,
      credentialSubjectUserId: null,
    },
  } as const;
  const ROLES = ["member", "admin"] as const;
  const VISIBILITIES = ["public", "private"] as const;
  const MODES = ["workspace", "teams"] as const;
  const AUTHORS = { mine: ME, "a peer's": PEER } as const;

  let moved = 0;

  for (const [credName, cred] of Object.entries(CREDENTIALS)) {
    for (const role of ROLES) {
      for (const visibility of VISIBILITIES) {
        for (const accessMode of MODES) {
          for (const [authorName, createdBy] of Object.entries(AUTHORS)) {
            it(`${credName} · ${role} · ${visibility}/${accessMode} · ${authorName}`, async () => {
              const row = skill({ visibility, access_mode: accessMode, created_by: createdBy });
              mount({ skills: [row], team_members: [], resource_grants: [] });
              const who = caller({
                ...cred,
                roleByContainer: new Map([[WS, role]]),
              });

              const viaSearch = (await searchSkills(WS, "tax", who)).length === 1;
              const viaPredicate = canSeeSkill(
                {
                  workspaceId: WS,
                  userId: ME,
                  source: "user",
                  role,
                  apiKeyWorkspaceId: null,
                  credentialSubjectUserId: cred.credentialSubjectUserId,
                },
                {
                  id: row.id,
                  visibility,
                  accessMode,
                  createdBy,
                } as unknown as Skill,
                { myTeamIds: new Set(), bySkill: new Map() }
              );
              expect(viaSearch).toBe(viaPredicate);
              if (viaPredicate) moved += 1;
            });
          }
        }
      }
    }
  }

  it("the property is not vacuous — some combinations ARE visible", () => {
    // ⚠ Without this the sweep above would pass if search returned nothing at
    // all, which is the failure mode an equality property cannot see by itself.
    expect(moved).toBeGreaterThan(0);
  });
});
