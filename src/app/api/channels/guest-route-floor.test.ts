/**
 * THE GUEST ROUTE-FLOOR PIN (guest-role M1, INVARIANTS §4A / §2B).
 *
 * A `guest` is the FLOOR role (rank 0, below `viewer`), and BOTH workspace-auth
 * families default to `viewer` — so EVERY workspace-scoped route rejects a guest
 * UNLESS it explicitly opts down. The blast radius is inverted: the danger is
 * not that too much is closed, it is that a route silently drifts to `guest`
 * (over-open) or that one the guest web lane needs silently loses its floor (a
 * UX break with no error).
 *
 * ⚠ THERE ARE **TWO** WRAPPER FAMILIES AND THIS FILE SCANS BOTH (2026-08-26).
 * §4A used to rest the whole story on `withWorkspaceAuth`'s default, which
 * covers one of them. The other is `withUserAuth` + `segment.ts ›
 * resolveApiWorkspace` / `resolveApiWorkspaceAccess`, which proved membership
 * EXISTENCE and never compared the role — so a guest reached the full member
 * roster (emails included), both overview reads, the workspace record and
 * `my-access`, every one of which §4A named as rejecting guests. That resolver
 * now carries the same inverted `viewer` default, and **set C** below is what
 * stops the next route added there from admitting a guest in silence.
 *
 * This converts all of it into a red test by READING THE ROUTE SOURCE (the same
 * technique as `workspaces/server/link-container-guard.test.ts` — a mock could
 * not tell a floor apart):
 *
 *   A. Every route in the guest-allowed set is at `minRole: "guest"`.
 *   B. NO route anywhere under `src/app/api` is at `minRole: "guest"` unless it
 *      is in that set — checked TWICE, once through the parser and once through
 *      a dumb whole-file text sweep, because the parser is the thing that was
 *      wrong before.
 *   C. NO route in the `withUserAuth` + `resolveApiWorkspace` family opts below
 *      `viewer`.
 *   D. THE PARSER ITSELF is pinned against eight hand-measured floors.
 *
 * ⚠ THE WORKSPACE FLOOR IS A TRIPWIRE, NOT THE TRUE GATE. The real gate on each
 * of these is the channel-membership fence in the service layer
 * (`loadVisibleChannel` hides a private channel from a non-member — and since
 * 2026-08-26 hides a PUBLIC one from a guest too, `service-shared.ts ›
 * mayReadPublicChannels`; `postMessage` / `createTaskFanOut` refuse
 * `!membership`). This pin guards the tripwire; the fence tests guard the gate.
 * Do not weaken either.
 *
 * ⚠ MUTATION-VERIFY. Reverting any single floor edit (drop the `{ minRole:
 * "guest" }` off an allowed GET, or raise an allowed POST back to `"member"`)
 * removes it from the discovered set → set A fails on that entry AND set B's
 * equality fails. Adding `guest` to any other route fails set B (both halves).
 * Breaking the parser fails set D. 14 entries.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const API_ROOT = join(import.meta.dirname, "..");
const CHANNELS_REL = "channels";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The wrapper default, shared by both families. */
const DEFAULT_FLOOR = "viewer";
/** `minRole` is present but is not a string LITERAL — never silently "viewer". */
const DYNAMIC = "<dynamic>";
/** The method is exported and the file uses the wrapper, but the assignment did
 *  not parse — never silently "not wrapped". */
const UNPARSED = "<unparsed>";

/**
 * ⚠ THE PARENTHESIS SCANNER, AND IT REPLACED A `src.indexOf(");")` (2026-08-26).
 *
 * The old parser sliced the wrapper's arguments at the FIRST `");"` in the file
 * after the call. That is correct only for the `withWorkspaceAuth(handleGet, {…})`
 * shape; for the INLINE-ARROW shape — `withWorkspaceAuth(async (req, ctx) => {
 * … }, { minRole })` — the first `");"` lands inside the handler BODY, on the
 * first `NextResponse.json(…);` or `requireChannelId(auth.params);` it contains,
 * so the options object was never in the slice and every such route parsed as
 * the `viewer` default.
 *
 * ⚠ MEASURED, NOT THEORISED: EIGHT (route, method) pairs disagreed on
 * 2026-08-26 — the six billing routes (actual `admin`) and the two skills POSTs
 * (actual `member`) — all of which the old parser read as `viewer`. The
 * consequence was not cosmetic: setting `billing/invoices` to `minRole:"guest"`
 * left BOTH set A and set B GREEN, i.e. a guest could have been given the
 * operator's Stripe invoice history with this suite passing. Set D pins those
 * eight so a future parser bug is caught by DATA rather than by luck.
 *
 * It skips string literals, template literals and comments, because parens
 * inside `ChannelForbiddenError("post to this channel")` are not structure.
 * A run that reaches EOF without closing THROWS — a parse failure must be loud.
 */
function balancedArgs(src: string, from: number): string {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") i += 2;
        else if (src[i] === quote) break;
        else i += 1;
      }
      i += 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return src.slice(from, i);
    }
    i += 1;
  }
  throw new Error("unbalanced wrapper call — the route source did not parse");
}

/** Read a `minRole` out of a wrapper's argument text. */
function minRoleIn(args: string): string {
  // Take the LAST occurrence: the options object is the trailing argument, and
  // a handler body that happens to contain the word would come first.
  const idx = args.lastIndexOf("minRole");
  if (idx === -1) return DEFAULT_FLOOR;
  const tail = args.slice(idx);
  const literal = /^minRole\s*:\s*"(\w+)"/.exec(tail);
  if (literal) return literal[1];
  // ⚠ `{ minRole }` shorthand, `minRole: SOME_CONST`, a ternary — anything the
  // parser cannot READ is reported as such. The old parser's `minRole:\s*"(\w+)"`
  // simply failed to match and fell through to "viewer", which is the same class
  // of silent wrong answer the `");"` slice produced.
  return DYNAMIC;
}

/**
 * The effective workspace `minRole` a `withWorkspaceAuth`-wrapped method runs
 * at: the explicit `minRole: "X"` in its options object, or `"viewer"` (the
 * wrapper default) when none is given. `null` = the method is not exported here,
 * or is not wrapped by `withWorkspaceAuth` (e.g. a `withUserAuth` route) — such
 * a method has no workspace floor to place at `guest`.
 */
export function workspaceFloor(src: string, method: string): string | null {
  const call = new RegExp(
    `export\\s+const\\s+${method}\\s*=\\s*withWorkspaceAuth\\s*\\(`
  ).exec(src);
  if (call) return minRoleIn(balancedArgs(src, call.index + call[0].length));
  // Exported, and this file DOES use the wrapper, but not in the shape above —
  // an assign-then-export, or a local helper composing it. Say so rather than
  // answering `null`, which reads as "no workspace floor here".
  const exported = new RegExp(`export\\s+const\\s+${method}\\s*=`).test(src);
  if (exported && src.includes("withWorkspaceAuth")) return UNPARSED;
  return null;
}

/** Every `route.ts` under `src/app/api`, as paths relative to that root. */
function allRouteFiles(): string[] {
  const out: string[] = [];
  const walk = (relDir: string) => {
    for (const ent of readdirSync(join(API_ROOT, relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(rel);
      else if (ent.name === "route.ts") out.push(rel);
    }
  };
  walk("");
  return out;
}

const SOURCES: ReadonlyArray<readonly [string, string]> = allRouteFiles().map(
  (rel) => [rel, readFileSync(join(API_ROOT, rel), "utf8")] as const
);

/** `"<relpath>#<METHOD>"` for every method placed at `minRole: "guest"`. */
function guestFlooredEverywhere(): Set<string> {
  const found = new Set<string>();
  for (const [rel, src] of SOURCES) {
    for (const method of METHODS) {
      if (workspaceFloor(src, method) === "guest") found.add(`${rel}#${method}`);
    }
  }
  return found;
}

/**
 * THE GUEST-ALLOWED SET (INVARIANTS §4A / §2B + Samuel's Q1/Q2 rulings). Editing
 * this list is a deliberate act — a new channel surface a guest must reach is a
 * conscious addition here AND to §4A, and nowhere else can grant a guest a
 * floor without turning set B red.
 */
const GUEST_ALLOWED: ReadonlyArray<readonly [string, string]> = [
  [`${CHANNELS_REL}/route.ts`, "GET"], // list channels
  [`${CHANNELS_REL}/[channelId]/route.ts`, "GET"], // read one channel
  [`${CHANNELS_REL}/[channelId]/messages/route.ts`, "GET"], // read transcript
  [`${CHANNELS_REL}/[channelId]/messages/route.ts`, "POST"], // post a message (and this is where an @-mention is PARSED — Q2)
  [`${CHANNELS_REL}/[channelId]/await/route.ts`, "GET"], // long-poll one channel
  [`${CHANNELS_REL}/await/route.ts`, "GET"], // long-poll workspace-wide
  [`${CHANNELS_REL}/[channelId]/tasks/route.ts`, "GET"], // list threads
  [`${CHANNELS_REL}/[channelId]/tasks/route.ts`, "POST"], // create a thread (Q1)
  [`${CHANNELS_REL}/[channelId]/tasks/[taskId]/route.ts`, "GET"], // read one thread
  [`${CHANNELS_REL}/[channelId]/members/route.ts`, "GET"], // see the roster
  [`${CHANNELS_REL}/presence/route.ts`, "POST"], // presence heartbeat (Q2)
  // ⚠ THE MENTIONS PAIR, AND THE COMMENT TABLE THAT USED TO SIT HERE HAD IT
  // BACKWARDS (corrected 2026-08-26). It labelled POST "@-mention" and GET
  // "marking a mention read"; the route is the other way round — GET is
  // `listMyChannelMentions`, POST is `markMentionsRead` — and @-mentioning is
  // not this route AT ALL (it is parsed from message text by
  // `service-writes-metadata-mentions.ts`, i.e. delivered by the messages POST
  // above). GET is the addition: `useChannelMentions` mounts for every guest and
  // was 403ing. Both are own-scoped to `ctx.userId` inside the service.
  [`${CHANNELS_REL}/[channelId]/mentions/route.ts`, "GET"], // MY mention inbox
  [`${CHANNELS_REL}/[channelId]/mentions/route.ts`, "POST"], // mark MY mentions read
  // ⚠ PEER AGENT STATE (2026-08-26). `useAgentsPanel` polls this for every host
  // of the per-channel surface, so at the viewer default it was a 403 on a loop
  // for every guest — and seeing that the operator's agent is working is the
  // guest lane's whole proposition. READ ONLY; launching stays closed.
  [`${CHANNELS_REL}/[channelId]/sessions/route.ts`, "GET"],
];

const ALLOWED_KEYS = new Set(GUEST_ALLOWED.map(([f, m]) => `${f}#${m}`));

/**
 * SET D's DATA — floors measured BY HAND against the route sources on
 * 2026-08-26, chosen because every one of them is a shape the previous parser
 * got wrong. Re-measure with `grep -n minRole <file>`; never amend from memory.
 */
const KNOWN_FLOORS: ReadonlyArray<readonly [string, string, string]> = [
  // Inline-arrow + trailing options — the six the `");"` slice misread as viewer.
  ["billing/cancel/route.ts", "POST", "admin"],
  ["billing/checkout/route.ts", "POST", "admin"],
  ["billing/invoices/route.ts", "GET", "admin"],
  ["billing/payment-method/route.ts", "GET", "admin"],
  ["billing/portal/route.ts", "POST", "admin"],
  ["billing/upgrade-to-team/route.ts", "POST", "admin"],
  ["skills/[skillSlug]/duplicate/route.ts", "POST", "member"],
  ["skills/versions/[versionId]/restore/route.ts", "POST", "member"],
  // Named-handler shape (the one the old parser DID read) — kept so a "fix" that
  // breaks the common case is caught too.
  [`${CHANNELS_REL}/[channelId]/route.ts`, "PATCH", "member"],
  [`${CHANNELS_REL}/[channelId]/route.ts`, "GET", "guest"],
  // No options object at all → the wrapper default.
  [`${CHANNELS_REL}/consent/route.ts`, "GET", "viewer"],
];

describe("guest route floor — the guest-allowed set is exactly what runs at minRole:guest", () => {
  it("has 14 entries (pins the size against a silent add/drop)", () => {
    expect(ALLOWED_KEYS.size).toBe(14);
  });

  it.each(GUEST_ALLOWED)("A: %s %s is at minRole:guest", (file, method) => {
    const src = readFileSync(join(API_ROOT, file), "utf8");
    expect(workspaceFloor(src, method)).toBe("guest");
  });

  it("B: no route ANYWHERE under src/app/api is at minRole:guest outside the set", () => {
    const found = guestFlooredEverywhere();
    // Exact equality both directions: nothing extra is at guest, nothing in the
    // set lost its floor.
    expect([...found].sort()).toEqual([...ALLOWED_KEYS].sort());
  });

  it("B2: a DUMB text sweep for minRole:\"guest\" names the same FILES", () => {
    // ⚠ THE BELT FOR THE PARSER ITSELF. Set B is only as good as `workspaceFloor`,
    // and `workspaceFloor` is exactly what was broken. This half needs no parser:
    // any file whose text contains the guest floor must be a file the set names,
    // and every file the set names must contain it.
    const swept = SOURCES.filter(([, src]) => /minRole:\s*"guest"/.test(src))
      .map(([rel]) => rel)
      .sort();
    const expected = [...new Set(GUEST_ALLOWED.map(([f]) => f))].sort();
    expect(swept).toEqual(expected);
  });

  it("B3: no route's floor is unreadable — a shape the parser cannot see is a bug, not a pass", () => {
    // `<dynamic>` = `minRole` present but not a string literal; `<unparsed>` =
    // the wrapper is used but the export shape did not match. Either silently
    // read as `viewer` under the old parser, which is how an `admin` route
    // looked open and a `guest` route could look closed.
    const bad: string[] = [];
    for (const [rel, src] of SOURCES) {
      for (const method of METHODS) {
        const floor = workspaceFloor(src, method);
        if (floor === DYNAMIC || floor === UNPARSED) bad.push(`${rel}#${method} → ${floor}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("D: the parser is pinned against hand-measured floors", () => {
  it.each(KNOWN_FLOORS)("%s %s is %s", (file, method, expected) => {
    const src = readFileSync(join(API_ROOT, file), "utf8");
    expect(workspaceFloor(src, method)).toBe(expected);
  });

  it("the eight inline-arrow floors are NOT viewer (the exact regression)", () => {
    // Stated separately and positively: the old parser answered `viewer` for all
    // eight, so a guest floor on any of them was invisible to sets A and B.
    for (const [file, method, expected] of KNOWN_FLOORS.slice(0, 8)) {
      const src = readFileSync(join(API_ROOT, file), "utf8");
      expect(workspaceFloor(src, method)).not.toBe(DEFAULT_FLOOR);
      expect(workspaceFloor(src, method)).toBe(expected);
    }
  });

  it("an unbalanced wrapper call THROWS rather than answering viewer", () => {
    expect(() =>
      workspaceFloor(`export const GET = withWorkspaceAuth(handleGet`, "GET")
    ).toThrow(/did not parse/);
  });
});

describe("C: the withUserAuth + resolveApiWorkspace family is fail-closed too", () => {
  /** Route files that resolve a workspace through the SECOND family. */
  const FAMILY = SOURCES.filter(([, src]) =>
    /resolveApiWorkspace(Access)?\s*\(/.test(src)
  );

  it("finds the family (a rename that empties this list must not pass silently)", () => {
    // ⚠ MEASURED 2026-08-26: 19 route files. Re-derive, never quote:
    //   grep -rln "resolveApiWorkspace" src/app/api
    expect(FAMILY.length).toBeGreaterThanOrEqual(15);
  });

  it("no route in it opts down to guest", () => {
    // The resolver's default is `viewer` (`segment.ts › ApiWorkspaceOpts`), so a
    // guest is refused unless a route passes `minRole: "guest"` explicitly. The
    // allowlist for this family is EMPTY on purpose — nothing under
    // `/api/workspaces` is a guest surface.
    const optedDown = FAMILY.filter(([, src]) =>
      /resolveApiWorkspace(Access)?\s*\([^)]*minRole:\s*"guest"/.test(src)
    ).map(([rel]) => rel);
    expect(optedDown).toEqual([]);
  });

  it("the resolver itself still HAS the floor (a pin on the fence, not on its callers)", () => {
    // ⚠ §14: a pin on a symbol is not a pin. Every assertion above is about the
    // CALLERS; if the resolver stopped comparing the role they would all still
    // pass while the family re-opened. So read the fence.
    const segment = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "features", "workspaces", "server", "segment.ts"),
      "utf8"
    );
    expect(segment).toMatch(/meetsMinRole\(resolved\.role,\s*opts\.minRole \?\? "viewer"\)/);
  });
});

describe("the floors guard a real gate, not just a list", () => {
  it("the channel writes keep their membership fence", () => {
    // A floor lowered to guest is only safe because the SERVICE refuses a
    // non-member. If these fences ever move, the floor becomes the gate — so pin
    // that the refusal still lives where §2B says it does.
    const featureRoot = join(import.meta.dirname, "..", "..", "..", "features", "channels", "server");
    const writes = readFileSync(join(featureRoot, "service-writes.ts"), "utf8");
    const fanout = readFileSync(join(featureRoot, "service-tasks-fanout.ts"), "utf8");
    expect(writes).toMatch(/loadVisibleChannel/);
    expect(writes).toMatch(/ChannelForbiddenError\("post to this channel"\)/);
    expect(fanout).toMatch(/loadVisibleChannel/);
    expect(fanout).toMatch(/ChannelForbiddenError\("create a task in this channel"\)/);
  });
});
