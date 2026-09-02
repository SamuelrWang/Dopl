/**
 * INVARIANT SUITE — the two REMOVALS the launch surface makes, checked against
 * the tables that enforce them. One question asked twice: is this capability
 * really gone, everywhere it is described?
 *
 *   1. The hide-before-delete seam. `HIDDEN_TOOLS` keeps a named tool out of
 *      `tools/list` while its code is still in the tree. ⚠ Every name in it
 *      must be a REAL registered tool (a name with no registrar is dead law
 *      that reads as coverage), no surviving description may route an agent to
 *      one, and the visible list must be exactly the surviving tools.
 *   2. DELETION IS APP-ONLY — and since 2026-09-02 the way that is true is that
 *      NO DELETE OP EXISTS. The five `_admin` tools that published delete ops
 *      only to refuse them are deleted; `DELETE_BLOCKED_OPS` survives as the
 *      list of ops that must never come back, doubly held: asserted absent from
 *      every live `op` enum here, and refused by `isBlockedDeleteOp` the instant
 *      one is added.
 *
 * ⚠ The checks ask the REAL predicate (`isBlockedDeleteOp` from
 * `delete-policy.ts`), not a copy — a rule checked against a reimplementation
 * of itself only proves the copy agrees with itself. The TABLE is still parsed
 * from source, which is what catches a table drifting from an op enum.
 */

import { describe, it, expect } from "vitest";

import { isBlockedDeleteOp } from "../delete-policy.js";
import {
  DELETE_BLOCKED_OPS,
  HIDDEN_TOOLS,
  TOOL_BY_NAME,
  VISIBLE_TOOLS,
  isAdmin,
  opEnum,
} from "./parity-harness.js";

// ── Retirement (D1/D2): what an agent actually sees ──────────────────

describe("HIDDEN_TOOLS — the retired surface", () => {
  it("names only tools that really are registered by a registrar", () => {
    // ⚠ A stale name is dead law that reads as coverage.
    for (const name of HIDDEN_TOOLS) {
      expect(
        TOOL_BY_NAME.has(name),
        `HIDDEN_TOOLS lists ${name}, which no registrar registers`,
      ).toBe(true);
    }
  });

  it("is EMPTY — nothing is mid-retirement (workflows/clusters were deleted)", () => {
    // ⚠ Pinned as a VALUE, not skipped — this is what makes a re-hide
    // deliberate. The mechanism is not dead: the next retirement adds names
    // here, ships dark, and deletes later. ⚠ Hide BOTH halves of a domain (the
    // action tool AND its admin twin), or the delete op is the one reachable
    // operation left.
    expect([...HIDDEN_TOOLS]).toEqual([]);
  });

  it("the live tool list is exactly the surviving tools", () => {
    // ⚠ Meta-tools register through `registerMetaTool` and are not in this
    // capture.
    expect(VISIBLE_TOOLS.map((t) => t.name).sort()).toEqual(
      [
        // MCP surface v2 wave A (2026-08-28): the template family joins.
        // ⚠ TEN, NOT FIFTEEN, SINCE 2026-09-02: the five `_admin` companions
        // were hidden and then deleted in the same wave.
        "dopl_agent",
        "dopl_channel",
        "dopl_home",
        "dopl_chats",
        "dopl_kb",
        "dopl_map",
        "dopl_members",
        "dopl_ontology",
        "dopl_search",
        "dopl_skill",
      ].sort(),
    );
  });

  it("no surviving tool's description sends an agent to a hidden tool", () => {
    // ⚠ A description routing to a hidden tool teaches a call that cannot be
    // made, which reads as a broken connection, not a removed feature. Vacuous
    // while HIDDEN_TOOLS is empty and kept anyway — it is the second half of
    // the hide step and must exist before the next one runs. DELETED names are
    // pinned non-vacuously by `retirement.test.ts › RETIRED`.
    for (const tool of VISIBLE_TOOLS) {
      for (const hidden of HIDDEN_TOOLS) {
        expect(
          tool.description.includes(hidden),
          `${tool.name}'s description names ${hidden}, which is hidden from tools/list`,
        ).toBe(false);
      }
    }
  });
});

// ── deletion is app-only: no delete op exists ────────────────────────

describe("no delete op is published, and none may come back", () => {
  it("every DELETE_BLOCKED_OPS entry names a live tool", () => {
    // ⚠ A row against a tool nothing registers fences nothing, and it would
    // silently drop that op out of the REST census in
    // `src/shared/auth/app-only-delete-gate.test.ts`, which keys on this table.
    for (const name of Object.keys(DELETE_BLOCKED_OPS)) {
      expect(TOOL_BY_NAME.has(name), `DELETE_BLOCKED_OPS references unknown tool ${name}`).toBe(true);
      expect(
        HIDDEN_TOOLS.has(name),
        `DELETE_BLOCKED_OPS lists ${name}, which is hidden — a hidden tool needs no op-level rule`,
      ).toBe(false);
    }
  });

  it("SECURITY: none of those ops is in a live op enum — the surface publishes no delete", () => {
    // ⚠ THE INVARIANT THAT MATTERS, AND ITS POLARITY IS THE OPPOSITE OF
    // `WRITE_OPS ⊆ enum` (2026-09-02). WRITE_OPS names ops that MUST exist;
    // this table names ops that MUST NOT. An op arriving in an enum is a delete
    // path over MCP, which `sessionOnly` on the REST route would then be the
    // only thing standing behind.
    for (const [name, ops] of Object.entries(DELETE_BLOCKED_OPS)) {
      const enumOps = opEnum(TOOL_BY_NAME.get(name)!) ?? [];
      for (const op of ops) {
        expect(
          enumOps.includes(op),
          `${name} publishes op="${op}" — deletion is app-only, so no tool may offer it`,
        ).toBe(false);
      }
    }
  });

  it("SECURITY: the gate refuses one anyway, asked of the REAL predicate", () => {
    // ⚠ Belt to the enum check's braces: if an op DOES land in an enum, the
    // refusal fires before workspace resolution and before any client call, so
    // a delete cannot half-happen. Asked of `isBlockedDeleteOp` itself so the
    // rule is the one the server runs.
    for (const [name, ops] of Object.entries(DELETE_BLOCKED_OPS)) {
      for (const op of ops) {
        expect(
          isBlockedDeleteOp(name, op),
          `${name} op="${op}" is NOT refused by isBlockedDeleteOp — that is a live delete path over MCP`,
        ).toBe(true);
      }
    }
  });

  it("no `*_admin` tool is registered — the refusal surface is gone, not hidden", () => {
    // ⚠ The five cost 9,295 served chars to publish a refusal, and the sentence
    // they served — "there is no MCP path to it, for any role or token" — is now
    // true in code at the credential layer. A new one would be a regression, not
    // a gap.
    expect(VISIBLE_TOOLS.map((t) => t.name).filter(isAdmin)).toEqual([]);
  });

  it("leaves the surviving ops alone — this is a delete block, not a write block", () => {
    // ⚠ Opposite failure: an over-broad rule swallowing `remove_attribute` or
    // `remove_template_field` (ontology FIELD edits) removes working capability
    // with a message about deletion.
    for (const tool of VISIBLE_TOOLS) {
      for (const op of opEnum(tool) ?? []) {
        expect(
          isBlockedDeleteOp(tool.name, op),
          `${tool.name} op="${op}" is refused as a delete, but it is a live op`,
        ).toBe(false);
      }
    }
  });

  it("no surviving description promises a delete, or claims one is recoverable", () => {
    // ⚠ Deletion in the app is PERMANENT — a "soft-deleted"/"restorable"
    // sentence has an agent tell a user an item can be brought back. And a
    // description still routing to a deleted `_admin` tool teaches a call that
    // cannot be made, which reads as a broken connection.
    for (const tool of VISIBLE_TOOLS) {
      const text = tool.description.toLowerCase();
      for (const stale of ["soft-delete", "soft-deleted", "restorable", "restore from trash", "_admin"]) {
        expect(
          text.includes(stale),
          `${tool.name}'s description says "${stale}"`,
        ).toBe(false);
      }
    }
  });
});
