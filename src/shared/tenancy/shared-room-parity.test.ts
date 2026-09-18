import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { isSharedRoom } from "./shared-room";

/**
 * 🔒 **ONE QUESTION, TWO TREES, AND A CENSUS THAT STOPS A THIRD** — the parity
 * half of R-08 / R-15 (2026-09-17; F-513), on
 * `features/channels/lib/tool-profile-resolve-parity.test.ts`'s exact argument.
 *
 * ⚠ **WHY THERE IS A COPY AT ALL.** `packages/mcp-server` cannot import `src/`
 * — it is a separate build with its own tsconfig, shipped as its own package
 * and kept external by `next.config.ts › serverExternalPackages` — and
 * `@dopl/contracts`, the one module all three trees already share, is TYPE-ONLY
 * (no runtime export condition, no build), so it cannot hold a function. The
 * ruling asked for ONE predicate; the layering allows one per tree, so what
 * this file buys is that the two bodies cannot disagree.
 *
 * ⚠ **IT RUNS THE REAL CODE.** The package's own source is sliced and
 * evaluated, so this is not two suites each agreeing with themselves.
 */

const REPO_ROOT = path.join(import.meta.dirname, "..", "..", "..");
const MCP_SRC = readFileSync(
  path.join(REPO_ROOT, "packages", "mcp-server", "src", "shared-room.ts"),
  "utf8",
);

/** The package's `isSharedRoom`, sliced out of its own source and made callable. */
function mcpIsSharedRoom(): (n: number | null | undefined) => boolean {
  const signature = "export function isSharedRoom(";
  const begin = MCP_SRC.indexOf(signature);
  expect(begin, "the package's isSharedRoom is gone or renamed").toBeGreaterThan(-1);
  const open = MCP_SRC.indexOf("{", begin);
  const close = MCP_SRC.indexOf("\n}", open);
  expect(close, "the package's isSharedRoom body is not a single block").toBeGreaterThan(open);
  const body = MCP_SRC.slice(open + 1, close);
  return new Function("memberCount", body) as ReturnType<typeof mcpIsSharedRoom>;
}

const mcp = mcpIsSharedRoom();

describe("the two trees answer the same room the same way", () => {
  it("agrees over the whole input domain", () => {
    const domain: Array<number | null | undefined> = [
      undefined, null, 0, 1, 2, 3, 9, 40, 1_000,
    ];
    for (const n of domain) {
      expect(mcp(n), `memberCount=${String(n)}`).toBe(isSharedRoom(n));
    }
  });

  it("🔒 the package's body carries no kind term", () => {
    // ⚠ Cheap, and it is the drift this ruling was bought to stop: a reader
    // that re-added `kind === "link" &&` in front of the count would still
    // agree with this tree on every NUMBER above, because the kind is not an
    // input to the comparison — only the source can say it is gone.
    const body = /export function isSharedRoom[\s\S]*?\n\}/.exec(MCP_SRC)?.[0];
    expect(body, "the package's isSharedRoom is gone or renamed").toBeDefined();
    expect(body).not.toMatch(/\bkind\b/);
    expect(body).toContain("!== 1");
  });
});

// ── The census ───────────────────────────────────────────────────────

/**
 * 🔒 **THE RETIRED SPELLING, AND THE ONE PLACE IT IS STILL ALLOWED.**
 *
 * Until 2026-09-17 three sites asked `kind === 'link' && memberCount !== 1` —
 * `mcp-server/src/factory.ts › lockedTo`, `mcp-server/src/tools/confirm-token.ts
 * › resolveConfirmTarget` and `features/workspaces/server/shared-publish.ts ›
 * assertSharedPublishAcknowledged`. All three now call the one predicate. This
 * scan fails if a fourth appears.
 *
 * ⚠ **IT MATCHES A CONJUNCTION, NOT A KIND TEST.** `kind === "link"` on its own
 * is a legitimate question with several legitimate askers (the ontology share
 * scope, the billing upgrade path, the home-channel derivation). What is
 * retired is asking it *and then* counting the members, which is the "is this
 * room shared" question wearing a kind term.
 *
 * ⚠ **COMMENTS ARE STRIPPED FIRST** — every file above documents the spelling
 * it stopped using, and a census that failed on its own audit trail would be
 * paid for by deleting the audit trail.
 */
/**
 * 🔒 **EMPTY SINCE 2026-09-18, AND THE EMPTYING IS THE RECORD (F-718 RESOLVED).**
 * Its one entry was `features/knowledge/server/service-audience.ts`, carried
 * because the AGENT AUDIENCE CEILING is a per-REQUEST bound rather than the
 * room's own fact and widening it needed its own ruling. Samuel ruled it
 * fail-closed: the ceiling now asks `channel-scope.ts ›
 * channelScopeAllowedForKind` and then {@link isSharedRoom}, so it deviates from
 * nothing and the entry would be a licence over code that no longer needs one.
 *
 * ⚠ **THE TWO CASES BELOW STILL EARN THIS FILE WITH THE LIST EMPTY** — the scan
 * fails on a NEW site, which is the half that matters now. The staleness case
 * loops over nothing and is kept only so the next documented deviation has a
 * home that already checks itself; delete both if none arrives.
 */
const DEVIATIONS: ReadonlyArray<readonly [string, string]> = [];

const SCAN_ROOTS = ["src", "packages", "apps"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "build"]);

/**
 * ⚠ **TESTS ARE OUT OF RANGE, AND THAT IS A REAL BOUND ON THIS CENSUS.** A
 * suite QUOTES patterns for a living — `features/workspaces/home-channel-
 * derivation.test.ts` carries the retired spelling verbatim as its own red
 * proof, and the arms this ruling inverted name what they used to assert. So
 * this scan says nothing about a copy of the predicate inside a fixture; what
 * it guards is that no SHIPPED site asks the question with a kind term again.
 */
const IS_TEST = /\.test\.tsx?$/;

/** Either order: the kind test, then a member count, or a member count then the kind test. */
const KIND_TEST = String.raw`(?:kind\s*[!=]==\s*["']link["']|containerKind\([^)]*\)\s*[!=]==\s*["']home channel["'])`;
const COUNT = String.raw`(?:memberCount|countActive\w*|members\s*[<>]=?\s*\d)`;
const RETIRED = new RegExp(
  `${KIND_TEST}[\\s\\S]{0,300}?${COUNT}|${COUNT}[\\s\\S]{0,300}?${KIND_TEST}`,
);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Block and line comments removed, so an entry's own audit trail cannot fail it. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("no site asks 'is this room shared' with a kind term", () => {
  it("scans something at all — a census over nothing is not a guard", () => {
    const files = SCAN_ROOTS.flatMap((r) => sources(path.join(REPO_ROOT, r)));
    expect(files.length).toBeGreaterThan(500);
  });

  it("CAN see the three retired spellings — red proof, in the words they were written in", () => {
    // ⚠ Verbatim from the pre-image of each site, so a regex that stopped
    // matching fails here rather than passing the scan silently.
    const samples = [
      // factory.ts › lockedTo
      `active && containerKind(active) === "home channel" && (active.memberCount ?? 0) !== 1`,
      // tools/confirm-token.ts › resolveConfirmTarget
      `const container = containerKind(found) === "home channel";\n` +
        `sharedContainer: container && (found.memberCount ?? 0) !== 1,`,
      // workspaces/server/shared-publish.ts › assertSharedPublishAcknowledged
      `if (workspace === null || workspace.kind !== "link") return;\n` +
        `const members = await countActiveMembers(input.workspaceId);\n` +
        `if (members < 2) return;`,
    ];
    for (const sample of samples) {
      expect(RETIRED.test(sample), sample).toBe(true);
    }
    // …and it does NOT fire on a kind test with no count anywhere near it, which
    // is a legitimate question with several legitimate askers.
    expect(RETIRED.test(`if (kind !== "link") return unrestricted;`)).toBe(false);
  });

  it("🔒 finds the retired `kind === 'link' && memberCount` spelling nowhere new", () => {
    const allowed = new Set(DEVIATIONS.map(([f]) => f));
    const found: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const full of sources(path.join(REPO_ROOT, root))) {
        const rel = path.relative(REPO_ROOT, full);
        if (allowed.has(rel) || IS_TEST.test(rel)) continue;
        if (RETIRED.test(code(readFileSync(full, "utf8")))) found.push(rel);
      }
    }
    expect(found, "these ask the shared question with a kind term").toEqual([]);
  });

  it("🔒 every DOCUMENTED deviation still deviates — a stale entry is a silent licence", () => {
    for (const [rel, why] of DEVIATIONS) {
      const text = code(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
      expect(RETIRED.test(text), `${rel} no longer deviates: ${why}`).toBe(true);
    }
  });
});
