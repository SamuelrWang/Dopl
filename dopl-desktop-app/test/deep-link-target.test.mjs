// THE dopl:// GRAMMAR AND THE WEB → SPA MAP, as a truth table.
//
// WHAT THIS FEATURE RISKS. A deep-link handler is a URL an ARBITRARY program can
// hand this app — any web page, any mail client, any `open dopl://…` — so the
// two questions are not "does the happy path route" but:
//
//   • can a crafted target make the app navigate somewhere it should not?
//     (an absolute URL, a protocol-relative one, a traversal, an encoded
//     separator, a control byte) — every one of those must come back `null`
//   • can a link make the app do NOTHING, or crash? Neither is allowed. A
//     malformed target opens the app at home; the person clicked a Dopl link.
//
// And one drift alarm: the page table is a hand copy of the SPA's route table,
// so a page ported into the SPA and not added here would be silently
// unreachable by any link. The last case reads routes.tsx and compares.
//
// main/deep-link-target.js is pure (no electron, no window, no I/O) precisely so
// all of that is a table here. The wiring is main/deep-link.js.
//
// Run: `node --test dopl-desktop-app/test/deep-link-target.test.mjs`

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const targetModule = require(join(HERE, "..", "main", "deep-link-target.js"));

const {
  PROTOCOL_PREFIX,
  VERB_AUTH,
  VERB_OPEN,
  HOME_ROUTE,
  WORKSPACE_HOME_PAGE,
  WORKSPACE_PAGES,
  MAX_TARGET_CHARS,
  parseDeepLink,
  pathSegments,
  webPathToRoute,
} = targetModule;

/** A canonical `{slug}-{publicId}` workspace segment. */
const SEG = "acme-a1b2c3d4e5f6";

// ── The scheme ───────────────────────────────────────────────────────────────

test("the prefix is the scheme main/config.js registers (the drift alarm)", () => {
  // `app.setAsDefaultProtocolClient(PROTOCOL)` and this prefix must name the
  // same scheme or every link this module admits is one the OS never delivers.
  const config = require(join(HERE, "..", "main", "config.js"));
  assert.equal(PROTOCOL_PREFIX, `${config.PROTOCOL}://`);
});

// ── parseDeepLink: which verb ────────────────────────────────────────────────

test("a non-dopl URL is not a deep link at all", () => {
  for (const url of [
    "https://www.usedopl.com/canvas",
    "doplx://open",
    "dopl:/open",
    "",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(parseDeepLink(url), null, `${String(url)} must not parse`);
  }
});

test("the auth handoff still parses exactly as it did", () => {
  const parsed = parseDeepLink("dopl://auth#access_token=abc&refresh_token=def");
  assert.equal(parsed.verb, VERB_AUTH);
  assert.equal(parsed.fragment, "access_token=abc&refresh_token=def");
  assert.equal(parsed.target, null);
});

test("a query-string handoff is read the same way a fragment one is", () => {
  // The pre-existing behaviour: hash first, else the search string.
  const parsed = parseDeepLink("dopl://auth?access_token=abc");
  assert.equal(parsed.verb, VERB_AUTH);
  assert.equal(parsed.fragment, "access_token=abc");
});

test("ANY unknown verb is the auth handoff, not a new one", () => {
  // Builds already in the field send dopl://auth, and the URL a browser
  // assembles is not always the one that was written. `open` opts IN; the
  // fallback stays the verb that shipped first.
  for (const url of ["dopl://#access_token=abc", "dopl://something#access_token=abc"]) {
    assert.equal(parseDeepLink(url).verb, VERB_AUTH);
    assert.equal(parseDeepLink(url).fragment, "access_token=abc");
  }
});

test("a fragment survives a URL this runtime cannot parse", () => {
  // The tolerance the old inline handler had, preserved: dropping a real
  // sign-in over a parser disagreement is the one failure worth avoiding.
  const parsed = parseDeepLink("dopl://[#access_token=abc");
  assert.equal(parsed.verb, VERB_AUTH);
  assert.equal(parsed.fragment, "access_token=abc");
});

// ── parseDeepLink: the open verb ─────────────────────────────────────────────

test("a bare dopl://open carries no target", () => {
  for (const url of ["dopl://open", "dopl://open/", "dopl://OPEN"]) {
    const parsed = parseDeepLink(url);
    assert.equal(parsed.verb, VERB_OPEN, url);
    assert.ok(parsed.target === null || parsed.target === "/", url);
    assert.equal(webPathToRoute(parsed.target), HOME_ROUTE, url);
  }
});

test("dopl://open/{segment}/{page} carries the path as the target", () => {
  const parsed = parseDeepLink(`dopl://open/${SEG}/channels`);
  assert.equal(parsed.verb, VERB_OPEN);
  assert.equal(parsed.target, `/${SEG}/channels`);
  assert.equal(webPathToRoute(parsed.target), `/${SEG}/channels`);
});

test("?target= carries an encoded web path, and wins over the path", () => {
  // The form a web page builds from its own location.pathname.
  const parsed = parseDeepLink(
    `dopl://open/ignored?target=${encodeURIComponent(`/${SEG}/knowledge/runbooks`)}`
  );
  assert.equal(parsed.target, `/${SEG}/knowledge/runbooks`);
  assert.equal(webPathToRoute(parsed.target), `/${SEG}/knowledge/runbooks`);
});

test("a blank ?target= falls back to the path rather than to nothing", () => {
  assert.equal(parseDeepLink(`dopl://open/${SEG}?target=`).target, `/${SEG}`);
  assert.equal(parseDeepLink(`dopl://open/${SEG}?target=%20`).target, `/${SEG}`);
});

test("the path arrives AS WRITTEN, not as `URL` normalized it", () => {
  // `parsed.pathname` resolves dot segments away — `dopl://open/{seg}/../../etc`
  // reads back as `/etc` — which silently disarms the refusal in the map below,
  // because by then there is nothing left to refuse. Caught by running the
  // dispatcher: every unit case passed, because each was handed a raw string.
  assert.equal(parseDeepLink(`dopl://open/${SEG}/../../etc`).target, `/${SEG}/../../etc`);
  assert.equal(parseDeepLink(`dopl://open/${SEG}/../../etc`).verb, VERB_OPEN);
});

// The two halves are only ever used together, and the bug above lived exactly
// in the seam between them — so the seam gets its own table.
const END_TO_END = [
  ["dopl://open", HOME_ROUTE],
  [`dopl://open/${SEG}`, `/${SEG}/${WORKSPACE_HOME_PAGE}`],
  [`dopl://open/${SEG}/channels`, `/${SEG}/channels`],
  [`dopl://open/${SEG}/knowledge/runbooks`, `/${SEG}/knowledge/runbooks`],
  [`dopl://open?target=${encodeURIComponent(`/${SEG}/settings`)}`, `/${SEG}/settings`],
  [`dopl://open?target=${encodeURIComponent("https://evil.example")}`, null],
  [`dopl://open/${SEG}/../../etc`, null],
  ["dopl://open/../secrets", null],
  ["dopl://open//evil.example", null],
  ["dopl://open/%2e%2e/secrets", null],
  ["dopl://open/canvas", HOME_ROUTE],
  ["dopl://open/onboarding", "/onboarding"],
];

for (const [url, expected] of END_TO_END) {
  test(`${url} opens ${expected === null ? "home (refused)" : expected}`, () => {
    const parsed = parseDeepLink(url);
    assert.equal(parsed.verb, VERB_OPEN);
    assert.equal(webPathToRoute(parsed.target), expected);
  });
}

// ── The map: what a link resolves to ─────────────────────────────────────────

const MAPPINGS = [
  // [what the link says, where the app opens, why]
  [null, HOME_ROUTE, "no target at all"],
  ["", HOME_ROUTE, "an empty target"],
  ["/", HOME_ROUTE, "the web root"],
  ["/canvas", HOME_ROUTE, "the web's workspace-less landing — the SPA resolves it at /"],
  ["/login", HOME_ROUTE, "a retired web page"],
  ["/pricing", HOME_ROUTE, "a retired web page"],
  ["/terms", HOME_ROUTE, "a KEEP web page with no SPA route"],
  ["/admin/health", HOME_ROUTE, "an admin page the SPA does not carry"],
  ["/onboarding", "/onboarding", "an SPA route outside /:workspaceSegment"],
  [`/${SEG}`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "the workspace index redirect"],
  [`/${SEG}/`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "the same, with a trailing slash"],
  [`/${SEG}/canvas`, `/${SEG}/canvas`, "the canonical canvas bookmark"],
  [`/${SEG}/channels`, `/${SEG}/channels`, "a page"],
  [`/${SEG}/configuration`, `/${SEG}/configuration`, "the longest page name"],
  [`/${SEG}/ontology/leads`, `/${SEG}/ontology/leads`, "a :param detail route"],
  [`/${SEG}/skills/outreach`, `/${SEG}/skills/outreach`, "another detail route"],
  [`/${SEG}/canvas?billing=upgrade`, `/${SEG}/canvas`, "a query the plan retires, dropped"],
  [`/${SEG}/canvas#anchor`, `/${SEG}/canvas`, "a fragment, dropped"],
  [`/${SEG}/knowledge/kb/entry/deeper`, `/${SEG}/knowledge/kb`, "deeper than any route goes"],
  [`/${SEG}/chats/whatever`, `/${SEG}/chats`, "a page with no detail child"],
  [`/${SEG}/nonsense`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "unknown page, real workspace"],
  ["/legacyslug/skills", "/legacyslug/skills", "a legacy slug-only segment still resolves"],
];

for (const [target, expected, why] of MAPPINGS) {
  test(`${JSON.stringify(target)} → ${expected} (${why})`, () => {
    assert.equal(webPathToRoute(target), expected);
  });
}

// ── The map: what it REFUSES ─────────────────────────────────────────────────

const REFUSED = [
  ["https://evil.example/x", "an absolute URL"],
  ["http://evil.example", "an absolute URL, other scheme"],
  ["//evil.example/x", "protocol-relative"],
  ["/\\evil.example", "the backslash some parsers read as protocol-relative"],
  ["/a\\b", "a backslash anywhere"],
  ["../secrets", "a relative traversal"],
  ["/../secrets", "an absolute traversal"],
  [`/${SEG}/../../etc`, "a traversal buried mid-path"],
  ["/%2e%2e/secrets", "an encoded traversal"],
  ["/seg/%2Fchannels", "an encoded separator"],
  ["/seg/pa ge", "whitespace in a segment"],
  ["/seg/%", "a lone percent"],
  ["/seg/pa:ge", "a colon in a segment"],
  ["/seg/pa@ge", "an at-sign in a segment"],
  ["/seg /x", "a NUL byte"],
  ["/seg\n/x", "a newline"],
  ["canvas", "no leading slash"],
  [`/${"a".repeat(MAX_TARGET_CHARS + 1)}`, "longer than any real canvas URL"],
  [`/${SEG}/${"b".repeat(200)}`, "a segment longer than the cap"],
  [42, "not a string"],
  [{}, "not a string"],
];

for (const [target, why] of REFUSED) {
  test(`refuses ${JSON.stringify(String(target))} (${why})`, () => {
    assert.equal(webPathToRoute(target), null);
  });
}

test("nothing it returns can leave the app", () => {
  // The invariant, restated as a property over every case above: a route is
  // either exactly `/` or a `/`-rooted path of plain segments. Never `//…`,
  // never a scheme, never a traversal.
  for (const [target] of [...MAPPINGS, ...REFUSED]) {
    const route = webPathToRoute(target);
    if (route === null) continue;
    assert.ok(route.startsWith("/"), `${route} must be rooted`);
    assert.ok(!route.startsWith("//"), `${route} must not be protocol-relative`);
    assert.ok(!route.includes(":"), `${route} must carry no scheme`);
    assert.ok(!route.includes(".."), `${route} must carry no traversal`);
    assert.ok(!/\s/.test(route), `${route} must carry no whitespace`);
  }
});

test("it never throws, whatever it is handed", () => {
  const junk = [
    undefined, null, 0, -1, NaN, true, false, [], {}, () => {}, Symbol.iterator.toString(),
    "/".repeat(1000), "\uD800", "/%E0%A4%A", "/seg/" + "�",
  ];
  for (const value of junk) {
    assert.doesNotThrow(() => webPathToRoute(value), `threw on ${String(value)}`);
    assert.doesNotThrow(() => pathSegments(value), `threw on ${String(value)}`);
  }
});

// ── The drift alarm ──────────────────────────────────────────────────────────

test("the page table matches the SPA's route table", () => {
  // Main cannot import the SPA's TypeScript, so WORKSPACE_PAGES is a hand copy.
  // A page ported into the SPA and not added there is a page no deep link can
  // reach, with nothing to say so — read the real table and compare.
  const routesSrc = readFileSync(
    join(HERE, "..", "..", "apps", "desktop-ui", "src", "routes.tsx"),
    "utf8"
  );
  const block = routesSrc.slice(
    routesSrc.indexOf("export const WORKSPACE_PAGES"),
    routesSrc.indexOf("export const WORKSPACE_HOME_PATH")
  );
  assert.ok(block.length > 0, "could not find WORKSPACE_PAGES in routes.tsx");

  const spa = new Map();
  for (const m of block.matchAll(/path:\s*"([^"]+)"/g)) {
    const [page, param] = m[1].split("/");
    // A row is either the page itself or its `:param` detail child.
    spa.set(page, spa.get(page) || (param !== undefined && param.startsWith(":")));
  }

  assert.deepEqual(
    Object.fromEntries([...spa.entries()].sort()),
    Object.fromEntries(Object.entries(WORKSPACE_PAGES).sort()),
    "main/deep-link-target.js WORKSPACE_PAGES has drifted from apps/desktop-ui/src/routes.tsx"
  );

  // And the workspace index redirect, which decides where an unknown page lands.
  const home = /export const WORKSPACE_HOME_PATH = "([^"]+)"/.exec(routesSrc);
  assert.equal(home && home[1], WORKSPACE_HOME_PAGE);
});
