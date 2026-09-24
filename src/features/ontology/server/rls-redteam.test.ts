/**
 * REDTEAM — the POLICY, alone, admits and refuses what
 * `./service-shared.ts › canSeeOntology` admits and refuses, over the four
 * ontology tables and the share row (slice S1, `docs/specs/home-ontology.md`
 * §3.2/§3.3; Samuel's ruling B5, *"RLS is the fence"*).
 *
 * Two halves, and only one of them runs here. The SQL half replays every
 * migration and asserts on the final policy and function bodies; the live half
 * is `skipIf(!liveRedteamEnabled)` and needs a local stack. **A STRUCTURAL
 * ASSERTION IS NOT A BEHAVIOURAL ONE (F-523)**: the text pins prove the rule is
 * WRITTEN once and name every arm; only CI's `rls-redteam` job proves Postgres
 * agrees. Say it that way in any doc that cites this file.
 *
 * The twin's own truth table is `./service-shared.test.ts`: that file asserts
 * what the PREDICATE answers, this one that the SQL says the same thing.
 *
 * Mutation-verified (2026-09-09): 8 reverts, 8 failures.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { livePolicies, liveFunction } from "@/shared/supabase/rls-policy-scan";
import {
  deleteUsers,
  deleteWorkspace,
  liveRedteamEnabled,
  makeUser,
  addMember,
  makeWorkspace,
  readableIds,
} from "@/shared/supabase/rls-redteam-fixture";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { generatePublicId } from "@/shared/lib/id/public-id";

const POLICIES = livePolicies();

const SELECT_POLICY = {
  ontologies: "ontologies.ontologies_member_select",
  ontology_objects: "ontology_objects.ontology_objects_member_select",
  ontology_memberships: "ontology_memberships.ontology_memberships_member_select",
  ontology_relationships:
    "ontology_relationships.ontology_relationships_member_select",
  ontology_channel_shares:
    "ontology_channel_shares.ontology_channel_shares_member_select",
} as const;

/** "May the caller read this ontology?" — the rule, written once. */
const READABLE = "dopl_ontology_readable";
const WRITABLE = "dopl_ontology_writable";
const SHARE_LEVEL = "dopl_ontology_share_level";
const RANK = "dopl_ontology_level_rank";

const CHILDREN = [
  "ontology_objects",
  "ontology_memberships",
  "ontology_relationships",
] as const;

const policy = (key: string) => POLICIES.get(key) ?? "";

describe("REDTEAM ontology — the SHARE arm (Samuel 2026-09-09)", () => {
  it("🔒 is OR-ed onto a CLOSED membership group, never AND-ed into one", () => {
    // The POSITION is the assertion: a share's reader is by definition not a
    // member of the ontology's container — reaching it through the CHANNEL's is
    // the point — so an arm conjoined with `is_current_workspace_member` could
    // only ever narrow, and the share row would be a row nothing reads.
    // That is `20260923140000` §3b's defect, pinned before it can happen.
    for (const fn of [READABLE, WRITABLE]) {
      const body = liveFunction(fn);
      expect(body, fn).toMatch(
        /\) OR \( NOT public\.dopl_credential_is_shared\(\) AND public\.dopl_ontology_level_rank\(/i
      );
      expect(body, fn).not.toMatch(
        /is_current_workspace_member\([^)]*\)\s*AND\s+public\.dopl_ontology_level_rank/i
      );
    }
  });

  it("🔒 …and it carries the SHARED-CREDENTIAL refusal with it (M-10 / F-336)", () => {
    // A credential standing for NOBODY has no membership of the channel to read
    // the share THROUGH. `canSeeOntology` refuses it in `sharedOntologyLevel`;
    // the policy must refuse it in the same arm, not at the top — at the top it
    // would also refuse a row the CONTAINER arm already admits.
    for (const fn of [READABLE, WRITABLE]) {
      expect(liveFunction(fn), fn).toMatch(
        /NOT public\.dopl_credential_is_shared\(\) AND public\.dopl_ontology_level_rank/i
      );
    }
  });

  it("🔒 the container arm SURVIVES on all four tables — this wave only widens", () => {
    // Ontology has been workspace-scoped since `20260706120000` (spec R1-R4).
    // Narrowing the container arm here would blank every standard-workspace board
    // for a sharing feature those boards do not use; the narrowing Samuel's
    // matrix asks for is the SERVICE's (spec I6/§4).
    expect(liveFunction(READABLE)).toMatch(
      /is_current_workspace_member\(\s*o\.workspace_id,\s*'viewer'/i
    );
    expect(liveFunction(WRITABLE)).toMatch(
      /is_current_workspace_member\(\s*o\.workspace_id,\s*'editor'/i
    );
    for (const table of CHILDREN) {
      expect(policy(SELECT_POLICY[table]), table).toMatch(
        /is_current_workspace_member\(\s*workspace_id,\s*'viewer'/i
      );
    }
  });

  it("🔒 membership is the CALLER-PINNED form — never the 3-arg oracle M-9 closed", () => {
    for (const fn of [READABLE, WRITABLE, SHARE_LEVEL]) {
      expect(liveFunction(fn), fn).not.toMatch(/[^_]is_workspace_member\(/i);
    }
  });
});

describe("REDTEAM ontology — the CLASS split (Q1) and the ladder (I2)", () => {
  it("🔒 a GUEST reads `guests_level` and everyone else `members_level`", () => {
    // The sharpest single case in Samuel's matrix: the same share row answers two
    // audiences, and a policy that read one column for both would hand every
    // guest the members' level.
    expect(liveFunction(SHARE_LEVEL)).toMatch(
      /CASE WHEN wm\.role = 'guest' THEN s\.guests_level ELSE s\.members_level END/i
    );
  });

  it("🔒 the caller must be IN THE ROOM and ACTIVE — Q3, at rest", () => {
    // Revocation is immediate: a removed member has no active `workspace_members`
    // row, a revoked guest link the same, and a deleted channel is not a room.
    const body = liveFunction(SHARE_LEVEL);
    expect(body).toMatch(/public\.is_channel_member\(\s*s\.channel_id\s*\)/i);
    expect(body).toMatch(/wm\.user_id = \(\s*SELECT auth\.uid\(\)\s*\)/i);
    expect(body).toMatch(/wm\.status = 'active'/i);
    expect(body).toMatch(/ch\.deleted_at IS NULL/i);
  });

  it("🔒 no `workspace_id` term in the share arm — the cross-container lend", () => {
    // The share row is filed under the ONTOLOGY's container while the caller
    // reaches it through the CHANNEL's (`20260914120000` rule 3). A
    // `workspace_id` predicate here would refuse exactly the lend the feature is.
    expect(liveFunction(SHARE_LEVEL)).not.toMatch(/s\.workspace_id/i);
  });

  it("🔒 the ladder ORDERS, and an unknown word is BELOW the floor", () => {
    const body = liveFunction(RANK);
    expect(body).toMatch(/WHEN 'edit' THEN 2/i);
    expect(body).toMatch(/WHEN 'view' THEN 1/i);
    expect(body).toMatch(/WHEN 'none' THEN 0/i);
    expect(body).toMatch(/ELSE -1/i);
    // `edit ⇒ view` needs no second statement: one column holding one rung
    // cannot be `edit` without being `view`. What CAN drift is the comparison,
    // so the comparison is asserted instead — `>= 1` reads, `>= 2` writes.
    expect(liveFunction(READABLE)).toMatch(/\)\s*\) >= 1/);
    expect(liveFunction(WRITABLE)).toMatch(/\)\s*\) >= 2/);
  });
});

describe("REDTEAM ontology — the CHILD tables (R5)", () => {
  it("🔒 each defers to the PARENT's rule and restates no share rule of its own", () => {
    // The 2026-08-26 entry-body leak's shape, kept closed: a child policy that
    // stated its own rule would be a second place every future arm has to land.
    for (const table of CHILDREN) {
      const body = policy(SELECT_POLICY[table]);
      expect(body, table).toContain(`${READABLE}(`);
      expect(body, table).not.toMatch(/ontology_channel_shares/i);
      expect(body, table).not.toMatch(/dopl_credential_is_shared/i);
      expect(body, table).not.toMatch(/members_level|guests_level/i);
    }
  });

  it("🔒 an object reaches its ontology by the WALK, not by a column it has not got", () => {
    // `ontology_memberships` names a PARENT OBJECT for a card and an ONTOLOGY only
    // for a column (spec R5), so a one-level join would leave every card
    // invisible to the reader the share is for.
    expect(policy(SELECT_POLICY.ontology_objects)).toMatch(
      /dopl_ontology_object_ontologies\(\s*ontology_objects\.id\s*\)/i
    );
    expect(liveFunction("dopl_ontology_object_ontologies")).toMatch(
      /WITH RECURSIVE/i
    );
    // `UNION`, not `UNION ALL`: the de-duplication is what terminates a cycle.
    expect(liveFunction("dopl_ontology_object_ontologies")).not.toMatch(
      /UNION ALL/i
    );
  });

  it("🔒 an EDGE needs BOTH endpoints readable — Q8's boundary", () => {
    const body = policy(SELECT_POLICY.ontology_relationships);
    expect(body).toMatch(/source_object_id/i);
    expect(body).toMatch(/target_object_id/i);
    expect(body).toMatch(/\)\s*\)\s*AND EXISTS \(/i);
  });

  it("does NOT hide soft-deleted rows — trash is a repository filter, not a fence", () => {
    for (const key of Object.values(SELECT_POLICY)) {
      expect(policy(key), key).not.toMatch(/deleted_at/i);
    }
  });
});

describe("REDTEAM ontology_channel_shares — the settings row", () => {
  it("🔒 its own read is the OWNER's container, never the channel's", () => {
    // The row states who a channel's people may reach, so it is the owner's
    // settings. A channel member needs the ONTOLOGY, and reaches it through
    // `dopl_ontology_readable`, which is SECURITY DEFINER and reads past this.
    const body = policy(SELECT_POLICY.ontology_channel_shares);
    expect(body).toMatch(
      /is_current_workspace_member\(\s*workspace_id,\s*'viewer'/i
    );
    expect(body).not.toMatch(/is_channel_member/i);
  });

  it("🔒 carries NO write policy — the write lane is service-role only", () => {
    const own = [...POLICIES.entries()].filter(([key]) =>
      key.startsWith("ontology_channel_shares.")
    );
    expect(own).toHaveLength(1);
    expect(own[0][1]).toMatch(/\bFOR\s+SELECT\b/i);
  });

  it("🔒 the two ontology `FOR ALL` write policies stay SUBSUMED by the viewer arm", () => {
    // `20260720211005`'s closing note: their SELECT arm is `'editor'`, which is a
    // strict subset of the `'viewer'` arm every SELECT policy above keeps. If one
    // ever widened, `check-rls-pair-gate` could not see it — a `FOR ALL` policy
    // is not `FOR SELECT` to its scanner — so it is asserted here.
    for (const key of [
      "ontology_memberships.ontology_memberships_editor_write",
      "ontology_relationships.ontology_relationships_editor_write",
    ]) {
      expect(policy(key), key).toMatch(
        /is_current_workspace_member\(\s*workspace_id,\s*'editor'/i
      );
      expect(policy(key), key).not.toMatch(/ontology_channel_shares/i);
    }
  });
});


/* ────────────────────────── the live half ────────────────────────── */

/** Skipped with reason — `shared/supabase/rls-redteam-fixture.ts` carries the
 *  measurement (Docker is down here) and the command that runs it. */
describe.skipIf(!liveRedteamEnabled)(
  "REDTEAM (live) — Samuel's matrix, one row at a time",
  () => {
    const admin = () => supabaseAdmin();

    let ownerId = "";
    let memberId = "";
    let guestId = "";
    let outsiderId = "";
    let ownerContainerId = "";
    let linkContainerId = "";
    let channelId = "";
    let ontologyId = "";
    let objectId = "";

    /** A HOME channel — Q5 refuses a `standard` container AT REST, so the
     *  fixture's own `makeWorkspace` (which mints a standard one) cannot host it. */
    const makeLinkContainer = (owner: string) =>
      insertId("workspaces", {
        owner_id: owner,
        name: "RLS redteam link",
        slug: `rls-redteam-link-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        public_id: generatePublicId(),
        kind: "link",
      });

    async function setShare(levels: {
      members: string;
      guests: string;
    }): Promise<void> {
      const { error } = await admin().from("ontology_channel_shares").upsert({
        ontology_id: ontologyId,
        channel_id: channelId,
        workspace_id: ownerContainerId,
        members_level: levels.members,
        guests_level: levels.guests,
        owner_agents_level: "view",
        created_by: ownerId,
      });
      if (error) throw error;
    }

    async function unshare(): Promise<void> {
      const { error } = await admin()
        .from("ontology_channel_shares")
        .delete()
        .match({ ontology_id: ontologyId, channel_id: channelId });
      if (error) throw error;
    }

    /** Rows of `table` inside the OWNER's container that `userId` can SELECT. */
    const rows = (userId: string, table: string, shared = false) =>
      readableIds(userId, table, ownerContainerId, { shared });

    /** Service-role, like every fixture row: a fixture shaped by the fence it
     *  is testing passes by having no rows. */
    async function insertId(
      table: string,
      row: Record<string, unknown>
    ): Promise<string> {
      const { data, error } = await admin().from(table).insert(row).select("id").single();
      if (error || !data) throw error ?? new Error(`no ${table} row`);
      return (data as { id: string }).id;
    }

    beforeAll(async () => {
      ownerId = await makeUser("ont-owner");
      memberId = await makeUser("ont-member");
      guestId = await makeUser("ont-guest");
      outsiderId = await makeUser("ont-outsider");

      // The ontology lives in the owner's own container; the SHARE points at a
      // channel in a DIFFERENT one. That gap is the cross-container lend.
      ownerContainerId = await makeWorkspace(ownerId);
      linkContainerId = await makeLinkContainer(ownerId);
      await addMember(linkContainerId, memberId, "member");
      await addMember(linkContainerId, guestId, "guest");

      channelId = await insertId("channels", {
        workspace_id: linkContainerId,
        created_by: ownerId,
        slug: "redteam",
        name: "Redteam",
      });
      // `channel_members.role` is only `owner | member` — the GUEST class comes
      // from `workspace_members.role` in the channel's container, which is what
      // `dopl_ontology_share_level` reads.
      for (const userId of [ownerId, memberId, guestId]) {
        const { error } = await admin().from("channel_members").insert({
          channel_id: channelId,
          user_id: userId,
          workspace_id: linkContainerId,
          role: userId === ownerId ? "owner" : "member",
        });
        if (error) throw error;
      }

      ontologyId = await insertId("ontologies", {
        workspace_id: ownerContainerId,
        slug: "redteam",
        name: "Redteam",
        created_by: ownerId,
      });
      objectId = await insertId("ontology_objects", {
        workspace_id: ownerContainerId,
        name: "Column",
        created_by: ownerId,
      });
      const membership = await admin().from("ontology_memberships").insert({
        workspace_id: ownerContainerId,
        ontology_id: ontologyId,
        child_object_id: objectId,
      });
      if (membership.error) throw membership.error;
    }, 60_000);

    afterAll(async () => {
      await deleteWorkspace(ownerContainerId);
      await deleteWorkspace(linkContainerId);
      await deleteUsers([ownerId, memberId, guestId, outsiderId]);
    }, 60_000);

    it("the OWNER sees their own ontology with no share at all (arm 1)", async () => {
      expect(await rows(ownerId, "ontologies")).toEqual([ontologyId]);
    });

    it.each(["ontologies", "ontology_objects", "ontology_memberships"])(
      "%s: an OUTSIDER sees zero rows, shared or not",
      async (table) => {
        await setShare({ members: "edit", guests: "edit" });
        try {
          expect(await rows(outsiderId, table)).toHaveLength(0);
        } finally {
          await unshare();
        }
      }
    );

    it("🔒 a MEMBER at `none` sees nothing; at `view` sees the ontology AND its objects", async () => {
      await setShare({ members: "none", guests: "none" });
      expect(await rows(memberId, "ontologies")).toHaveLength(0);

      await setShare({ members: "view", guests: "none" });
      try {
        expect(await rows(memberId, "ontologies")).toEqual([ontologyId]);
        // The children follow the parent: they ask about the ontology through
        // the membership walk, and never learn what a share is.
        expect(await rows(memberId, "ontology_objects")).toEqual([objectId]);
        expect(await rows(memberId, "ontology_memberships")).toHaveLength(1);
      } finally {
        await unshare();
      }
    });

    it("🔒 a GUEST reads `guests_level`, NOT `members_level` — the class split", async () => {
      // The sharpest row in the matrix: members at `edit`, guests at `none`.
      await setShare({ members: "edit", guests: "none" });
      try {
        expect(await rows(memberId, "ontologies")).toEqual([ontologyId]);
        expect(await rows(guestId, "ontologies")).toHaveLength(0);
        expect(await rows(guestId, "ontology_objects")).toHaveLength(0);
      } finally {
        await unshare();
      }
      await setShare({ members: "none", guests: "view" });
      try {
        expect(await rows(guestId, "ontologies")).toEqual([ontologyId]);
        expect(await rows(memberId, "ontologies")).toHaveLength(0);
      } finally {
        await unshare();
      }
    });

    it("🔒 UNSHARING is a row DELETE and it takes the reach with it (Q3)", async () => {
      // The revoke half is where a `true` predicate would show: a policy that
      // admits a shared row proves nothing unless removing the row removes it.
      await setShare({ members: "view", guests: "view" });
      expect(await rows(memberId, "ontologies")).toEqual([ontologyId]);
      await unshare();
      expect(await rows(memberId, "ontologies")).toHaveLength(0);
      expect(await rows(memberId, "ontology_objects")).toHaveLength(0);
    });

    it("🔒 a SHARED CREDENTIAL is not widened by a share (M-10 / P25)", async () => {
      await setShare({ members: "edit", guests: "edit" });
      try {
        expect(await rows(memberId, "ontologies")).toEqual([ontologyId]);
        expect(await rows(memberId, "ontologies", true)).toHaveLength(0);
        expect(await rows(memberId, "ontology_objects", true)).toHaveLength(0);
      } finally {
        await unshare();
      }
    });

    it("🔒 nobody but the OWNER's container may read the share ROW itself", async () => {
      await setShare({ members: "edit", guests: "edit" });
      try {
        const shares = (userId: string) =>
          readableIds(userId, "ontology_channel_shares", ownerContainerId, {
            idColumn: "ontology_id",
          });
        expect(await shares(ownerId)).toEqual([ontologyId]);
        expect(await shares(memberId)).toHaveLength(0);
        expect(await shares(guestId)).toHaveLength(0);
      } finally {
        await unshare();
      }
    });

    it("🔒 Q5 — a share into a STANDARD-workspace channel is refused at rest", async () => {
      const standardChannel = await insertId("channels", {
        workspace_id: ownerContainerId,
        created_by: ownerId,
        slug: "not-home",
        name: "Not home",
      });
      const { error } = await admin().from("ontology_channel_shares").insert({
        ontology_id: ontologyId,
        channel_id: standardChannel,
        workspace_id: ownerContainerId,
        created_by: ownerId,
      });
      expect(error?.message ?? "").toMatch(/home channels only/i);
    });
  }
);
