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
 *      export shapes it must not read as ABSENT. ⚠ **SET D MOVED OUT ON
 *      2026-09-09** — it is `shared/auth/route-floor-parser.test.ts`, beside the
 *      parser it pins, and it is still REQUIRED: a census over a broken parser
 *      is green and empty. Sets A, B, B2, B3 and C are what is left here.
 *
 * ⚠ THE PARSER MOVED OUT ON 2026-08-26 — it is `shared/auth/route-floor-parser.ts`,
 * beside the `withWorkspaceAuth` it parses. This file hit the 500-line cap (§1)
 * while the parser was growing the branches set D pins, and a file that
 * cannot be corrected is worse than one that is an import away. ⚠ **IT HIT THAT
 * CAP AGAIN ON 2026-09-09** (it measured 520 of 500 at `b5e300e1`, i.e. the root
 * lint was already red on this branch), which is why set D left too: the SIX
 * ontology entries below had nowhere to go. No route imports the parser; its
 * only consumers are this suite and that one.
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
 * Breaking the parser fails set D. ⚠ The entry COUNT is pinned by set A's first
 * case, which carries its own history — do not restate it here.
 * MEASURED 2026-08-26 — 4 reverts, 4 failures, 0 vacuous: parser loses the
 * re-export branch (4 red); loses the function-declaration branch (1 red); stops
 * stripping comments (1 red); B2 back to comparing FILE NAMES while a SECOND
 * guest floor is added to an already-listed file (`…/members/route.ts` POST) —
 * the count sweep goes red, and the old file-name sweep stayed GREEN on that
 * exact tree (12 files either way), which is the gap it closed.
 * ⚠ **THE FOUR KNOWLEDGE-LANE ENTRIES ARE DELETED (Samuel's ruling R-18,
 * 2026-09-17).** They were the only guest floors in this codebase in front of a
 * payload the channel did not own, and the only guest WRITE outside the channel's
 * own transcript. The capability that reached them had no host after 2026-09-04,
 * so the tab, its hook, its client lane, its three route files and the
 * `shared/api/channel-knowledge-lane.ts` helper are gone — and with them the two
 * source pins at the bottom of this file. ⚠ **A guest now reaches no knowledge base
 * at all**: every route under `/api/knowledge/**` is at the `viewer` default, where
 * `defaultLevelForRole("guest")` is `null`.
 *
 * ⚠ THE OTHER NON-CHANNEL ENTRY IS A METER
 * (2026-08-26). `mcp/credits/consume` sits at `guest` so a guest's tool calls
 * are BILLED — the registrar fails open on the 403 the `viewer` default
 * produced, so that floor made guest traffic free rather than refusing it
 * (F-325). It grants no data and no write; the entry lives here because this
 * file's contract is "nothing anywhere is at `guest` unless it is listed", and
 * that contract is worth more than the list staying channel-only.
 *
 * ⚠ THREE `personal-arming` VERBS STOOD HERE AND ARE DELETED (2026-09-07) with
 * the route itself: Samuel reversed task 11 and personal knowledge reaches a
 * shared channel BY DEFAULT (`shared/tenancy/personal-reach.ts`), so the switch
 * had nothing left to switch — it wrote rows no fence read.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
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
  // ⚠ **THE KNOWLEDGE LANE'S FOUR ENTRIES ARE DELETED (R-18, 2026-09-17)** — see
  // this file's header. A guest reaches no knowledge base at all now.
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
  // ⚠ ARTIFACTS (2026-09-06, #1220) — folds messages a guest already reads and
  // posts: the messages route's floor, behind the same service fence.
  [`${CHANNELS_REL}/[channelId]/artifacts/route.ts`, "GET"],
  [`${CHANNELS_REL}/[channelId]/artifacts/route.ts`, "POST"],
  // ⚠ THREE `personal-arming` ROWS STOOD HERE AND ARE DELETED WITH THE ROUTE
  // (2026-09-07) — see this file's header.
  //
  // ⚠ THE ONTOLOGY LANE (2026-09-09, Samuel's home-ontology ruling; closes
  // F-685). SIX entries, and the FIRST guest floors outside `api/channels/**`
  // that carry data — this census's contract is "nothing anywhere is at `guest`
  // unless it is listed", so extending it to a second feature is a widening of
  // the LIST, never of the file's scope.
  //
  // ⚠ **THE FLOOR GRANTS NOTHING HERE. IT ONLY LETS A GUEST BE REFUSED.** A home
  // channel's peer is admitted at the role the LINK grants and that DEFAULTS to
  // `guest` (`home/server/service-claim-bound.ts`), so at the `viewer` default
  // the entire `guests_level` column was a word no request could exercise. The
  // gate is `ontology/server/service-audience.ts › resolveOntologyAudience` +
  // `› levelForOntology`, resolved from DB facts on EVERY read and EVERY write: a
  // guest with no share row reads an empty snapshot and 404s on everything else,
  // exactly as they did before these floors existed. Behaviourally pinned in
  // `ontology/server/guest-lane.test.ts`.
  //
  // ⚠ **THE WRITES MOVED WITH THE READS, AND THAT IS THE RULING** — "are guests
  // access/view or edit" — which is answered here by a LADDER rather than by a
  // per-grant boolean: `guests_level='edit'` is what admits them, and
  // `service-gates.ts › requireObject` demands `edit` on EVERY ontology the
  // object belongs to (Q9).
  //
  // ⚠ **WHAT DELIBERATELY DID NOT MOVE**, and each absence is a decision:
  // `ontologies/route.ts` POST + `ontologies/[ontologyId]/route.ts` PATCH/DELETE (a
  // guest creates, renames and deletes no ontology, and the PATCH carries the
  // `agentsMayEdit` toggle — a containment control), the whole
  // `ontologies/[ontologyId]/shares/**` lane (a guest lends nothing), and
  // `objects/[objectId]/anchor/route.ts` POST (the anchor is workspace-scoped
  // identity, R9). A `grep -rn 'minRole' src/app/api/ontology` is the re-derive.
  ["ontology/route.ts", "GET"], // the snapshot / `?view=summary`
  ["ontology/anchor/route.ts", "GET"], // this container's anchor object
  // ⚠ NOT A CAPABILITY: what THIS session reaches, for the desktop's prompt
  // framing — a COMPENSATING CONTROL (INVARIANTS §4A), answered by the same
  // ceiling. A guest with no share gets `[]` (F-681).
  ["ontology/reach/route.ts", "GET"],
  ["ontology/objects/route.ts", "POST"], // create an object (a MEMBERSHIP write)
  ["ontology/objects/[objectId]/route.ts", "PATCH"], // edit one (RELATIONSHIPS ride the body)
  // ⚠ `sessionOnly` IS UNTOUCHED on this one — the floor says which ROLE may ask,
  // and `sessionOnly` still says no agent token may, for any role.
  ["ontology/objects/[objectId]/route.ts", "DELETE"],
  // ⚠ THE CHANGELOG'S THREE (2026-09-09, the CHANGELOG lane part 2). Each takes
  // the floor its sibling already carries: a lent guest who can OPEN a board can
  // read its history, and one who can PATCH an object can restore one of its
  // fields. ⚠ **THE FLOOR IS THE WEAKEST FENCE ON ALL THREE, NOT THE GATE** —
  // `service-revisions-read.ts` re-asks `requireObject`/`requireOntology` at
  // `view` for the reads and at `edit` for the restore, so a guest whose share
  // says `view` reads history and is refused the restore with the same 404 every
  // other ontology write gives them.
  ["ontology/objects/[objectId]/revisions/route.ts", "GET"],
  ["ontology/ontologies/[ontologyId]/revisions/route.ts", "GET"],
  // ⚠ NOT `sessionOnly`, unlike the object DELETE above: that gate is for acts
  // that DESTROY, and a restore appends a revision whose value already happened.
  ["ontology/objects/[objectId]/revisions/[revisionId]/restore/route.ts", "POST"],
];

const ALLOWED_KEYS = new Set(GUEST_ALLOWED.map(([f, m]) => `${f}#${m}`));

describe("guest route floor — the guest-allowed set is exactly what runs at minRole:guest", () => {
  it("has 26 entries (pins the size against a silent add/drop)", () => {
    // 19 until 2026-09-06 (artifacts ×2), 24 while the three personal-arming
    // verbs existed, 21 once they were deleted with the route (2026-09-07), 27
    // with the ontology lane (2026-09-09, F-685), 30 with that lane's CHANGELOG
    // (the same day, F-686 part 2); 15 until Home Knowledge Panels M2, and **26
    // since R-18 took the four knowledge-lane entries out (2026-09-17)**.
    // ⚠ ENTRIES, NOT FILES, which is why B2
    // counts occurrences. The number blesses nothing; set B proves the tree.
    // Re-derive both, never quote:
    //   grep -rc 'minRole: "guest"' $(grep -rl 'minRole: "guest"' src/app/api)
    expect(ALLOWED_KEYS.size).toBe(26);
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
    //
    // ⚠ THE FENCE MOVED 2026-09-06 and this pin FOLLOWS IT, without loosening.
    // The dedupe wave put both inline `throw new ChannelForbiddenError(...)`
    // calls behind `requireMemberChannel(ctx, ref, action)` in
    // `service-shared.ts`, so the two call sites now name the ACTION STRING at
    // the helper instead of at a throw. The two site pins therefore match the
    // helper call carrying that exact action (multi-line at the fanout, hence
    // `[\s\S]*?` and not `[^)]*`), and the last pin reads the helper itself so
    // the pair still proves a REFUSAL exists rather than just a function call.
    //
    // ⚠ `service-tasks-broadcast.ts` NO LONGER NAMES `loadVisibleChannel` — the
    // dedupe took it out with the throw, so its old belt is asserted on the
    // helper it now calls: `requireMemberChannel` must both RESOLVE through
    // `loadVisibleChannel` and THROW on a null membership. Nothing was relaxed;
    // the same two facts are pinned one level in.
    const featureRoot = join(import.meta.dirname, "..", "..", "..", "features", "channels", "server");
    // 2026-09-14: the channel-header lifecycle (the lane that names
    // `loadVisibleChannel`) moved to `service-writes-channel.ts` in the 500-cap
    // split; `service-writes.ts` keeps the message lane. Read the lane's file.
    const writes = readFileSync(join(featureRoot, "service-writes.ts"), "utf8");
    const header = readFileSync(join(featureRoot, "service-writes-channel.ts"), "utf8");
    const fanout = readFileSync(join(featureRoot, "service-tasks-broadcast.ts"), "utf8");
    const shared = readFileSync(join(featureRoot, "service-shared.ts"), "utf8");
    expect(header).toMatch(/loadVisibleChannel/);
    expect(writes).toMatch(/requireMemberChannel\([\s\S]*?"post to this channel"\s*\)/);
    expect(fanout).toMatch(/requireMemberChannel\([\s\S]*?"create a task in this channel"\s*\)/);
    expect(shared).toMatch(
      /function requireMemberChannel[\s\S]*?loadVisibleChannel\(ctx, ref\)/
    );
    expect(shared).toMatch(
      /function requireMemberChannel[\s\S]*?throw new ChannelForbiddenError\(action\)/
    );
  });

  // ⚠ **TWO KNOWLEDGE-LANE SOURCE PINS STOOD HERE AND ARE DELETED (R-18,
  // 2026-09-17)** — one asserting the lane helper demanded a membership row
  // rather than inheriting `loadVisibleChannel`'s public arm, one asserting all
  // four lane routes went through that ONE helper. Both named files that no longer
  // exist. The rule they guarded is unchanged for every SURVIVING route: the
  // membership fence is `channels/server/service-shared.ts › requireMemberChannel`,
  // pinned by the case above this comment.
});
