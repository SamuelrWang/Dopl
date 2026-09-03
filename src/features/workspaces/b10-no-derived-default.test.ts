/**
 * 🔒 **THE DEFAULT WORKSPACE IS GONE — IN CODE AND IN SQL** (wave B B14,
 * Samuel's ruling B10: *"the home channel is now the default … all workspaces
 * are just normal workspaces"*).
 *
 * ⚠ **WHY A GATE AND NOT A DIFF REVIEW.** The concept was not one function. It
 * was a repository lookup, an RPC, a kind guard on that RPC, a membership count
 * with a refusal at each end, a choice list in an error envelope, a dedicated
 * provisioning route, a page that forwarded to it and two write fences that
 * asked it "is this my home". Removing eight things is a diff; keeping them
 * removed is a gate — and the shape of the regression is a *reintroduction*
 * under the old name, in a file nobody re-reads, which is exactly what a scan
 * catches and a review does not.
 *
 * ⚠ **SCOPED TO B14's SURFACE, AND THE SCOPE IS DECLARED RATHER THAN "the
 * repo".** `packages/mcp-server` and the SPA still carry the wording, and both
 * are other slices' (B13's `workspace=` retirement, B15's copy retirement) —
 * a gate that failed for them would be red on arrival and get deleted. When
 * those slices land, they add their trees here.
 *
 * ⚠ **IT SCANS COMMENTS TOO, DELIBERATELY.** The concept lived as much in the
 * prose as in the code — three files explained which workspace was "the
 * default" and why — and a comment that still says it is the next agent's
 * instruction. There is no allowlist: a sentence describing the REMOVAL can be
 * written without naming the thing removed, and every one in this slice is.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PERSONAL_CONTAINER_PLACEHOLDER_NAME } from "./server/service";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Every path B14 owns or edited, files and directories alike. */
const SCOPE = [
  "src/features/workspaces",
  "src/features/billing",
  "src/features/onboarding/server",
  "src/app/billing",
  "src/app/auth/callback",
  "src/app/api/workspaces",
  "src/shared/auth/with-workspace-auth.ts",
  "src/shared/auth/with-workspace-auth.test.ts",
  "src/shared/auth/with-workspace-auth-mcp-logging.test.ts",
  "src/features/knowledge/server/service-base-gates.ts",
  "src/features/agent-templates/server/service-writes.ts",
  "packages/contracts/src/workspaces.ts",
  "scripts/check-role-drift.ts",
];

/**
 * The concept's spellings — the identifier casings AND the two English phrases.
 * ⚠ `default resolution` is on it because that is what the removed lookup was
 * CALLED at three of its sites; leaving the phrase would leave a reader looking
 * for a mechanism that no longer exists.
 */
const BANNED = /default[ _-]?workspace|defaultworkspace|default[ _-]?resolution/i;

function walk(path: string, out: string[] = []): string[] {
  if (statSync(path).isFile()) {
    if (/\.(ts|tsx)$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    walk(join(path, entry.name), out);
  }
  return out;
}

/**
 * ⚠ THE GATE EXCLUDES ITSELF, AND ONLY ITSELF. A scan has to be able to name
 * what it forbids — the red-proof case below quotes five of the deleted strings
 * verbatim — and a self-match would be the one failure this file can never fix.
 * It is an exclusion of ONE path, not a list that can grow.
 * ⚠ Its FILENAME had to be renamed for the same reason: `service.ts` cites this
 * file, so a filename containing the banned phrase reintroduced it into a file
 * in scope. A gate whose own name is the regression is not a gate.
 */
const SELF = "src/features/workspaces/b10-no-derived-default.test.ts";

const FILES = SCOPE.flatMap((rel) => walk(join(ROOT, rel))).filter(
  (f) => relative(ROOT, f).split("\\").join("/") !== SELF
);

describe("🔒 B10 — nothing in B14's surface names a default workspace", () => {
  it("the scan reaches real files (a scan that reads nothing is not a gate)", () => {
    // ⚠ RED PROOF. A typo'd path in SCOPE would make every assertion below
    // vacuous, and `readdirSync` on a missing directory throws rather than
    // returning empty — so the risk this covers is a scope that shrank to one
    // trivial file.
    expect(FILES.length).toBeGreaterThan(60);
    expect(FILES.some((f) => f.endsWith("server/service.ts"))).toBe(true);
    expect(FILES.some((f) => f.endsWith("server/credits-service.ts"))).toBe(true);
  });

  it("the pattern SEES every spelling it claims to", () => {
    // Over the real strings this slice deleted, not invented ones.
    for (const sample of [
      "export async function ensureDefaultWorkspace(userId: string)",
      "await findDefaultWorkspaceForUser(ctx.userId)",
      'db.rpc("ensure_default_workspace", {',
      " * bare `/billing` resolves the caller's DEFAULT workspace",
      " * and implicit default-resolution site filters through this",
    ]) {
      expect(BANNED.test(sample), sample).toBe(true);
    }
    // …and does not fire on the words used separately.
    expect(BANNED.test("the default is FALSE and silent")).toBe(false);
    expect(BANNED.test("every user-facing workspace list")).toBe(false);
  });

  it("no file in scope matches, in code OR in prose", () => {
    const offenders = FILES.filter((f) => BANNED.test(readFileSync(f, "utf8"))).map(
      (f) => relative(ROOT, f).split("\\").join("/")
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * The SQL half. `20260922120000` drops the RPC the concept lived in, and with it
 * `20260823160000`'s kind guard — which is that RPC's own body, not a separate
 * object, so there is nothing else to drop.
 *
 * ⚠ TEXT ASSERTIONS, AND THEY KNOW IT. Only a database can say a DROP succeeds
 * or that the restated function still mints what it minted; replay is owed for
 * every wave-B migration (F-563) and Docker has been down throughout. What these
 * prove is that the file still SAYS what its header claims.
 */
describe("🔒 20260922120000 — the concept's SQL objects", () => {
  const read = (name: string) =>
    readFileSync(join(ROOT, "supabase", "migrations", name), "utf8");
  const sql = read("20260922120000_drop_default_workspace_rpc.sql");

  it("drops BOTH functions, by full signature and without CASCADE", () => {
    expect(sql).toContain(
      "DROP FUNCTION IF EXISTS public.ensure_default_workspace(uuid, text, text, text);"
    );
    expect(sql).toContain(
      "DROP FUNCTION IF EXISTS public.default_workspace_of(uuid);"
    );
    // ⚠ A `CASCADE` would silently take whatever a later migration hung off
    // them. A failing DROP is the correct outcome — it names a caller nobody
    // moved.
    expect(sql).not.toMatch(/DROP\s+FUNCTION[^;]*CASCADE/i);
  });

  it("🔒 the live dependency is REPOINTED before it is dropped, not after", () => {
    // `default_workspace_of` is what `ensure_personal_container` reads for the
    // name and created_at a container inherits. Dropping it first is a runtime
    // failure on the next mint — plpgsql resolves the call when it runs.
    const repoint = sql.indexOf("public.personal_container_origin_of(p_owner_id)");
    const drop = sql.indexOf("DROP FUNCTION IF EXISTS public.default_workspace_of");
    expect(repoint).toBeGreaterThan(-1);
    expect(drop).toBeGreaterThan(repoint);
    // …and the restatement is a real one: no call to the old name survives it.
    expect(sql.slice(repoint, drop)).not.toContain("default_workspace_of(p_owner_id)");
  });

  it("the successor answers EXACTLY what the helper it replaces answered", () => {
    // Provenance must not shift between one apply and the next: a container
    // already minted from workspace X must go on naming X as its origin.
    const body = /ORDER BY \(slug = 'default'\) DESC, created_at ASC/;
    expect(sql).toMatch(body);
    expect(read("20260920120000_workspace_kind_personal.sql")).toMatch(body);
  });

  it("is idempotent, and touches no row", () => {
    for (const create of sql.match(/CREATE (?:OR REPLACE )?FUNCTION/g) ?? []) {
      expect(create).toBe("CREATE OR REPLACE FUNCTION");
    }
    // ⚠ FUNCTION BODIES STRIPPED FIRST. `ensure_personal_container` INSERTs —
    // that is what it is for — and a scan that read its restated body would
    // report this file as destructive. What must hold is that no statement
    // THIS FILE executes touches a row: a revert loses no data, which is why
    // the concept could be deleted for free.
    // ⚠ `\s` after the verb, not a bare alternation: `updated_at timestamptz`
    // in the RETURNS TABLE block matches a bare `UPDATE`, which would make this
    // case red for a reason that has nothing to do with what it measures.
    const statements = sql.replace(/\$\$[\s\S]*?\$\$/g, "__FUNCTION_BODY__");
    expect(statements).not.toMatch(/^\s*(DELETE|DROP TABLE|TRUNCATE|UPDATE|INSERT)\s/im);
  });

  it("keeps the RPC service-role only", () => {
    for (const grantee of ["public", "anon", "authenticated"]) {
      expect(sql).toContain(
        `REVOKE ALL ON FUNCTION public.ensure_personal_container(uuid, text) FROM ${grantee};`
      );
    }
  });

  it("🔒 the placeholder name the app checks IS the one the SQL mints", () => {
    // `renamePersonalContainerIfPlaceholder` only renames a container still
    // wearing this name. A drift here is silent in both directions: onboarding
    // would either refuse to name a fresh container or overwrite one a user
    // already named.
    expect(sql).toContain(`COALESCE(origin.name, '${PERSONAL_CONTAINER_PLACEHOLDER_NAME}')`);
  });
});
