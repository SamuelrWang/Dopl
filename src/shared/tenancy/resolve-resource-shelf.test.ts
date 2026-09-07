/**
 * 🔓 **CLAUSE 3 — A LOCKED CREDENTIAL AND ITS OPERATOR'S PERSONAL SHELF**, driven
 * against the real query builder.
 *
 * ⚠ **A THIRD SUITE OVER ONE MODULE, AND ONLY BECAUSE OF THE §1 LINE CAP** — the
 * same reason `resolve-resource-grant.test.ts` is its own file. The recording
 * builder is shared (`resolve-resource-fixture.ts`) so no copy of it can drift;
 * what lives HERE is the one clause whose answer changed on 2026-09-06, and
 * carving it out put its parent suite back under the cap it had been over.
 *
 * ⚠ **THE OTHER THREE CLAUSES ARE NOT RE-TESTED HERE.** They are in
 * `resolve-resource.test.ts`, one describe each, and they are what makes this
 * widening safe to state as plainly as it is below: it adds ONE container to a
 * candidate set and admits no row by itself.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/shared/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

import { resolveResource } from "./resolve-resource";
import {
  filters,
  makeAdmin,
  member,
  ME,
  personalContainer,
  T1,
  WS_A,
  WS_P,
} from "./resolve-resource-fixture";

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * 🔓 **THE WIDENING IS UNCONDITIONAL AGAIN — Samuel's reversal of task 11,
 * 2026-09-06** (this block used to pin the opposite, under the title "an AGENT's
 * lock widens onto the shelf only from a room that is armed").
 *
 * ⚠ **THE TESTS BELOW ARE THE REVERSAL'S OWED HALF, AND THEY WERE OWED FOR A
 * REASON WORTH KEEPING.** `personal-reach.ts` stopped reading
 * `channel_personal_arming`, stopped counting the room's members and stopped
 * consulting the session header; two cases here went on asserting the probe and
 * the `[lock]`-alone candidate list, so the suite failed RED against shipped,
 * intended behaviour — which is the worst state for a fence's only un-mocked
 * test to be in, because it trains the next reader to skip it.
 *
 * ⚠ **WHAT IS PINNED NOW IS THE REACH ITSELF, NOT THE ARMING SWITCH**: a locked
 * agent credential resolves inside its lock PLUS its operator's own personal
 * container, from any room, exactly as a person does. The confidentiality of
 * that shelf's contents is held by the session's prompt framing
 * (`dopl-desktop-app/main/prompt-framing-text.js ›
 * PERSONAL_KNOWLEDGE_CONFIDENTIALITY`), not by a refusal here — so a test that
 * expected a narrower candidate list would now be pinning a fence that is
 * deliberately gone.
 *
 * ⚠ **THE CLAUSES THAT DID NOT MOVE STILL DECIDE**, and that is why the widening
 * is safe to state so plainly: clause 1 returns before a query is built for a
 * SHARED credential, clause 2 still requires an active membership at the
 * `viewer` floor, and clause 4 still refuses a row the caller could not list.
 * The widening adds one container to a candidate set; it admits no row.
 */
describe("🔓 an AGENT's lock widens onto its operator's shelf, from any room", () => {
  const agent = {
    userId: ME,
    credentialSubjectUserId: ME,
    apiKeyWorkspaceId: WS_A,
    source: "agent",
  };

  it("admits the shelf from a SHARED room, with nothing armed", async () => {
    const calls = makeAdmin({
      workspaces: [personalContainer()],
      workspace_members: [member(WS_P, "owner")],
      knowledge_bases: [
        {
          id: T1,
          name: "Orchestration Guidelines",
          workspace_id: WS_P,
          created_by: ME,
          workspace: { name: "Personal", kind: "personal" },
        },
      ],
    });
    // ⚠ THE CASE THE REVERSAL EXISTS FOR: an agent standing in a channel names a
    // base on its operator's own shelf, and nobody had to arm anything.
    expect(await resolveResource(agent, "knowledge_base", T1)).toMatchObject({
      containerId: WS_P,
      containerKind: "personal",
    });
    expect(filters(calls, "workspace_members")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_A, WS_P])})`
    );
  });

  it("admits it in a container the operator is ALONE in, too", async () => {
    // ⚠ THE TWO LANES ARE ONE LANE NOW. This case passed under the narrowing as
    // well — a solo room had nobody to bound — so it is kept as the pin that the
    // shared case above answers IDENTICALLY. If they ever diverge again, the
    // fence has grown a second decision.
    const calls = makeAdmin(
      {
        workspaces: [personalContainer()],
        workspace_members: [member(WS_A)],
        agent_templates: [],
      },
      {},
      { workspace_members: 1 }
    );
    await resolveResource(agent, "agent_template", T1);
    expect(filters(calls, "workspace_members")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_A, WS_P])})`
    );
  });

  it("🔒 asks the arming table NOTHING, and counts the room NOT AT ALL", async () => {
    // ⚠ MUTATION CHECK, AND A COST CHECK. The arming table survives INERT
    // (the migration is kept; the route and service module that wrote it are
    // deleted, 2026-09-07), so a re-introduced probe would still answer — it
    // would just re-close a reach that was deliberately opened, from a table
    // nothing writes. The member count went with it: one
    // read for everybody now, and `head:true` on `workspace_members` is what its
    // return would look like.
    const calls = makeAdmin({
      workspaces: [personalContainer()],
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(agent, "agent_template", T1);
    expect(calls.some((c) => c.table === "channel_personal_arming")).toBe(false);
  });

  it("🔒 THE SHELF IS THE OPERATOR'S OWN, resolved by owner and by kind", async () => {
    // ⚠ MUTATION CHECK, and the one clause 3 still owns. The widening probe is
    // keyed to the CALLER — a proven user id — and to `kind='personal'`; read it
    // off anything caller-supplied and "my shelf" becomes "a shelf I named".
    const calls = makeAdmin({
      workspaces: [personalContainer()],
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(agent, "agent_template", T1);
    expect(filters(calls, "workspaces")).toEqual([
      `eq("owner_id"=${JSON.stringify(ME)})`,
      `eq("kind"="personal")`,
    ]);
  });

  it("🔒 a lock with NO personal container stays the lock alone", async () => {
    // ⚠ The fail-safe half: `findPersonalContainerId` answers `null` (the
    // migration has not run for this owner), and the candidate list must narrow
    // to the lock rather than widen to `undefined` or to every membership.
    const calls = makeAdmin({
      workspaces: [],
      workspace_members: [member(WS_A)],
      agent_templates: [],
    });
    await resolveResource(agent, "agent_template", T1);
    expect(filters(calls, "workspace_members")).toContain(
      `in("workspace_id"=${JSON.stringify([WS_A])})`
    );
  });
});
