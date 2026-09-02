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
 *      a dumb comment-stripped text sweep, because the parser is the thing that
 *      was wrong before.
 *   C. NO route in the `withUserAuth` + `resolveApiWorkspace` family opts below
 *      `viewer`.
 *   D. THE PARSER ITSELF is pinned against hand-measured floors and against the
 *      export shapes it must not read as ABSENT.
 *
 * ⚠ THE PARSER MOVED OUT ON 2026-08-26 — it is `shared/auth/route-floor-parser.ts`,
 * beside the `withWorkspaceAuth` it parses. This file hit the 500-line cap (§1)
 * while the parser was growing the branches set D now pins, and a file that
 * cannot be corrected is worse than one that is an import away. No route imports
 * the parser; its only consumer is this suite.
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
 * Breaking the parser fails set D. 19 entries.
 * MEASURED 2026-08-26 — 4 reverts, 4 failures, 0 vacuous: parser loses the
 * re-export branch (4 red); loses the function-declaration branch (1 red); stops
 * stripping comments (1 red); B2 back to comparing FILE NAMES while a SECOND
 * guest floor is added to an already-listed file (`…/members/route.ts` POST) —
 * the count sweep goes red, and the old file-name sweep stayed GREEN on that
 * exact tree (12 files either way), which is the gap it closed.
 * RE-MEASURED 2026-08-26 for the four KNOWLEDGE-LANE additions — 4 reverts,
 * 4 failures, 0 vacuous (49 tests baseline):
 *   - raise `…/knowledge/bases` GET back to the viewer default   : 3 red (A, B, B2)
 *   - raise the entry PUT alone, its GET left at `guest`         : 3 red (A, B, B2)
 *     ⚠ THIS IS THE ONE B2's COUNT EXISTS FOR: the file stays on the sweep
 *     either way, and only the per-METHOD occurrence count notices.
 *   - drop `membership !== null` from the lane helper            : 1 red
 *   - a lane route naming `loadVisibleChannel` itself            : 1 red
 *     (a second, hand-rolled copy of the fence — the copy is what drifts)
 *
 * ⚠ EIGHTEEN OF THE NINETEEN ARE CHANNEL ROUTES; THE NINETEENTH IS A METER
 * (2026-08-26). `mcp/credits/consume` sits at `guest` so a guest's tool calls
 * are BILLED — the registrar fails open on the 403 the `viewer` default
 * produced, so that floor made guest traffic free rather than refusing it
 * (F-325). It grants no data and no write; the entry lives here because this
 * file's contract is "nothing anywhere is at `guest` unless it is listed", and
 * that contract is worth more than the list staying channel-only.
 *
 * ⚠ FOUR OF THE EIGHTEEN ARE NOT CHANNEL CONTENT AT ALL (Home Knowledge Panels
 * M2, 2026-08-26). `…/[channelId]/knowledge/**` serves KNOWLEDGE through a
 * channel-scoped door, and it is the first time a guest floor sits in front of
 * a payload the channel does not own. The floor is worth even less here than
 * elsewhere: what admits the caller is a `(knowledge_base, channel)` grant row
 * at `visible`, and the membership fence in front of it is REQUIRED rather than
 * inherited — see the last describe in this file, and INVARIANTS §4A.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLOOR,
  DYNAMIC,
  METHODS,
  UNPARSED,
  stripComments,
  workspaceFloor,
} from "@/shared/auth/route-floor-parser";

const API_ROOT = join(import.meta.dirname, "..");
const CHANNELS_REL = "channels";

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
  // ⚠ THE KNOWLEDGE LANE (Home Knowledge Panels M2, 2026-08-26; plan §3, and
  // §4A's "a guest reaches knowledge ONLY through a (kb, channel) grant at
  // `visible`"). FOUR pairs across THREE files, and the first guest floors in
  // this codebase in front of a payload the channel does not own.
  //
  // These four are the ONLY way a guest reaches a knowledge base at all. Every
  // route under `/api/knowledge/**` stays at the `viewer` default and therefore
  // still refuses one — `defaultLevelForRole("guest")` is `null`, so even a
  // lowered floor there would 404 in `requireEffectiveAccess`. The lane exists
  // BECAUSE that is true: it carries its own gates
  // (`knowledge/server/service-channel-grants.ts › assertGrantVisible` /
  // `assertGrantWritable`) and reuses none of the workspace ones.
  //
  // ⚠ THE FLOOR IS THE WEAKEST OF FOUR FENCES HERE, not the gate. In order:
  // this floor → `loadVisibleChannel` with membership REQUIRED (the public arm
  // is refused outright, or a workspace viewer who never joined the channel
  // would read the operator's granted bases) → the grant row at `visible`
  // (`agent_only` is a 404, always — a different audience, and its existence
  // must not leak) → base alive and same workspace.
  [`${CHANNELS_REL}/[channelId]/knowledge/bases/route.ts`, "GET"], // bases granted into this channel
  [`${CHANNELS_REL}/[channelId]/knowledge/bases/[baseId]/tree/route.ts`, "GET"], // folders + entry metadata of ONE granted base
  [`${CHANNELS_REL}/[channelId]/knowledge/entries/[entryId]/route.ts`, "GET"], // one entry's body
  // ⚠ THE ONLY GUEST *WRITE* ON THIS LIST OUTSIDE THE CHANNEL'S OWN TRANSCRIPT,
  // and it is gated on a per-grant `guest_write` flag that defaults OFF (§3.4).
  // Title and body only; no create, no move, no delete. `agent_write_enabled` is
  // not consulted because the service refuses an agent token here outright.
  [`${CHANNELS_REL}/[channelId]/knowledge/entries/[entryId]/route.ts`, "PUT"], // edit one entry (guest_write)
  // ⚠ THE ONE NON-CHANNEL ENTRY, AND IT IS A METER RATHER THAN A CAPABILITY
  // (2026-08-26, Samuel: "charge MCP calls from a guest to the user"; closes
  // F-325). At the `viewer` default this 403'd every guest-scoped consume call,
  // and `packages/mcp-server/src/registrar.ts › charge` fails OPEN on a throw —
  // so the floor was not refusing guest traffic, it was making it FREE. The only
  // thing a successful call does is put a credit on somebody's counter, and
  // `billing/server/credits-service.ts › resolveBillingTarget` sends a
  // container's burn to the container's OWNER. Raising it back re-opens the free
  // lane; it closes nothing.
  ["mcp/credits/consume/route.ts", "POST"],
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
  it("has 19 entries (pins the size against a silent add/drop)", () => {
    // 15 until Home Knowledge Panels M2 (2026-08-26) added the four
    // `…/[channelId]/knowledge/**` pairs. ⚠ ENTRIES, NOT FILES: FOUR files carry
    // two guest-floored methods each (`messages` GET+POST, `tasks` GET+POST,
    // `mentions` GET+POST, and now `knowledge/entries` GET+PUT), so 19 entries
    // live in 15 files — which is exactly why B2 counts occurrences rather than
    // comparing file names. Re-derive both, never quote:
    //   grep -rc 'minRole: "guest"' $(grep -rl 'minRole: "guest"' src/app/api)
    expect(ALLOWED_KEYS.size).toBe(19);
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

  it("B2: a DUMB text sweep counts one guest floor per allowed METHOD, per file", () => {
    // ⚠ THE BELT FOR THE PARSER ITSELF. Set B is only as good as `workspaceFloor`,
    // and `workspaceFloor` is exactly what was broken. This half needs no parser.
    //
    // ⚠ IT COMPARED FILE NAMES UNTIL 2026-08-26, AND THAT LEFT A HOLE THE SAME
    // SIZE AS THE PARSER'S: a SECOND method given a guest floor in a file the
    // set ALREADY names was invisible to it — the file was expected, so an extra
    // floor inside it changed nothing. Counting the occurrences is the cheapest
    // thing a parser-free sweep can do that has the (file, METHOD) dimension:
    // one floored method spells the floor once.
    //
    // ⚠ AND IT WAS COMMENT-BLIND: `channels/route.ts`'s own docblock contains
    // the literal `minRole: "guest"`, so prose counted as a floor. Stripped now.
    const swept = SOURCES.map(
      ([rel, src]) =>
        [rel, (stripComments(src).match(/minRole:\s*"guest"/g) ?? []).length] as const
    )
      .filter(([, n]) => n > 0)
      .sort(([a], [b]) => a.localeCompare(b));

    const counts = new Map<string, number>();
    for (const [file] of GUEST_ALLOWED) {
      counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    const expected = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));

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

  it("a MIXED-wrapper file reads each method's OWN wrapper (2026-08-26)", () => {
    // `auth/mcp-container-token/route.ts` is the tree's only one: POST resolves
    // a workspace, DELETE must survive that workspace being deleted, so the two
    // methods take different wrappers. Before this, DELETE answered `<unparsed>`
    // because the FILE contained `withWorkspaceAuth` somewhere.
    // ⚠ The `null` half is the load-bearing one, and it is safe for exactly one
    // reason: a `withUserAuth` method has no workspace floor to place at guest.
    const src = `
      import { withUserAuth } from "@/shared/auth/with-auth";
      import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
      export const POST = withWorkspaceAuth(async () => {}, { minRole: "admin" });
      export const DELETE = withUserAuth(async () => {}, { sessionOnly: true });
    `;
    expect(workspaceFloor(src, "POST")).toBe("admin");
    expect(workspaceFloor(src, "DELETE")).toBeNull();
  });

  // ⚠ SYNTHETIC ON PURPOSE: none of these shapes exists in `src/app/api` today
  // (AST-verified 2026-08-26), which is why real sources cannot pin them — and
  // is how the gap survived.
  const WRAPPER = `import { withWorkspaceAuth } from "@/shared/auth/with-auth";`;

  it.each([
    // [label, source, method, expected]
    [
      "export { h as GET } follows the alias to the binding's floor",
      `${WRAPPER}
       const handleGet = withWorkspaceAuth(async () => null, { minRole: "guest" });
       export { handleGet as GET };`,
      "GET",
      "guest",
    ],
    [
      "…and to a floor ABOVE the default just the same",
      `${WRAPPER}
       const handlePost = withWorkspaceAuth(async () => null, { minRole: "admin" });
       export { handlePost as POST };`,
      "POST",
      "admin",
    ],
    [
      "a followed re-export with no options is the wrapper DEFAULT, not absent",
      `${WRAPPER}
       const h = withWorkspaceAuth(async () => null);
       export { h as PATCH };`,
      "PATCH",
      DEFAULT_FLOOR,
    ],
    [
      "a re-export from ANOTHER module is <unparsed>, never null",
      `${WRAPPER}
       export { GET } from "./elsewhere";`,
      "GET",
      UNPARSED,
    ],
    [
      "an exported FUNCTION DECLARATION is <unparsed>, never null",
      `${WRAPPER}
       const inner = withWorkspaceAuth(async () => null, { minRole: "guest" });
       export async function GET(req: Request) { return inner(req); }`,
      "GET",
      UNPARSED,
    ],
    [
      "a floor that appears only in a COMMENT is not a floor, even INSIDE the options object",
      // ⚠ The comment sits AFTER the real key, so `minRoleIn`'s `lastIndexOf`
      // lands on the prose — this is the case a comment-blind parser reads as
      // `guest`. `channels/route.ts`'s own docblock is the real-world version.
      `${WRAPPER}
       export const POST = withWorkspaceAuth(async () => null, {
         minRole: "member",
         // TODO(2026-08-26): consider minRole: "guest" — see §4A.
       });`,
      "POST",
      "member",
    ],
  ])("%s", (_label, src, method, expected) => {
    expect(workspaceFloor(src, method)).toBe(expected);
  });

  it("a method nobody exports still has no floor, whatever the file contains", () => {
    const src = `${WRAPPER}
      const handleGet = withWorkspaceAuth(async () => null, { minRole: "guest" });
      export { handleGet as GET };`;
    expect(workspaceFloor(src, "DELETE")).toBeNull();
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
    const fanout = readFileSync(join(featureRoot, "service-tasks-broadcast.ts"), "utf8");
    expect(writes).toMatch(/loadVisibleChannel/);
    expect(writes).toMatch(/ChannelForbiddenError\("post to this channel"\)/);
    expect(fanout).toMatch(/loadVisibleChannel/);
    expect(fanout).toMatch(/ChannelForbiddenError\("create a task in this channel"\)/);
  });

  it("the KNOWLEDGE lane REQUIRES a membership row, rather than inheriting the public arm", () => {
    // 🔒 THE LINE THE PLAN NAMED AS THE ONE THAT WILL REGRESS (§3.2 fence 2).
    // `loadVisibleChannel` RETURNS SUCCESSFULLY with `membership: null` on the
    // `visibility='public'` arm. A guest does not reach that arm
    // (`mayReadPublicChannels`), but a workspace VIEWER does — and F-327 says a
    // public channel can exist inside a container. Without this line such a
    // viewer, who never joined the channel, would read every knowledge base
    // granted into it.
    //
    // ⚠ SOURCE, not behaviour, and deliberately so: the behavioural proof lives
    // in `…/knowledge/grant-lane.test.ts`, which drives the real fence. This is
    // the four-floor list's own belt — the floors above are only safe because
    // this line exists, so it is asserted where the floors are.
    const helper = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "shared", "api", "channel-knowledge-lane.ts"),
      "utf8"
    );
    expect(helper).toMatch(/loadVisibleChannel/);
    expect(helper).toMatch(/if \(membership === null\) throw channelNotFound\(ref\);/);
  });

  it("all four knowledge-lane routes go through that ONE helper (no hand-rolled second fence)", () => {
    // A route that resolved the channel itself would be a fourth copy of the
    // fence, and the copy is what drifts. Every lane route imports the helper
    // and none of them names `loadVisibleChannel`.
    const laneRoutes = GUEST_ALLOWED.filter(([f]) => f.includes("/knowledge/")).map(
      ([f]) => f
    );
    expect(new Set(laneRoutes).size).toBe(3);
    for (const rel of new Set(laneRoutes)) {
      const src = stripComments(readFileSync(join(API_ROOT, rel), "utf8"));
      expect(src, rel).toMatch(/requireChannelKnowledgeContext\(auth\)/);
      expect(src, rel).not.toMatch(/loadVisibleChannel/);
    }
  });
});
