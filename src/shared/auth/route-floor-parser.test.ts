/**
 * THE ROUTE-FLOOR PARSER'S OWN PIN — set D of `app/api/channels/
 * guest-route-floor.test.ts`, MOVED HERE 2026-09-09 and otherwise verbatim.
 *
 * ⚠ **IT MOVED FOR THE REASON THE PARSER ITSELF MOVED**, and that file's header
 * states it: it sat at the §1 500-line cap while the census it holds was
 * growing, and a file that cannot be corrected is worse than one that is an
 * import away. The ontology floors (F-685) were the next entries; these pins
 * were the part with no reason to live beside a CHANNELS census, since what they
 * assert is `shared/auth/route-floor-parser.ts › workspaceFloor` — which is
 * right here.
 *
 * ⚠ **NOTHING IS RELAXED BY THE MOVE.** Sets A, B, B2, B3 and C stay where they
 * were and still read every route source; this file is what fails when the
 * PARSER they trust stops reading a shape. Both halves are required: a census
 * over a broken parser is green and empty.
 *
 * ⚠ The floors in {@link KNOWN_FLOORS} are HAND-MEASURED, dated, and every one of
 * them is a shape the pre-2026-08-26 parser got wrong. Re-measure with
 * `grep -n minRole <file>`; never amend from memory.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  DEFAULT_FLOOR,
  UNPARSED,
  workspaceFloor,
} from "./route-floor-parser";

/** `src/app/api`, from `src/shared/auth`. */
const API_ROOT = join(import.meta.dirname, "..", "..", "app", "api");
const CHANNELS_REL = "channels";

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
      // 🔒 **THIS CASE FLIPPED IN WAVE 3 (R-26) AND THE FLIP IS THE POINT.** It
      // asserted `<unparsed>` — "the parser cannot read a dispatcher, and says
      // so loudly" — which was the right answer while no such route existed.
      // `/api/channels` is one now (the SCOPE parameter chooses the WRAPPER), so
      // the parser learned the shape and `guest` is the TRUE floor here. The
      // pin moved because the parser reads MORE, never because it was softened:
      // the three cases below are the new `<unparsed>` / `<dynamic>` edges.
      "an exported FUNCTION DECLARATION over ONE wrapped local reads its floor",
      `${WRAPPER}
       const inner = withWorkspaceAuth(async () => null, { minRole: "guest" });
       export async function GET(req: Request) { return inner(req); }`,
      "GET",
      "guest",
    ],
    [
      "a dispatcher over TWO DISAGREEING workspace floors is <dynamic>, never a pick",
      `${WRAPPER}
       const a = withWorkspaceAuth(async () => null, { minRole: "guest" });
       const b = withWorkspaceAuth(async () => null, { minRole: "admin" });
       export function GET(req: Request) { return req ? a(req) : b(req); }`,
      "GET",
      "<dynamic>",
    ],
    [
      "a dispatcher naming a local defined in ANOTHER module is still <unparsed>",
      `${WRAPPER}
       import { inner } from "./elsewhere";
       export function GET(req: Request) { return inner(req); }`,
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
