// @vitest-environment jsdom
/**
 * THE EDITOR'S KNOWLEDGE HALF — the attached scopes, and the ones this view
 * CANNOT REACH (ruled 2026-09-06 under Samuel's delegation).
 *
 * ⚠ **THE COPY SAYS "attachment", NOT "base", SINCE 2026-09-08** — the count
 * covers a dropped FOLDER and a dropped ENTRY too, and calling one of those "a
 * base" would be a wrong sentence about what the role names.
 *
 * ⚠ **ITS OWN FILE, AND THE REASON IS THE ONE §1 STATES.**
 * `identity-editor.test.tsx` sits close to the hard 500 (`wc -l` is the check;
 * its SOURCE-READ half moved to `identity-editor-surface.test.tsx` on 2026-09-08
 * for the same reason)
 * (`eslint.config.mjs › max-lines`, `error`, no exemption for this path), so it
 * cannot absorb two cases and their docblocks — and a file that big absorbs a
 * COMMENT badly too. That file owns WHAT THE EDITOR IS; this one owns WHAT ITS
 * ATTACHMENTS RESOLVE TO.
 *
 * ⚠ THE FIXTURE AND THE `open()` HELPER ARE LOCAL AND DELIBERATELY MINIMAL. A
 * second suite importing the first one's harness couples two files that were
 * split to be independent; what is duplicated here is the four props these two
 * cases actually need.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AgentIdentity } from "../client/types";
import { IdentityEditor } from "./identity-editor";

/** ⚠ THE PICKER READS A TREE PER BASE. This suite is about the EDITOR, not about
 *  the knowledge transport — a real fetch would make every case here depend on a
 *  route it does not exercise. The shape is shared (`./knowledge-tree-mock`);
 *  the factory cannot close over it, so it imports it (`vi.mock` is hoisted). */
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeTree: (await import("./knowledge-tree-mock")).useKnowledgeTree,
}));

const BASES = [
  { id: "kb-1", name: "Runbooks" },
  { id: "kb-2", name: "Specs" },
];

function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: null,
    instructions: "Be terse.",
    model: null,
    fields: [],
    visibility: "private",
    teamIds: [],
    // ⚠ ONE VISIBLE REF. The unreachable ones are NOT in this list by
    // construction — the decoration drops them server-side and sends a count
    // instead, which is the whole contract under test.
    knowledgeBases: [{ id: "kb-1", name: "Runbooks" }],
    knowledge: [
      { baseId: "kb-1", baseName: "Runbooks", scope: "base", path: "Runbooks" },
    ],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

/** ⚠ `await`ed because `ModalShell` mounts its frame AFTER `open` flips. */
async function open(tpl: AgentIdentity | null) {
  render(
    <IdentityEditor
      open
      workspaceId="ws-1"
      session={1}
      identity={tpl}
      teams={[]}
      knowledgeBases={BASES}
      saving={false}
      deleting={false}
      error={null}
      onClose={vi.fn()}
      onSave={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  await screen.findByRole("dialog");
}

afterEach(cleanup);

describe("attached bases this view cannot reach", () => {
  /**
   * 🔒 **A COUNT, AND ONLY A COUNT.** The launch payload has carried this since
   * 2026-09-05 (`types.ts › ResolvedAgentIdentity`) while the surface where the
   * attachment was MADE said nothing, so an author could not tell that a base
   * they attached elsewhere does not resolve here.
   *
   * ⚠ THE SECOND HALF IS THE ONE THAT MATTERS: nothing may identify the base.
   * The id, the name and the container are exactly what the viewer filter
   * withholds, and this asserts their ABSENCE so a later "helpful" pass cannot
   * put a name back by cross-referencing the chip options.
   */
  it("says how many, and never which", async () => {
    await open(identity({ unreachableKnowledgeBaseCount: 2 }));
    expect(
      screen.getByText(/2 attachments aren't reachable from here/)
    ).toBeTruthy();
    // The VISIBLE attachment is still listed by name, so this is a claim about
    // the ones that are missing, not a blanket warning.
    expect(screen.getByRole("button", { name: "Detach Runbooks" })).toBeTruthy();
    // ⚠ NOTHING ANYWHERE IN THE DIALOG NAMES THE MISSING ONES. `kb-2`/`Specs`
    // are in this editor's OPTIONS, so a pass that "resolved" the count against
    // them would render exactly this and be a leak.
    const line = screen.getByText(/aren't reachable from here/).textContent ?? "";
    expect(line).not.toMatch(/kb-|Specs|workspace|channel/);
  });

  /**
   * ⚠ ZERO AND UNDECORATED ARE BOTH SILENT, and they are different states. `0`
   * is a decided answer ("nothing was dropped"); an ABSENT field means the row
   * never went through `decorateWithKnowledgeBases` and has no answer at all.
   * Neither is a line worth printing on every well-formed identity forever
   * (INVARIANTS §5).
   */
  it("says nothing when every attached base is reachable", async () => {
    await open(identity({ unreachableKnowledgeBaseCount: 0 }));
    expect(screen.queryByText(/reachable from here/)).toBeNull();
    cleanup();
    await open(identity());
    expect(screen.queryByText(/reachable from here/)).toBeNull();
  });

  /** ⚠ A NEW identity has no row behind it, so there is nothing to be
   *  unreachable — and reading a count off `null` must not throw. */
  it("says nothing while creating an identity", async () => {
    await open(null);
    expect(screen.queryByText(/reachable from here/)).toBeNull();
  });
});
