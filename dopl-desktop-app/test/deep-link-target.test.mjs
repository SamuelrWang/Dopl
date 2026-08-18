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
  isSafeSegment,
  parseDeepLink,
  pathSegments,
  webPathToRoute,
} = targetModule;

/** A channel id as the server hands one over — what Phase 9's third segment is. */
const CHAN = "7f3a9c2e-1b4d-4e8a-9c1f-2d5b6a7c8e90";

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
  [`dopl://open/${SEG}/channels-v2/${CHAN}`, `/${SEG}/channels-v2/${CHAN}`],
  [`dopl://open/${SEG}/../../etc`, null],
  ["dopl://open/../secrets", null],
  ["dopl://open//evil.example", null],
  ["dopl://open/%2e%2e/secrets", null],
  // PHASE 9 ENLARGED THE PROTECTED SURFACE, IT DID NOT EXEMPT IT. `channels-v2`
  // now takes a third segment, so every raw-path attack has a NEW place to be
  // tried — and each must still be refused by the same walk, end to end.
  [`dopl://open/${SEG}/channels-v2/..`, null],
  [`dopl://open/${SEG}/channels-v2/../../etc`, null],
  [`dopl://open/${SEG}/channels-v2/%2e%2e`, null],
  [`dopl://open/${SEG}/channels-v2/%2Fevil`, null],
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
  [`/${SEG}/overview`, `/${SEG}/overview`, "the canonical home bookmark"],
  [`/${SEG}/channels`, `/${SEG}/channels`, "a page"],
  [`/${SEG}/knowledge`, `/${SEG}/knowledge`, "the longest page name"],
  [`/${SEG}/ontology/leads`, `/${SEG}/ontology/leads`, "a :param detail route"],
  [`/${SEG}/skills/outreach`, `/${SEG}/skills/outreach`, "another detail route"],
  [`/${SEG}/overview?billing=upgrade`, `/${SEG}/overview`, "a query the plan retires, dropped"],
  [`/${SEG}/overview#anchor`, `/${SEG}/overview`, "a fragment, dropped"],
  // The retired pages (2026-08-07): an old bookmark is not refused, it just
  // stops being a page — so it lands on the workspace's home page.
  [`/${SEG}/canvas`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "a retired page — the old canvas bookmark"],
  [`/${SEG}/canvas2`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "a retired alias"],
  [`/${SEG}/configuration`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "a retired page"],
  [`/${SEG}/workflows`, `/${SEG}/${WORKSPACE_HOME_PAGE}`, "a retired page"],
  [
    `/${SEG}/workflows/upkeep`,
    `/${SEG}/${WORKSPACE_HOME_PAGE}`,
    "a retired page's detail link — the whole path goes, not just the leaf",
  ],
  // PHASE 9: `channels-v2` grew a `:channelId` child, so its third segment is a
  // route now — and `channels` deliberately did NOT, because the shipping v1
  // page has no detail view to receive one. The pair is the whole point of the
  // table's value meaning "has a `:param` detail child" rather than "exists".
  [`/${SEG}/channels-v2`, `/${SEG}/channels-v2`, "the v2 page itself"],
  [
    `/${SEG}/channels-v2/${CHAN}`,
    `/${SEG}/channels-v2/${CHAN}`,
    "a channel id — the notification's landing route",
  ],
  [
    `/${SEG}/channels-v2/${CHAN}/deeper`,
    `/${SEG}/channels-v2/${CHAN}`,
    "deeper than the route goes — the extra segment is dropped, not refused",
  ],
  [
    `/${SEG}/channels/${CHAN}`,
    `/${SEG}/channels`,
    "the SHIPPING page has no detail child, so the id is noise and is dropped",
  ],
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
  // The same refusals, one segment deeper — the surface Phase 9 opened.
  [`/${SEG}/channels-v2/..`, "a traversal where a channel id goes"],
  [`/${SEG}/channels-v2/%2e%2e`, "…encoded, which is why decoding comes first"],
  [`/${SEG}/channels-v2/%2Fevil.example`, "an encoded separator in a channel id"],
  [`/${SEG}/channels-v2/a b`, "whitespace in a channel id"],
  [`/${SEG}/channels-v2/a:b`, "a colon in a channel id"],
  [`/${SEG}/channels-v2/${"c".repeat(200)}`, "a channel id longer than the cap"],
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

// ── The web producer ─────────────────────────────────────────────────────────

test("the WEB's workspace handoff link resolves to that workspace", () => {
  // `/join/{token}` and `/invite/{token}` survive the website retirement, and
  // what they hand a new member is `dopl://open/{segment}` — built by
  // `src/features/workspaces/url.ts › workspaceDeepLink`, on the other side of
  // a process boundary that nothing type-checks. So the producer's literal is
  // READ, not assumed, and run through this parser: a change to either half
  // that the other does not follow fails here rather than in someone's browser.
  const urlSrc = readFileSync(
    join(HERE, "..", "..", "src", "features", "workspaces", "url.ts"),
    "utf8"
  );
  const scheme = /const DESKTOP_SCHEME = "([^"]+)"/.exec(urlSrc);
  assert.ok(scheme, "could not find DESKTOP_SCHEME in url.ts");
  assert.equal(`${scheme[1]}://`, PROTOCOL_PREFIX);

  // The two shapes that module emits, reproduced from its own template.
  const verb = /return `\$\{DESKTOP_SCHEME\}:\/\/(\w+)`/.exec(urlSrc);
  const path = /return `\$\{DESKTOP_SCHEME\}:\/\/(\w+)\/\$\{workspaceSegment\(ws\)\}`/.exec(
    urlSrc
  );
  assert.ok(verb && path, "workspaceDeepLink no longer builds the links this test knows");
  assert.equal(verb[1], VERB_OPEN, "the degraded link must still be the open verb");
  assert.equal(path[1], VERB_OPEN);

  const link = `${PROTOCOL_PREFIX}${path[1]}/${SEG}`;
  const parsed = parseDeepLink(link);
  assert.equal(parsed.verb, VERB_OPEN);
  assert.equal(
    webPathToRoute(parsed.target),
    `/${SEG}/${WORKSPACE_HOME_PAGE}`,
    `${link} must open the workspace, not home`
  );

  // The workspace-less degradation: a workspace the server could not read back
  // still opens the app rather than resolving to a malformed path.
  const bare = parseDeepLink(`${PROTOCOL_PREFIX}${verb[1]}`);
  assert.equal(bare.verb, VERB_OPEN);
  assert.equal(webPathToRoute(bare.target), HOME_ROUTE);
});

test("`join` and `invite` stay WEB-ONLY — the workspace crosses, never the invite URL", () => {
  // The handoff deliberately does not teach the grammar about invite tokens: a
  // token is a WEB credential, spent by a browser against a Next route, and the
  // app has no way to redeem one. Both roots must keep resolving home.
  assert.ok(targetModule.WEB_ONLY_ROOTS.has("join"));
  assert.ok(targetModule.WEB_ONLY_ROOTS.has("invite"));
  assert.equal(webPathToRoute(`/join/${"a".repeat(64)}`), HOME_ROUTE);
  assert.equal(webPathToRoute("/invite/some-token"), HOME_ROUTE);
});

// ── The segment rule, as a shared export (Phase 9) ───────────────────────────

test("isSafeSegment IS the rule pathSegments applies — one answer, two callers", () => {
  // `main/shell-mode.js › navigateToChannels` builds `/{seg}/{page}/{channelId}`
  // from a SERVER DTO's channel id. That is not a deep link, but it is the same
  // question, and the point of exporting this is that there is no second regex
  // over there to drift from this one. So: whatever this admits, the walk must
  // admit, and whatever it refuses, the walk must refuse.
  for (const good of [SEG, CHAN, "channels-v2", "a", "A1._-", "legacyslug"]) {
    assert.equal(isSafeSegment(good), true, `${good} must be usable`);
    assert.deepEqual(pathSegments(`/${good}`), [good]);
  }
  for (const bad of [
    "..", ".", "", "-lead", "a/b", "a b", "a:b", "a%b", "a\\b", "a@b",
    "d".repeat(129), null, undefined, 42, {}, ["a"],
  ]) {
    assert.equal(isSafeSegment(bad), false, `${JSON.stringify(bad)} must be refused`);
  }
});

test("the detail flag is per PAGE, and channels-v2 is the one that has a child", () => {
  // The value means "this page has a `:param` detail child", never "this page
  // exists" — mixing those up is how a third segment becomes a route that
  // matches nothing. Phase 9 flipped exactly one of these; Phase 12 swaps them.
  assert.equal(WORKSPACE_PAGES['channels-v2'], true, "the v2 page took the :channelId row");
  assert.equal(WORKSPACE_PAGES.channels, false, "the shipping v1 page has no detail view");
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
