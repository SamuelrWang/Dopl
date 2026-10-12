import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTAINER_KIND_MARKER,
  checkContainerKind,
  sliceFrom,
  type Read,
} from "../../../scripts/check-role-drift";

/**
 * THE CONTAINER-KIND GATE, MUTATION-VERIFIED — and it exists because the gate
 * went GREEN when it stopped checking.
 *
 * ⚠ **THE HOLE, MEASURED 2026-10-12 (M01 cleanup, Flag 1).**
 * `checkContainerKind` reads the `containerKind` switch as SOURCE TEXT, because
 * its `default` arm makes every input resolve and a green compile therefore
 * proves nothing. It sliced with `src.slice(src.indexOf(marker))`, and
 * `indexOf` answers −1 for an absent marker: `slice(-1)` returns the file's LAST
 * CHARACTER, the `case "…"` loop finds nothing missing in one character, and the
 * gate printed *"✅ Container kind: … one mapping"* about a mapping it could no
 * longer see. Renaming `containerKind` → `containerKindOf` was enough. Deleting
 * an ARM failed correctly the whole time, which is exactly what hid it: the gate
 * failed only in the direction somebody had already tested.
 *
 * ⚠ **SO THE TWO DIRECTIONS ARE TESTED SEPARATELY AND THEY ARE DIFFERENT
 * OUTCOMES.** A missing arm is DRIFT (`true` + a `[drift]` line): two
 * declarations disagree, which is a claim the gate is entitled to make. An
 * unreadable declaration is a THROW: the gate could not see its own subject, and
 * reporting that as drift would name the wrong file in CI.
 *
 * ⚠ **THE MARKER IS IMPORTED, NEVER RE-TYPED.** A test carrying its own copy of
 * `"export function containerKind("` proves that ITS copy is present, which is
 * the one thing not in question.
 *
 * ⚠ It lives here rather than beside the script because the root vitest project
 * is `src/**` only; `check-role-drift.ts`'s `main()` is `require.main`-guarded,
 * so importing it runs the helpers and not the gate. Same shape, and the same
 * argument, as `src/features/channels/message-kind-drift.test.ts`.
 */

const REPO_ROOT = resolve(__dirname, "../../..");
const realRead: Read = (rel) => readFileSync(resolve(REPO_ROOT, rel), "utf8");
const MIGRATIONS = resolve(REPO_ROOT, "supabase/migrations");
const MAPPER = "packages/mcp-server/src/workspace-directory.ts";

/** `realRead`, with one file's text rewritten. The mutation surface. */
const readWith = (rel: string, mutate: (src: string) => string): Read => {
  const patched = mutate(realRead(rel));
  return (r) => (r === rel ? patched : realRead(r));
};

afterEach(() => {
  vi.restoreAllMocks();
});

/** The gate narrates on both paths; swallow it so a red run reads cleanly. */
function quietly<T>(run: () => T): T {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  return run();
}

describe("check-role-drift › the container-kind slice cannot match nothing", () => {
  it("the marker it slices on is present in the tree as it stands", () => {
    // The control: every assertion below is meaningless if the gate's subject
    // is already unreadable, so this one must pass before they mean anything.
    expect(realRead(MAPPER)).toContain(CONTAINER_KIND_MARKER);
    expect(quietly(() => checkContainerKind(realRead, MIGRATIONS))).toBe(false);
  });

  it("THROWS, naming the marker, when the declaration is renamed", () => {
    // The hole. Before the fix this returned `false` and printed the ✅ line.
    const read = readWith(MAPPER, (s) =>
      s.replace(CONTAINER_KIND_MARKER, "export function containerKindOf("),
    );
    expect(() => quietly(() => checkContainerKind(read, MIGRATIONS))).toThrow(
      /could not find `export function containerKind\(`/,
    );
  });

  it("THROWS when the declaration is moved out of the file entirely", () => {
    // The other way the marker goes missing: a split that re-exports from here.
    const read = readWith(MAPPER, (s) =>
      s.replace(
        CONTAINER_KIND_MARKER,
        "export { containerKind } from './container-kind.js';\nfunction unusedContainerKind(",
      ),
    );
    expect(() => quietly(() => checkContainerKind(read, MIGRATIONS))).toThrow(
      /slices that declaration by source text/,
    );
  });

  it("a COMMENT that mentions the marker does not satisfy the slice", () => {
    // Measured 2026-10-12: a trap note added to that file's own docblock spelled
    // the marker out, `indexOf` matched the PROSE first, and the slice started
    // inside a comment — so the renamed-declaration case above passed. The gate
    // strips comments before slicing; this is what holds it to that.
    const read = readWith(MAPPER, (s) =>
      s
        .replace(CONTAINER_KIND_MARKER, "export function containerKindOf(")
        .replace("/**", `/**\n * mentions ${CONTAINER_KIND_MARKER} in prose\n *`),
    );
    expect(() => quietly(() => checkContainerKind(read, MIGRATIONS))).toThrow(
      /could not find `export function containerKind\(`/,
    );
  });

  it("reports DRIFT, not a throw, when an arm is deleted", () => {
    // The direction that already worked: a storable kind with no `case`, which
    // would fall to `default` and be advertised as a workspace.
    const read = readWith(MAPPER, (s) =>
      s.replace('    case "home":\n      return "home";\n', ""),
    );
    expect(quietly(() => checkContainerKind(read, MIGRATIONS))).toBe(true);
  });

  it("names the kind whose arm went missing", () => {
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    const read = readWith(MAPPER, (s) =>
      s.replace('    case "link":\n      return "home_channel";\n', ""),
    );
    expect(checkContainerKind(read, MIGRATIONS)).toBe(true);
    expect(errors.join("\n")).toMatch(/containerKind has no `case "link"`/);
  });
});

describe("sliceFrom", () => {
  it("returns the text from the marker onwards", () => {
    expect(sliceFrom("aaaMARKERzzz", "MARKER", "a fixture")).toBe("MARKERzzz");
  });

  it("throws rather than returning the last character", () => {
    // `"abc".slice(-1)` is `"c"` — a truthy string that passes every
    // `includes()` the callers run, which is the whole defect.
    expect(() => sliceFrom("abc", "MARKER", "a fixture")).toThrow(
      /could not find `MARKER` in a fixture/,
    );
  });

  it("names the subject it could not read, so CI blames the right file", () => {
    expect(() => sliceFrom("abc", "MARKER", "some/file.ts")).toThrow(
      /in some\/file\.ts/,
    );
  });
});
