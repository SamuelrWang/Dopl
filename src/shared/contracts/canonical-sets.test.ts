import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * THE CENSUS — proof that each canonical set has exactly ONE literal
 * declaration in this repository (2026-09-02, v2 slice A13).
 *
 * ⚠ **THIS IS THE TEST THAT REPLACES THREE DRIFT-GATE SITES, AND IT IS A
 * DIFFERENT KIND OF ASSERTION FROM THEM.** `check-{message-kind,role,
 * session-health}-drift.ts` compared two hand copies and reported a
 * DISAGREEMENT. They cannot see the failure that matters now, which is a second
 * copy APPEARING — an agent that adds `export type ChannelMessageKind = …` back
 * into `packages/dopl-client/src/channel-types.ts` writes something that
 * compiles, ships, and silently shadows the package for that tree's consumers.
 * A gate over a re-export cannot notice; a census can.
 *
 * ⚠ **IT COUNTS LITERAL DECLARATIONS, NEVER RE-EXPORTS.** `export type { X }`
 * and `export type { X } from "…"` are the CORRECT shape and must stay free:
 * both trees are expected to re-export every one of these names, and a test that
 * banned that would ban the arrangement it exists to protect. Only
 * `export type X = "a" | "b"` and `export interface X {` count.
 *
 * ⚠ **THE COMMITTED `dist/` IS SCANNED TOO.** It is what `@dopl/mcp-server` and
 * `main` actually import, it is a TRACKED file, and it has been hand-edited
 * before (`check-role-drift.ts`'s header records the wave where that happened).
 * A source that re-exports and a `dist/` that declares is exactly the state
 * three of those gates existed to catch.
 *
 * ⚠ Scoped to the two TypeScript trees the package serves. `dopl-desktop-app/`
 * is deliberately OUT: it is a separate npm project that cannot depend on a
 * workspace package at all, so its copies are a different problem with a
 * different answer (they are `.js`, and the drift scripts that still name them
 * say so).
 */

const REPO_ROOT = resolve(__dirname, "../../..");

/** Every name `@dopl/contracts` publishes, and therefore every name that may
 *  not be declared a second time anywhere this census can see. */
const CANONICAL = [
  "ChannelVisibility",
  "ChannelRole",
  "ThreadMode",
  "ThreadStatus",
  "ThreadOutcome",
  "MessageAuthorKind",
  "PostableAuthorKind",
  "ChannelMessageKind",
  "PostableMessageKind",
  "MessageIntent",
  "SessionPillState",
  "ChannelSessionTelemetry",
  "ChannelSessionHealth",
  "DirectionRefusalReason",
  "LaunchRefusalReason",
  "LaunchDirectiveKind",
  "LaunchToolMode",
  "LaunchMessageMode",
  "PingKind",
  "PingRecipientKind",
  "WorkspaceRole",
  "MembershipStatus",
  "WorkspaceKind",
  "TemplateVisibility",
] as const;

/**
 * The two names the SDK publishes under a spelling of its own. They are the
 * SAME set — aliased on the way through `channel-types.ts` — so a literal
 * declaration of either is the drift this census is looking for.
 */
const SDK_ALIASES: Record<string, string> = {
  ChannelMemberRole: "ChannelRole",
  ChannelAuthorKind: "MessageAuthorKind",
};

const TREES = ["src", "packages"];
const SKIP_DIRS = new Set(["node_modules", ".next"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(resolve(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      // ⚠ TEST FILES ARE OUT, and not as a convenience: the drift gates' own
      // mutation tests carry declarations as STRING FIXTURES
      // (`message-kind-drift.test.ts` rewrites `PostableMessageKind` into a
      // hand-typed union to prove the gate catches it), and a census that read
      // those would fail on the tests that prove the gates work.
      out.push(resolve(dir, entry.name));
    }
  }
  return out;
}

const FILES = TREES.flatMap((t) => walk(resolve(REPO_ROOT, t)));

/**
 * Files declaring `name` as a type alias or an interface — a RE-EXPORT is not a
 * declaration and is deliberately unmatched, which is what makes the arrangement
 * legal to write.
 */
function declarationSites(name: string): string[] {
  const re = new RegExp(
    `(?:export\\s+)?(?:declare\\s+)?(?:type\\s+${name}\\s*=(?!\\s*\\{?\\s*$)|interface\\s+${name}\\s*\\{)`
  );
  return FILES.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) =>
    f.slice(REPO_ROOT.length + 1)
  );
}

describe("the canonical closed sets are declared exactly once", () => {
  it("scans a tree that is actually there", () => {
    // ⚠ A census whose reader silently matches nothing is a green test that
    // proves nothing — the failure mode `check-role-drift.ts` shipped with.
    expect(FILES.length).toBeGreaterThan(400);
    expect(FILES).toContain(
      resolve(REPO_ROOT, "packages/contracts/src/channels.ts")
    );
  });

  it.each(CANONICAL)("%s is declared only in @dopl/contracts", (name) => {
    expect(declarationSites(name)).toEqual([
      expect.stringMatching(/^packages\/contracts\/src\/\w+\.ts$/),
    ]);
  });

  it.each(Object.keys(SDK_ALIASES))(
    "%s is an alias of a canonical set, never a second declaration",
    (alias) => {
      expect(declarationSites(alias)).toEqual([]);
    }
  );

  it("would catch a copy re-appearing in the SDK", () => {
    // The mutation this census exists for, proved on the reader rather than on
    // the tree: `declarationSites` must not treat a re-export as a declaration,
    // and must treat a literal union as one.
    const asDeclaration = /(?:export\s+)?type\s+ChannelMessageKind\s*=(?!\s*\{?\s*$)/;
    expect(asDeclaration.test('export type ChannelMessageKind = "message";')).toBe(
      true
    );
    expect(
      asDeclaration.test('export type { ChannelMessageKind } from "@dopl/contracts";')
    ).toBe(false);
  });

  it("every canonical name is exported from the package index", () => {
    const index = readFileSync(
      resolve(REPO_ROOT, "packages/contracts/src/index.ts"),
      "utf8"
    );
    // ⚠ `index.ts` lists every name rather than `export *`, so this is a real
    // assertion: a module added without an index line publishes nothing.
    for (const name of CANONICAL) {
      expect(index).toMatch(new RegExp(`\\b${name}\\b[,\\s}]`));
    }
  });
});
