// THE SECOND DRIFT ALARM ON THE dopl:// MAP — reserved workspace slugs against
// the roots the desktop refuses to read as a workspace.
//
// WHY IT IS ITS OWN FILE. `deep-link-target.test.mjs` is the GRAMMAR's truth
// table and it crossed the 500-line cap when this was appended to it. Same
// seam the rest of this tree uses: the machinery stays put, the cases split by
// what they are ABOUT. That file owns "what does this URL parse to"; this one
// owns "are the two lists that decide it still the same list".
//
// Run: `node --test dopl-desktop-app/test/deep-link-reserved-slugs.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const targetModule = require(join(HERE, "..", "main", "deep-link-target.js"));

const { PROTOCOL_PREFIX, HOME_ROUTE, WEB_ONLY_ROOTS, parseDeepLink, webPathToRoute } =
  targetModule;

/** A canonical `{slug}-{publicId}` workspace segment. */
const SEG = "acme-a1b2c3d4e5f6";

/**
 * 🔒 `RESERVED_WORKSPACE_SLUGS` ⊆ (`WEB_ONLY_ROOTS` ∪ `ROOT_ROUTES` ∪ an
 * allowlist that says WHY). G6 in `docs/DRIFT-LEDGER-2026-08-30.md` §3; closes
 * and widens F-317.
 *
 * ⚠ THE TWO LISTS ANSWER THE SAME QUESTION FROM OPPOSITE SIDES.
 * `src/config/index.ts › RESERVED_WORKSPACE_SLUGS` says "no workspace may be
 * NAMED this, because a top-level route would shadow it"; `WEB_ONLY_ROOTS` says
 * "a first segment spelled this is NOT a workspace". A name on the first list
 * and absent from the second is precisely the bug F-317 filed: the web refuses
 * to mint the workspace, and the desktop resolves the URL as if one existed.
 *
 * ⚠ FIVE WERE MISSING WHEN THIS WAS WRITTEN — `link`, `c`, `authenticate`,
 * `signup`, `get-started`. `dopl://open?target=/link/{token}`, the claim link
 * that brings a person into a home channel, opened `/link/overview`. F-317 knew
 * only `link`.
 *
 * ⚠ MAIN CANNOT IMPORT THE WEB TREE'S TYPESCRIPT, so this is a source read, the
 * same seam `deep-link-target.test.mjs` uses to read `routes.tsx`.
 */
test("every RESERVED_WORKSPACE_SLUG is handled, or allowlisted with a reason", () => {
  const configSrc = readFileSync(
    join(HERE, "..", "..", "src", "config", "index.ts"),
    "utf8"
  );
  const block = /RESERVED_WORKSPACE_SLUGS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/.exec(configSrc);
  assert.ok(block, "could not find RESERVED_WORKSPACE_SLUGS in src/config/index.ts");
  // Comments in that list are prose about WHY each slug is reserved and quote
  // route paths; strip them or a quoted path becomes a slug.
  const listed = block[1].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const reserved = [...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(reserved.length > 20, `read only ${reserved.length} reserved slugs — the scan broke`);

  // Reserved, and NOT a web-only root — each with the reason it does not need
  // to be one. ⚠ THIS MAY ONLY EVER SHRINK. An entry lands here when the slug
  // is reserved DEFENSIVELY (no top-level web route carries it) or is a static
  // segment nested under a root that is already covered. Never because adding
  // the root was awkward.
  const ALLOWED = {
    // Static segments under `/api/…`; `api` is the root, and it is a web-only
    // root already.
    "ensure-default": "nested under /api/workspaces",
    resolve: "nested under /api/workspaces",
    mcp: "nested under /api",
    workspaces: "nested under /api",
    // Reserved DEFENSIVELY — no top-level web route carries these today, so a
    // deep link naming one is honestly an unknown workspace and resolving it as
    // such is the correct answer.
    browse: "no top-level route",
    build: "no top-level route",
    connect: "no top-level route",
    design: "no top-level route",
    docs: "no top-level route",
    e: "no top-level route",
    welcome: "no top-level route",
    // A WORKSPACE PAGE name (`WORKSPACE_PAGES.settings`), reserved so a slug
    // cannot shadow `/{segment}/settings`. Not a root.
    settings: "a workspace page, not a root",
  };

  const unhandled = reserved.filter(
    (slug) =>
      !WEB_ONLY_ROOTS.has(slug) &&
      !targetModule.ROOT_ROUTES.has(slug) &&
      !Object.prototype.hasOwnProperty.call(ALLOWED, slug)
  );
  assert.deepEqual(
    unhandled,
    [],
    "reserved slug(s) a deep link would resolve as a WORKSPACE — add them to WEB_ONLY_ROOTS (F-317)"
  );

  // …and the allowlist may not outlive its entries: a name that is no longer
  // reserved is a comment claiming a fact.
  const stale = Object.keys(ALLOWED).filter((slug) => !reserved.includes(slug));
  assert.deepEqual(stale, [], "allowlist entries that are no longer reserved slugs");
});

test("the five roots F-317 was missing resolve to the boot route, not a workspace", () => {
  // Each is a live top-level web route whose first segment used to parse as a
  // workspace slug. `/link/{token}` is the one with teeth: it is the claim link
  // that brings a person into a home channel.
  for (const [root, rest] of [
    ["link", "3f9c1a2b4d5e6f70"],
    ["c", SEG],
    ["authenticate", ""],
    ["signup", ""],
    ["get-started", ""],
  ]) {
    const path = rest ? `/${root}/${rest}` : `/${root}`;
    assert.equal(webPathToRoute(path), HOME_ROUTE, path);
    // …and the grammar still hands the map the path AS WRITTEN.
    assert.equal(
      parseDeepLink(`${PROTOCOL_PREFIX}open?target=${encodeURIComponent(path)}`).target,
      path
    );
  }
});
