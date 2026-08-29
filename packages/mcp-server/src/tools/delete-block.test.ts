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
 *   2. DELETION IS APP-ONLY — every op on every live `_admin` tool is refused,
 *      and each tool SAYS SO in its description, so `tools/list` never
 *      advertises a delete the server will refuse.
 *
 * ⚠ The completeness check asks the REAL predicate (`isBlockedDeleteOp` from
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
        "dopl_agent",
        "dopl_agent_admin",
        "dopl_channel",
        "dopl_home",
        "dopl_chats",
        "dopl_chats_admin",
        "dopl_kb",
        "dopl_kb_admin",
        "dopl_map",
        "dopl_members",
        "dopl_ontology",
        "dopl_ontology_admin",
        "dopl_search",
        "dopl_skill",
        "dopl_skill_admin",
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

// ── §2b: deletion is app-only ────────────────────────────────────────

describe("delete ops are refused, not performed", () => {
  it("every DELETE_BLOCKED_OPS entry names a live admin tool", () => {
    for (const name of Object.keys(DELETE_BLOCKED_OPS)) {
      expect(TOOL_BY_NAME.has(name), `DELETE_BLOCKED_OPS references unknown tool ${name}`).toBe(true);
      expect(isAdmin(name), `DELETE_BLOCKED_OPS lists non-admin tool ${name}`).toBe(true);
      expect(
        HIDDEN_TOOLS.has(name),
        `DELETE_BLOCKED_OPS lists ${name}, which is hidden — a hidden tool needs no op-level rule`,
      ).toBe(false);
    }
  });

  it("every op it lists exists in that tool's op enum", () => {
    // ⚠ A blocked op that no longer exists is a rule guarding nothing.
    for (const [name, ops] of Object.entries(DELETE_BLOCKED_OPS)) {
      const enumOps = opEnum(TOOL_BY_NAME.get(name)!);
      expect(enumOps, `${name} has no op enum but DELETE_BLOCKED_OPS gates it`).not.toBeNull();
      for (const op of ops) {
        expect(
          enumOps,
          `DELETE_BLOCKED_OPS.${name} lists op="${op}", which is not in the tool's op enum`,
        ).toContain(op);
      }
    }
  });

  it("SECURITY: EVERY op on EVERY live admin tool is refused — no delete path survives", () => {
    // ⚠ THE INVARIANT THAT MATTERS: every `*_admin` op is destructive by
    // construction, so a new un-refused one is a delete an agent can perform.
    // Asked of the REAL predicate so the fail-closed name-shape fallback counts
    // and a future admin op inherits the rule with no table edit. A failure on
    // a genuinely non-destructive op means it does not belong on `_admin`.
    for (const tool of VISIBLE_TOOLS) {
      if (!isAdmin(tool.name)) continue;
      const enumOps = opEnum(tool);
      expect(enumOps, `${tool.name} is an admin tool with no op enum`).not.toBeNull();
      for (const op of enumOps!) {
        expect(
          isBlockedDeleteOp(tool.name, op),
          `${tool.name} op="${op}" is NOT refused by isBlockedDeleteOp — that is a live delete path over MCP (§2b says there are none)`,
        ).toBe(true);
      }
    }
  });

  it("the refusal is advertised: no admin description promises a delete it won't do", () => {
    for (const tool of VISIBLE_TOOLS) {
      if (!isAdmin(tool.name)) continue;
      expect(
        tool.description.startsWith("Deletion is app-only"),
        `${tool.name}'s description must open by stating the refusal, or tools/list advertises deletes it will refuse. Got: ${tool.description.slice(0, 80)}`,
      ).toBe(true);
    }
  });

  it("leaves the non-admin tools alone — this is a delete block, not a write block", () => {
    // ⚠ Opposite failure: an over-broad rule swallowing `remove_attribute` or
    // `remove_template_field` (ontology FIELD edits) removes working capability
    // with a message about deletion.
    for (const tool of VISIBLE_TOOLS) {
      if (isAdmin(tool.name)) continue;
      for (const op of opEnum(tool) ?? []) {
        expect(
          isBlockedDeleteOp(tool.name, op),
          `${tool.name} op="${op}" is refused as a delete, but it is not on an admin tool`,
        ).toBe(false);
      }
    }
  });

  it("no admin description still claims a delete is recoverable", () => {
    // ⚠ Deletion in the app is PERMANENT — a "soft-deleted"/"restorable"
    // sentence has an agent tell a user an item can be brought back.
    for (const tool of VISIBLE_TOOLS) {
      if (!isAdmin(tool.name)) continue;
      for (const stale of ["soft-delete", "soft-deleted", "restorable", "restore from trash"]) {
        expect(
          tool.description.toLowerCase().includes(stale),
          `${tool.name}'s description says "${stale}" — deletion is permanent`,
        ).toBe(false);
      }
    }
  });
});
