// @vitest-environment jsdom
/**
 * THE FOUR STATES OF A POINTER VALUE, PINNED IN BOTH BRANCHES (2026-10-24).
 *
 * ⚠ WHY THIS EXISTS. A four-reader review of this file found that the `ref` /
 * `knowledge` / `skill` branches conflated distinct states, and then each round
 * of fixing opened the next corner:
 *
 *  1. Originally: unresolvable ids were FILTERED OUT, so all-dangling rendered
 *     "Empty" (a broken pointer read as a field nobody filled in) and
 *     partial-dangling rendered one chip and said nothing at all.
 *  2. The fix for that removed an early `<Empty/>` return, which made a
 *     genuinely UNSET field (`value: []`) render an empty fragment — a label
 *     with a blank cell (Identities Polish).
 *  3. And the same predicate, `Boolean(name)`, counted a thing that EXISTS with
 *     a blank name as missing, so the new face asserted "not in this ontology"
 *     about something that is in it (Rail Fix; the `nameOf` contract that
 *     settles it was read by Identity Cards).
 *
 * The generalisation these tests encode: **four states need distinguishing and
 * the code distinguished two** — resolved · present-but-nameless · genuinely
 * absent · no targets at all.
 *
 * ⚠ AND THE FIRST VERSION OF THIS FILE PINNED ONLY THE `ref` BRANCH. Every
 * fixture was `kind: "ref"`, no fixture of `knowledge`/`skill` existed anywhere
 * in `ontology-staging`, and `nameOf` was never supplied — so both guards in
 * that branch could be reverted with the suite still green. Half the edit was
 * unpinned, which is the review's own finding (a lesson applied to one site and
 * not the one twenty lines down) recurring *inside the instrument built to stop
 * it*. Identities Polish established it **by absence of input rather than by
 * mutation** — an argument that needs no detector, and therefore no detector
 * that can fail silently.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * RE-PROVING NON-VACUITY (one command, and please do rather than trust this).
 *
 * A passing test proves nothing until you have watched it fail.
 *
 *   F=src/features/ontology-staging/ontology/components/ontology-row.tsx
 *   B=/tmp/row-mut.tsx; cp "$F" "$B"
 *   before=$(grep -c "value.value.length === 0" "$F")
 *   grep -v "if (value.value.length === 0) return <Empty />;" "$B" > "$F"
 *   after=$(grep -c "value.value.length === 0" "$F")
 *   echo "$before -> $after"   # ⚠ MUST read "2 -> 0" before you believe anything
 *   npx vitest run src/features/ontology-staging/ontology/components/ontology-row.test.tsx
 *   cp "$B" "$F"               # revert
 *
 * Expected: the two "no targets" tests FAIL, one per branch.
 *
 * ⚠ THE GATE IS TWO CONDITIONS, NOT ONE: **the mutation LANDED** *and*
 * **something went RED.** Both halves were learned the hard way here.
 *  - The author's first attempt reported "4 passed" because the substitution
 *    silently did not apply. Hence the `$before -> $after` line.
 *  - The second attempt mutated the `knowledge` predicate, the change DID land,
 *    and the suite stayed **green** — because the fixture used `"   "` where the
 *    only discriminating input is `""`. A landed-and-green mutation reads
 *    exactly like "the guard is unnecessary" and means the opposite: **the
 *    guard is UNTESTED.** Those are opposite conclusions wearing the same
 *    colour (Identities Polish's finding, and their framing).
 *
 * So there are three outcomes and the naive gate distinguishes two: did not
 * land · landed-but-uncovered · landed-and-caught. Treat landed-and-green as a
 * COVERAGE HOLE, never as a licence to delete the guard.
 *
 * ⚠ AND ONE MUTATION HERE IS A RECONSTRUCTION, NOT A REVERT — say it that way or
 * the next reader gets a no-op and the wrong conclusion. The `ref` nameless
 * fixture (`base("nameless", "")`) earns its empty string against the
 * HISTORICAL predicate pair, which no longer exists in the file: today the
 * filter is `t !== null` and nullness is decided by `!object`, so **there is no
 * name-based filter to delete.** `grep -v` on a line cannot produce it, and the
 * `$before -> $after` form cannot express it. Reproducing it means SUBSTITUTING
 * the historical shape, e.g.
 *   sed -i '' 's|.*object\.name\.trim() === "".*|          return object.name ? { id, name: object.name } : null;|'
 * — gate on the INTRODUCED line (`grep -c` the new text must be 1), then expect
 * RED: `length of 2 but got 3`, the miscount. Verified 2026-10-24. Called a
 * "revert" in the channel first, which is the word that would have sent a
 * successor to `grep -v`, a landed-looking no-op, and "the fixture is
 * unnecessary" (Rail Fix / Identities Polish).
 */

import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GraphState } from "@/features/ontology/graph-state";
import type { OntologyObject } from "@/features/ontology/types";
import { OntologyRow } from "./ontology-row";

/**
 * ⚠ MOCKED SO `nameOf` CAN RETURN ALL THREE OF ITS CONTRACTUAL ANSWERS. The real
 * provider builds its map from the demo data, which can produce a name or a
 * `null` but never a blank one — so the present-but-nameless case for
 * knowledge/skill is unreachable through it. The contract is
 * `(id) => string | null` (`use-workspace-resources.tsx:64`): `null` is absent,
 * `""` is present with no usable name.
 */
vi.mock("../hooks/use-workspace-resources", () => ({
  useWorkspaceResources: () => ({
    workspaceId: "w",
    knowledge: [],
    skills: [],
    homeSpace: true,
    /**
     * ⚠ `""`, NOT `"   "`, FOR THE NAMELESS CASE — and that one character is
     * the difference between a test and a decoration. With whitespace, both
     * `name === null` (correct) and `!name` (the bug) keep the entry, because
     * `"   "` is truthy: a mutation reverting the predicate LANDED and the
     * suite stayed GREEN, which reads exactly like "the guard is unnecessary"
     * and means the opposite — the guard was untested. `""` is the contract's
     * own present-but-unnamed value (`use-workspace-resources.tsx:64`), and it
     * is the only input that separates the two predicates.
     */
    nameOf: (id: string) =>
      id === "kb-named" ? "Sales playbook" : id === "kb-blank" ? "" : null,
  }),
  OntologyResourcesProvider: ({ children }: { children: ReactNode }) => children,
}));

afterEach(cleanup);

const base = (id: string, name: string): OntologyObject =>
  ({
    id,
    name,
    subtitle: "",
    attributes: [],
    relationships: [],
    methods: [],
    childIds: [],
    template: [],
  }) as unknown as OntologyObject;

/** One attribute per state, so one render covers all four in a branch. */
const subjectWith = (kind: "ref" | "knowledge", ids: Record<string, string[]>): OntologyObject =>
  ({
    ...base("subject", "Subject"),
    attributes: [
      { key: "a", label: "No targets", value: { kind, value: [] } },
      { key: "b", label: "All absent", value: { kind, value: ids.absent } },
      { key: "c", label: "Partly absent", value: { kind, value: ids.partial } },
      { key: "d", label: "Present but nameless", value: { kind, value: ids.blank } },
    ],
  }) as unknown as OntologyObject;

const REF_SUBJECT = subjectWith("ref", {
  absent: ["ghost"],
  partial: ["named", "ghost"],
  blank: ["nameless"],
});

const KB_SUBJECT = subjectWith("knowledge", {
  absent: ["kb-ghost"],
  partial: ["kb-named", "kb-ghost"],
  blank: ["kb-blank"],
});

const graphFor = (subject: OntologyObject): GraphState =>
  ({
    ontologies: [],
    objects: {
      subject,
      named: base("named", "Northwind"),
      /**
       * Exists in the graph, carries no usable name. NOT absent.
       *
       * ⚠ `""`, FOR THE REASON GIVEN ABOVE INSIDE THE `nameOf` MOCK
       * (grep: a test and a decoration) —
       * ⚠⚠ that grep target was `CONTRACTUAL ANSWERS` until 2026-10-24, which resolves to
       * the mock's OUTER docblock — the one explaining why the hook is mocked at all, not
       * the one holding this argument. **Correct relation, exactly one hit, and still the
       * wrong block: it pointed at the CONTAINER, not the CONTENT.** Predicted by Rail Fix
       * ("there are TWO docblocks on that mock") and measured by Identities Polish. That is
       * why the rule needs its fourth clause — cite the identifier · make it return exactly
       * what you claim · cite the relation, not the offset · **and point at the content, not
       * the container that holds it.** Two of those clauses were satisfied here and the
       * pointer was still wrong, because neither checks that the target contains the thing
       * promised.
       * ⚠⚠⚠ AND THE REPLACEMENT TARGET WAS WRONG TOO, FOR A NEW REASON. It was
       * ``NOT `"   "` `` — which matched **2**: the note, and this citation, because
       * **a citation written into a file becomes part of what that file greps for.**
       * Self-inclusive, so it can never shrink as the file grows; it can only
       * self-confirm. Hence: **pick a target the citation itself does not contain.**
       *
       * ⚠⚠⚠⚠ AND THAT IS WHERE THIS CHAIN TERMINATES, BY PROOF RATHER THAN BY
       * FATIGUE. The replacement target was then documented here as "→ exactly 1",
       * and *writing that sentence made it 3* — the note, the citation, and the
       * sentence promising the count. **AN ARITY PROMISE ABOUT A FILE CANNOT BE
       * STATED INSIDE THAT FILE: the statement changes the thing it describes.**
       * Self-referential, so no wording fixes it and each fix adds a hit.
       * So the honest in-file cross-reference promises NO COUNT and leans on the
       * RELATION, which is edit-stable: *above, inside the `nameOf` mock*. The grep
       * is a convenience that returns the note plus whatever cites it, and the
       * reader can tell those apart on sight.
       * Four targets, four distinct pointer failures, each inside the fix for the
       * one before — wrong block, wrong arity, self-inclusion, and finally
       * self-reference, which is the one that cannot be repaired by trying harder.
       * (Rail Fix predicted the two-docblock case and found the self-inclusion;
       * Identities Polish measured the arity rule that exposed both.)
       * ⚠⚠ that cross-reference read "TWENTY LINES BELOW" until 2026-10-24. The mock is
       * roughly sixty lines ABOVE this: direction inverted, distance tripled, so a reader
       * following it landed in the render helper and found nothing about `""`. **A
       * cross-reference is a pointer, and that one resolved to empty space — inside the
       * comment whose subject is pointers resolving to the wrong referent** (Rail Fix,
       * instance nine). Hence the identifier rather than a direction and a count: a grep
       * target survives edits between the two, a relative offset does not.
       * this fixture was `"   "`, the exact value that comment rules out, and
       * nothing said why `ref` should differ. It does not. `Boolean("   ")` is
       * true, so the historical bug (a nameless target counted into `missing`)
       * **cannot reproduce on whitespace**: the old predicate kept it, and the
       * count assertion reads 2 either way. Only `""` exercises the miscount.
       * Caught by Identity Cards, 2026-10-24 — the lesson was not missing, not
       * in another file, not twenty lines down in the source: it was in a
       * comment in THIS file, and the fixture above it did the thing the
       * comment warns against.
       */
      nameless: base("nameless", ""),
      // `ghost` is deliberately absent from this map.
    },
  }) as unknown as GraphState;

function renderRow(subject: OntologyObject) {
  return render(
    <OntologyRow
      objectId="subject"
      graph={graphFor(subject)}
      selected={false}
      onSelect={() => {}}
    />
  );
}

/**
 * Both branches get the same four assertions, because they answer the same
 * four-state question and the review found the fix landed in both while the
 * test landed in one.
 */
describe.each([
  ["ref", REF_SUBJECT, "Northwind"],
  ["knowledge", KB_SUBJECT, "Sales playbook"],
])("OntologyRow — %s pointer states", (_kind, subject, resolvedName) => {
  it("renders a marker for a field with NO targets, never a blank cell", () => {
    // The regression guard. Without it `missing = 0 - 0 = 0`, the branch
    // returns an empty fragment, and the `<dd>` is blank — inconsistent with
    // every other kind, which all return `<Empty/>` when unset.
    renderRow(subject);
    expect(screen.getAllByText("Empty")).toHaveLength(1);
  });

  it("says what it lost when every target is absent", () => {
    renderRow(subject);
    expect(screen.getAllByText(/not in this ontology/).length).toBeGreaterThan(0);
  });

  it("reports the loss BESIDE what resolved when only some targets are absent", () => {
    // Previously rendered one chip and lied by omission: it looked complete.
    renderRow(subject);
    expect(screen.getByText(resolvedName)).toBeTruthy();
    // Exactly two fields lose one target each (all-absent, partly-absent). The
    // nameless field must lose NONE — a miscount makes this 3, which is the
    // assertion that actually holds the nameless case.
    expect(screen.getAllByText("1 not in this ontology")).toHaveLength(2);
  });

  it("renders a nameless target as a chip, not as a loss", () => {
    /**
     * ⚠ ASSERTS THE CHIP, NOT THE EM-DASH ANYWHERE IN THE ROW. The first
     * version was `getAllByText("—").length > 0`, which `ontology-row.tsx:159`
     * also satisfies — it renders an em-dash for a blank FIELD LABEL too. With
     * every fixture label non-empty that discriminated only by accident of the
     * fixture, so a later test adding a blank label would have made it pass
     * for the wrong reason. The chip carries the name in its `title`, so
     * querying by title reaches the chip and nothing else.
     */
    renderRow(subject);
    expect(screen.getByTitle("—")).toBeTruthy();
  });
});
