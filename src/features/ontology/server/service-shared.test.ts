/**
 * The twin's truth table — `./service-shared.ts › canSeeOntology` /
 * `› canEditOntology`, driven through every row of Samuel's matrix
 * (`docs/specs/home-ontology.md` §2, slice S1).
 *
 * This is the fence that actually runs. Every ontology read goes through
 * the service-role client, which bypasses RLS, so the policy proved by
 * `./rls-redteam.test.ts` is the fence for tomorrow and this predicate is the
 * fence for today. The two files are halves of one claim: that suite asserts the
 * SQL says what this says, arm for arm.
 *
 * The agent ceiling is not tested here because it is not decided here. An
 * agent capped at its operator's level (I1/Q1), the solo `agents_may_edit` toggle
 * and `owner_agents_level` are `./service-audience.ts › resolveOntologyAudience`'s
 * question, and its own suite's.
 *
 * Mutation-verified — 5 reverts, 5 failures (2026-09-09).
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
  const ONTOLOGY = { id: "ontology-1", workspaceId: "owner-container" };
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
    new Map([[ONTOLOGY.id, level]]);

  it("the OWNER sees and edits, with no share and none needed (arm 1)", () => {
    expect(canSeeOntology(ctx(), ONTOLOGY, NO_ONTOLOGY_SHARES)).toBe(true);
    expect(canEditOntology(ctx(), ONTOLOGY, NO_ONTOLOGY_SHARES)).toBe(true);
    // …and the share table is never asked.
    expect(needsShareArm(ctx(), ONTOLOGY)).toBe(false);
  });

  it("🔒 a share NEVER NARROWS the owner — even at `none`", () => {
    expect(canEditOntology(ctx(), ONTOLOGY, reach("none"))).toBe(true);
  });

  it("a VIEWER of the container sees but cannot edit — the `editor` rung", () => {
    const viewer = ctx({ role: "viewer", userId: "viewer" });
    expect(canSeeOntology(viewer, ONTOLOGY, NO_ONTOLOGY_SHARES)).toBe(true);
    expect(canEditOntology(viewer, ONTOLOGY, NO_ONTOLOGY_SHARES)).toBe(false);
  });

  it.each([
    ["none", false, false],
    ["view", true, false],
    ["edit", true, true],
  ] as const)(
    "a PEER at `%s` → see:%s edit:%s",
    (level, see, edit) => {
      expect(canSeeOntology(peer(), ONTOLOGY, reach(level))).toBe(see);
      expect(canEditOntology(peer(), ONTOLOGY, reach(level))).toBe(edit);
    }
  );

  it("a peer with NO share row reads nothing — absence is `none` (I4)", () => {
    expect(canSeeOntology(peer(), ONTOLOGY, NO_ONTOLOGY_SHARES)).toBe(false);
    expect(needsShareArm(peer(), ONTOLOGY)).toBe(true);
  });

  it("🔒 a SHARED CREDENTIAL is refused the SHARE ARM and keeps arm 1 (M-10)", () => {
    const shared = { credentialSubjectUserId: null };
    expect(canSeeOntology(peer(shared), ONTOLOGY, reach("edit"))).toBe(false);
    expect(canEditOntology(peer(shared), ONTOLOGY, reach("edit"))).toBe(false);
    expect(needsShareArm(peer(shared), ONTOLOGY)).toBe(false);
    // …and it still reaches its OWN container's board. Narrowing that would be
    // a change to M-10 this feature has no business making.
    expect(canSeeOntology(ctx(shared), ONTOLOGY, NO_ONTOLOGY_SHARES)).toBe(true);
  });

  it("🔒 the level is read for THIS ontology only — I5's key is the pair", () => {
    const otherOntology = new Map<string, OntologyLevel>([["ontology-2", "edit"]]);
    expect(canSeeOntology(peer(), ONTOLOGY, otherOntology)).toBe(false);
  });

  /**
   * The SQL twin's arm 1 is `is_current_workspace_member(workspace_id,
   * 'viewer')`, and this predicate is strictly NARROWER than it — the truth
   * table in this module's header, pinned so the divergence cannot be
   * rediscovered as a bug or "fixed" as a mirror.
   *
   * The narrow direction is the SAFE one and it is still a divergence: the
   * service-role client bypasses RLS, so what runs is this. Row 2 (the caller's
   * own personal shelf, reached from a room) is restored — and only row 2 — by
   * `./service-audience.ts › levelForOntology`'s `created_by` arm, which its own
   * suite pins.
   */
  it("the SQL twin's arm 1 — narrower here, and DELIBERATELY (the header's table)", () => {
    // Row 2: the caller's OWN personal container, reached while standing in a
    // room. SQL says true; this says false, and no share row changes that.
    const ownShelf = { id: "ontology-9", workspaceId: "my-personal-container" };
    const inARoom = ctx({ workspaceId: "ws-link", userId: "owner" });
    expect(canSeeOntology(inARoom, ownShelf, NO_ONTOLOGY_SHARES)).toBe(false);
    expect(needsShareArm(inARoom, ownShelf)).toBe(true);

    // Row 3: another container the caller is a member of. SQL says true; this
    // says false, and that one is NOT restored anywhere — an ontology in somebody
    // else's link container reaches this caller through a SHARE or not at all.
    const otherRoom = { id: "ontology-8", workspaceId: "ws-link-2" };
    expect(canSeeOntology(inARoom, otherRoom, NO_ONTOLOGY_SHARES)).toBe(false);
    expect(canSeeOntology(inARoom, otherRoom, new Map([[otherRoom.id, "view"]]))).toBe(
      true
    );
  });
});
