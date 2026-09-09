/**
 * THE TWIN's TRUTH TABLE — `./service-shared.ts › canSeeOntology` /
 * `› canEditOntology`, driven through every row of Samuel's matrix
 * (`docs/specs/home-ontology.md` §2, slice S1).
 *
 * 🔒 **THIS IS THE FENCE THAT ACTUALLY RUNS.** Every ontology read goes through
 * the service-role client, which bypasses RLS, so the policy proved by
 * `./rls-redteam.test.ts` is the fence for tomorrow and this predicate is the
 * fence for today. The two files are halves of one claim: that suite asserts the
 * SQL says what this says, arm for arm.
 *
 * ⚠ **THE AGENT CEILING IS NOT TESTED HERE BECAUSE IT IS NOT DECIDED HERE.** An
 * agent capped at its operator's level (I1/Q1), the solo `agents_may_edit` toggle
 * and `owner_agents_level` are `./service-audience.ts › resolveOntologyAudience`'s
 * question, and its own suite's.
 *
 * ⚠ MUTATION-VERIFIED, 5 REVERTS AND 5 FAILURES (2026-09-09) — each applied, run,
 * and reverted: the read floor dropped to `none`; the write floor dropped to
 * `view`; `sharedOntologyLevel` losing its shared-credential refusal; the
 * container arm answering `true` for everyone; and `needsShareArm` forgetting the
 * credential axis.
 */

import { describe, it, expect } from "vitest";
import type { OntologyContext, OntologyLevel } from "../types";
import { ontologyContextFactory } from "./test-fixtures";
import {
  canEditOntology,
  canSeeOntology,
  needsShareArm,
  NO_ONTOLOGY_SHARES,
  type OntologyShareReach,
} from "./service-shared";

describe("canSeeOntology / canEditOntology — Samuel's matrix, in TypeScript", () => {
  const CLUSTER = { id: "cluster-1", workspaceId: "owner-container" };
  const ctx = ontologyContextFactory({
    workspaceId: "owner-container",
    userId: "owner",
    role: "owner",
    credentialSubjectUserId: "owner",
  });
  /** A caller who is NOT in the ontology's container — every share reader is. */
  const peer = (over: Partial<OntologyContext> = {}) =>
    ctx({ workspaceId: "someone-elses-container", userId: "peer", role: "member", ...over });
  const reach = (level: OntologyLevel): OntologyShareReach =>
    new Map([[CLUSTER.id, level]]);

  it("the OWNER sees and edits, with no share and none needed (arm 1)", () => {
    expect(canSeeOntology(ctx(), CLUSTER, NO_ONTOLOGY_SHARES)).toBe(true);
    expect(canEditOntology(ctx(), CLUSTER, NO_ONTOLOGY_SHARES)).toBe(true);
    // …and the share table is never asked.
    expect(needsShareArm(ctx(), CLUSTER)).toBe(false);
  });

  it("🔒 a share NEVER NARROWS the owner — even at `none`", () => {
    expect(canEditOntology(ctx(), CLUSTER, reach("none"))).toBe(true);
  });

  it("a VIEWER of the container sees but cannot edit — the `editor` rung", () => {
    const viewer = ctx({ role: "viewer", userId: "viewer" });
    expect(canSeeOntology(viewer, CLUSTER, NO_ONTOLOGY_SHARES)).toBe(true);
    expect(canEditOntology(viewer, CLUSTER, NO_ONTOLOGY_SHARES)).toBe(false);
  });

  it.each([
    ["none", false, false],
    ["view", true, false],
    ["edit", true, true],
  ] as const)(
    "a PEER at `%s` → see:%s edit:%s",
    (level, see, edit) => {
      expect(canSeeOntology(peer(), CLUSTER, reach(level))).toBe(see);
      expect(canEditOntology(peer(), CLUSTER, reach(level))).toBe(edit);
    }
  );

  it("a peer with NO share row reads nothing — absence is `none` (I4)", () => {
    expect(canSeeOntology(peer(), CLUSTER, NO_ONTOLOGY_SHARES)).toBe(false);
    expect(needsShareArm(peer(), CLUSTER)).toBe(true);
  });

  it("🔒 a SHARED CREDENTIAL is refused the SHARE ARM and keeps arm 1 (M-10)", () => {
    const shared = { credentialSubjectUserId: null };
    expect(canSeeOntology(peer(shared), CLUSTER, reach("edit"))).toBe(false);
    expect(canEditOntology(peer(shared), CLUSTER, reach("edit"))).toBe(false);
    expect(needsShareArm(peer(shared), CLUSTER)).toBe(false);
    // ⚠ …and it still reaches its OWN container's board. Narrowing that would be
    // a change to M-10 this feature has no business making.
    expect(canSeeOntology(ctx(shared), CLUSTER, NO_ONTOLOGY_SHARES)).toBe(true);
  });

  it("🔒 the level is read for THIS cluster only — I5's key is the pair", () => {
    const otherCluster = new Map<string, OntologyLevel>([["cluster-2", "edit"]]);
    expect(canSeeOntology(peer(), CLUSTER, otherCluster)).toBe(false);
  });

  /**
   * 🔒 THE SQL TWIN'S ARM 1 IS `is_current_workspace_member(workspace_id,
   * 'viewer')`, AND THIS PREDICATE IS STRICTLY NARROWER THAN IT — the truth
   * table in this module's header, pinned so the divergence cannot be
   * rediscovered as a bug or "fixed" as a mirror.
   *
   * ⚠ The narrow direction is the SAFE one and it is still a divergence: the
   * service-role client bypasses RLS, so what runs is this. Row 2 (the caller's
   * own personal shelf, reached from a room) is restored — and only row 2 — by
   * `./service-audience.ts › levelForCluster`'s `created_by` arm, which its own
   * suite pins.
   */
  it("the SQL twin's arm 1 — narrower here, and DELIBERATELY (the header's table)", () => {
    // Row 2: the caller's OWN personal container, reached while standing in a
    // room. SQL says true; this says false, and no share row changes that.
    const ownShelf = { id: "cluster-9", workspaceId: "my-personal-container" };
    const inARoom = ctx({ workspaceId: "ws-link", userId: "owner" });
    expect(canSeeOntology(inARoom, ownShelf, NO_ONTOLOGY_SHARES)).toBe(false);
    expect(needsShareArm(inARoom, ownShelf)).toBe(true);

    // Row 3: another container the caller is a member of. SQL says true; this
    // says false, and that one is NOT restored anywhere — a cluster in somebody
    // else's link container reaches this caller through a SHARE or not at all.
    const otherRoom = { id: "cluster-8", workspaceId: "ws-link-2" };
    expect(canSeeOntology(inARoom, otherRoom, NO_ONTOLOGY_SHARES)).toBe(false);
    expect(canSeeOntology(inARoom, otherRoom, new Map([[otherRoom.id, "view"]]))).toBe(
      true
    );
  });
});
