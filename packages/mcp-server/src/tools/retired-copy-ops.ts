/**
 * **THE TWO RETIRED COPY OPS, AND THE ONE LINE EACH ANSWERS WITH** (MCP v2 wave
 * B slice B15, from Samuel's ruling B11: *grants replace copies*).
 *
 * `dopl_kb(op="copy_base")` and `dopl_agent(op="copy")` are DELETED — the two
 * handlers, their shared target resolver and both test files went with them.
 * The NAMES still parse for one minor release and answer a single line naming
 * the grant that replaces them, so a caller pinned to an older desktop is told
 * what to call instead of receiving an opaque `-32602 invalid enum value`.
 *
 * ⚠ **A COPY AND A GRANT ARE NOT THE SAME ACT, AND THE LINE SAYS SO IN ITS
 * SHAPE.** A copy made a STRANGER row that diverged from the moment it landed;
 * a grant lends the ONE row, so an edit reaches everybody it was lent to. That
 * is the whole of ruling B11 and the reason the redirect names an op rather
 * than an equivalent — there is no equivalent, there is a replacement.
 *
 * ⚠ **HIDDEN FROM THE LIST, NOT PRESENT IN IT.** Both registrars build `op` as
 * `z.enum([...LIVE, ...RETIRED_COPY_OP_NAMES]).meta({ enum: LIVE })`: the
 * RUNTIME accepts the old word, the PUBLISHED JSON Schema — the one every
 * client reads — does not carry it. A retired name a model can SEE is a name a
 * model will call. Same construction as `channel-retired-ops.ts`, whose header
 * carries the full argument.
 *
 * ⚠ **THIS FILE IS THE WHOLE OF THE COMPATIBILITY WINDOW.** It is deleted — the
 * map, the type and the arm in each registrar — one release after the desktop
 * version floor stops calling either name. Nothing else in the tree may grow a
 * second copy of the mapping.
 */

import { ok, type ToolResponse } from "./respond";

/**
 * old `<tool>.<op>` → the one line it answers with.
 *
 * ⚠ **KEYED BY TOOL AS WELL AS OP**, because `copy` is a plausible future op
 * name on a third tool and a bare `op` key would answer for it. Same spelling
 * rule as the desktop's `<op>.<action>` keys (F-578).
 */
const RETIRED_COPY_OPS = {
  "dopl_kb.copy_base":
    'retired: use a grant — dopl_kb(op="grant", base=…, to=…, scope="channel"|"container"|"team", level=…). One base, lent where you name; an edit reaches everyone it is lent to, where a copy diverged.',
  "dopl_agent.copy":
    'retired: use a grant — dopl_agent(op="grant", template=…, to=…, scope="channel"|"container"|"team", level=…). One template, lent where you name; an edit reaches everyone it is lent to, where a copy diverged.',
} as const satisfies Record<string, string>;

type RetiredCopyKey = keyof typeof RETIRED_COPY_OPS;

/**
 * The op names that still parse but are absent from either published enum.
 *
 * ⚠ Derived from the map, never restated — a hand-written second list is how a
 * name comes to parse with no line to answer it. Both registrars spread the
 * whole tuple, which costs one unreachable arm each (`dopl_kb` never receives
 * `copy`) and buys one list instead of two.
 */
export const RETIRED_COPY_OP_NAMES = Object.keys(RETIRED_COPY_OPS).map(
  (k) => k.split(".")[1] as string,
) as [string, ...string[]];

/** The redirect for `<tool>.<op>`, or null when the pair is not retired. */
export function retiredCopyRedirect(
  tool: "dopl_kb" | "dopl_agent",
  op: string,
): ToolResponse | null {
  const key = `${tool}.${op}`;
  if (!Object.prototype.hasOwnProperty.call(RETIRED_COPY_OPS, key)) return null;
  // ⚠ **NOT `err()`, DELIBERATELY** — the same argument `channel-retired-ops.ts`
  // makes: this call did not fail, it was answered, and an `isError` response is
  // a failure a model retries behind whatever policy the client applies.
  return ok(`${tool} op="${op}" ${RETIRED_COPY_OPS[key as RetiredCopyKey]}`);
}
