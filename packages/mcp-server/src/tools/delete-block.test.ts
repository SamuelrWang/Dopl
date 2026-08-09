/**
 * INVARIANT SUITE — the two REMOVALS the launch surface makes, checked against
 * the tables that enforce them.
 *
 *   1. D1/D2 — workflows and their clusters are RETIRED: their registrars still
 *      run, but `HIDDEN_TOOLS` keeps every tool they register out of
 *      `tools/list`. What has to hold is that the set names real tools, names
 *      both halves of each retired feature, and that no surviving description
 *      routes an agent to one of them.
 *
 *   2. §2b — DELETION IS APP-ONLY. Every op on every live `_admin` tool is
 *      refused, and each of those tools SAYS SO in its own description, so
 *      `tools/list` never advertises a delete the server will refuse.
 *
 * They are one file because they are one question asked twice — "is this
 * capability really gone, everywhere it is described?" — and because the
 * delete assertions read `HIDDEN_TOOLS` to know which admin tools are live.
 *
 * Split out of `parity.test.ts` when that file crossed the §2 500-line cap;
 * the shared capture and the parsed gating tables live in `parity-harness.ts`.
 *
 * The completeness check asks the REAL predicate — `isBlockedDeleteOp` from
 * `delete-policy.ts` — not a copy. The TABLE is still parsed out of source
 * (that is what catches a table drifting from an op enum), but a rule checked
 * against a reimplementation of itself only proves the copy agrees with itself.
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
    // A stale name here is dead law that reads as coverage: it looks like the
    // tool is being suppressed when in fact nothing by that name exists.
    for (const name of HIDDEN_TOOLS) {
      expect(
        TOOL_BY_NAME.has(name),
        `HIDDEN_TOOLS lists ${name}, which no registrar registers`,
      ).toBe(true);
    }
  });

  it("hides workflows and their clusters, both halves of each (D1 + D2)", () => {
    // Hiding an action tool but not its admin twin would leave the delete op
    // as the ONE reachable operation on a retired feature.
    expect([...HIDDEN_TOOLS].sort()).toEqual(
      ["dopl_cluster", "dopl_cluster_admin", "dopl_workflow", "dopl_workflow_admin"].sort(),
    );
  });

  it("the live tool list is exactly the surviving tools", () => {
    // The pin an agent's `tools/list` is compared against. The meta-tools
    // (`list_workspaces` / `current_workspace`) register through
    // `registerMetaTool` and so are not in this capture.
    expect(VISIBLE_TOOLS.map((t) => t.name).sort()).toEqual(
      [
        "dopl_channel",
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

  it("no surviving tool's description sends an agent to a retired tool", () => {
    // The tool is gone from `tools/list`; a description that still routes to it
    // teaches a call that cannot be made, which reads to the agent as a broken
    // connection rather than as a removed feature.
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
    // The WRITE_OPS.dopl_skill drift bug, applied to the delete table: a
    // blocked op that no longer exists is a rule guarding nothing.
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
    // THE INVARIANT THAT MATTERS. Every remaining `*_admin` op is destructive by
    // construction (that is why the tool exists), so a new op landing on one of
    // them un-refused would be a delete an agent can perform. Asked of the real
    // predicate, so the fail-closed name-shape fallback counts too — which is
    // what lets a future admin op inherit the rule without anyone editing the
    // table. If this fails on a genuinely non-destructive new op, that op does
    // not belong on an `_admin` tool.
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
    // The opposite failure: an over-broad rule that swallowed `remove_attribute`
    // or `remove_template_field` (ontology FIELD edits) would quietly remove
    // working capability, and it would do it with a message about deletion.
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
    // Deletion in the app is PERMANENT — the trash feature is gone. A leftover
    // "soft-deleted"/"restorable" sentence would have an agent tell a user an
    // item can be brought back.
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
