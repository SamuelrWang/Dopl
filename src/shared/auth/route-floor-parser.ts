import "server-only";

/**
 * 🔒 THE `withWorkspaceAuth` ROUTE-FLOOR PARSER — READS ROUTE SOURCE, RUNS NO ROUTE.
 *
 * It answers, for one `route.ts` source and one HTTP method: which `minRole` does
 * that method's `withWorkspaceAuth` wrapper run at? `"viewer"` when the options
 * object says nothing (the wrapper default), the literal when it does,
 * `<dynamic>` / `<unparsed>` when the shape cannot be READ, and `null` only when
 * the method has no workspace floor here at all.
 *
 * ⚠ IT IS A TEST AUTHORITY AND NO ROUTE IMPORTS IT — deliberately. Its consumer
 * is `src/app/api/channels/guest-route-floor.test.ts`, which turns INVARIANTS
 * §4A's guest-allowed set into a red test by reading route SOURCE (a mock cannot
 * tell a floor apart). It lives beside `with-auth.ts`, whose call sites it
 * parses, rather than inside the suite, because the suite is at the 500-line cap
 * (§1) and a parser that cannot be corrected is worse than one that is a file
 * away.
 *
 * ⚠ EVERY BRANCH BELOW EXISTS BECAUSE A SILENT WRONG ANSWER WAS MEASURED, not
 * theorised. `null` and `"viewer"` are the two answers that read as "nothing to
 * see here", so anything this cannot parse must say `<unparsed>` instead.
 */

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** The wrapper default, shared by both families. */
export const DEFAULT_FLOOR = "viewer";
/** `minRole` is present but is not a string LITERAL — never silently "viewer". */
export const DYNAMIC = "<dynamic>";
/** The method is exported and the file uses the wrapper, but the assignment did
 *  not parse — never silently "not wrapped". */
export const UNPARSED = "<unparsed>";

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

/**
 * Source with COMMENTS REMOVED, strings intact.
 *
 * ⚠ THE PARSER AND SET B2 WERE BOTH COMMENT-BLIND UNTIL 2026-08-26, and the file
 * that proved it is the FIRST entry in the allowed set: `channels/route.ts`'s own
 * docblock contains the text `minRole: "guest"`. A sweep that counts prose counts
 * a route's DESCRIPTION of a floor as the floor — §14's "a comment asserting
 * where a filter lives is not evidence the filter exists". Same string-aware walk
 * `balancedArgs` does; a stripped comment becomes a space, never nothing.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      out += " ";
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      out += " ";
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * The LOCAL binding a `route.ts` re-exports as `<METHOD>`, or null.
 *
 * ⚠ ADDED 2026-08-26, AND IT CLOSES A HOLE IN EVERY SET AT ONCE. The parser
 * matched `export const <M> = withWorkspaceAuth(` and nothing else, so
 * `export { handleGet as GET }` answered `null` — "no workspace floor here" —
 * rather than tripping `<unparsed>`, there being no `export const GET =` to
 * test for. A method added that way to an ALREADY-LISTED file was invisible to
 * A, B, B2 and B3 at once. Neither this shape nor `export async function GET`
 * exists in the tree today (AST-verified); both are handled so that stays a
 * fact rather than an assumption.
 */
function reExportedLocalName(code: string, method: string): string | null {
  for (const block of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const raw of block[1].split(",")) {
      const spec = raw.trim().replace(/^type\s+/, "");
      if (!spec) continue;
      const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(spec);
      const local = asMatch ? asMatch[1] : spec;
      const exported = asMatch ? asMatch[2] : spec;
      if (exported === method && /^\w+$/.test(local)) return local;
    }
  }
  return null;
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
  // ⚠ Comment-stripped FIRST, so a docblock that discusses a floor can never be
  // read as one. Every offset below is into `code`.
  const code = stripComments(src);

  const call = new RegExp(
    `export\\s+const\\s+${method}\\s*=\\s*withWorkspaceAuth\\s*\\(`
  ).exec(code);
  if (call) return minRoleIn(balancedArgs(code, call.index + call[0].length));

  // `export { handleGet as GET }` — follow the alias to the local binding and
  // read ITS definition. A re-export from ANOTHER module has no local binding
  // here, so it falls through to `<unparsed>` rather than to `null`.
  const local = reExportedLocalName(code, method);
  if (local) {
    const bound = new RegExp(
      `(?:const|let|var)\\s+${local}\\s*=\\s*withWorkspaceAuth\\s*\\(`
    ).exec(code);
    if (bound) return minRoleIn(balancedArgs(code, bound.index + bound[0].length));
    return code.includes("withWorkspaceAuth") ? UNPARSED : null;
  }

  // Exported, and this file DOES use the wrapper, but not in a shape above —
  // an assign-then-export, a function declaration, or a local helper composing
  // it. Say so rather than answering `null`, which reads as "no workspace floor
  // here".
  const exported =
    new RegExp(`export\\s+const\\s+${method}\\s*=`).test(code) ||
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`).test(code);
  if (exported && code.includes("withWorkspaceAuth")) return UNPARSED;
  return null;
}

