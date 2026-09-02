import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LAUNCH_MESSAGE_MODES, LAUNCH_TOOL_MODES } from "../schema-launch";
import {
  EMPTY_AGENT_POSTURE,
  chainRefused,
  clampPosture,
  resolveChain,
} from "./agent-posture";

/**
 * 🔒 **ONE CLAMP RULE, TWO TREES** — the parity half of A9's server-side ceiling
 * (2026-09-02, guardrails G6/G7).
 *
 * ⚠ **THE COPY THIS GUARDS.** `lib/agent-posture.ts` is a hand copy of
 * `dopl-desktop-app/main/launch-posture.js › narrowTo` / `› resolveChain`,
 * because main cannot import this tree's TypeScript. That copy is deliberate —
 * the alternative was no server-side clamp at all, which is exactly what G6
 * records — but a hand-copied rule is a drift bomb, and THIS one's failure is
 * silent and asymmetric: the two fences would simply disagree about which of two
 * postures is "wider", and every unit test on both sides would stay green.
 *
 * ⚠ **THE ORDER OF THE ENUMS IS THE RULE.** Both clamps are an INDEX into a
 * narrowest-first array, so re-ordering `LAUNCH_TOOL_MODES` here or `TOOL_MODES`
 * there silently INVERTS the bound. That is asserted first, and it is the case
 * most likely to catch a real change.
 *
 * ⚠ IT RUNS THE REAL CODE, sliced out of the desktop's PURE block and evaluated —
 * the `agent-handle-parity.test.ts` idiom, and for its reason: two suites each
 * agreeing with themselves is not the same thing as two ends agreeing.
 */

const DESKTOP_MODULE = path.join(
  import.meta.dirname,
  "..", "..", "..", "..",
  "dopl-desktop-app", "main", "launch-posture.js"
);
const SRC = readFileSync(DESKTOP_MODULE, "utf8");

function desktop(): {
  narrowTo: (r: string, c: string, order: readonly string[]) => string;
  resolvePosture: (
    requested: { tools?: string; messages?: string },
    ceiling: { tools?: string; messages?: string },
    toolOrder: readonly string[],
    messageOrder: readonly string[]
  ) => { tools: string; messages: string; clamped: boolean };
  resolveChain: (
    requested: boolean | null,
    allowed: boolean
  ) => { chain: boolean; refused: boolean };
} {
  const begin = SRC.indexOf("// ─── BEGIN LAUNCH-POSTURE");
  expect(begin, "the desktop's BEGIN sentinel is gone").toBeGreaterThan(-1);
  const end = SRC.indexOf("// ─── END LAUNCH-POSTURE");
  const block = SRC.slice(begin, end > begin ? end : undefined);
  return new Function(
    `${block}\n return { narrowTo, resolvePosture, resolveChain };`
  )() as ReturnType<typeof desktop>;
}

const main = desktop();

/**
 * The desktop's own ordered arrays, read from ITS file — not restated here.
 *
 * ⚠ `launch-directive-vocab.js` IS THE FILE, and it is where `directiveFrom`'s
 * narrowing reads them from. `channel-prefs.js` holds a SECOND pair with the same
 * names and the same values; that copy is the OPERATOR's own posture record and
 * the desktop pins the two against each other itself. What matters here is the
 * pair the wire narrows with, because that is the one the server's resolution has
 * to survive.
 */
function desktopOrder(name: "TOOL_MODES" | "MESSAGE_MODES"): string[] {
  const vocab = readFileSync(
    path.join(import.meta.dirname, "..", "..", "..", "..",
      "dopl-desktop-app", "main", "launch-directive-vocab.js"),
    "utf8"
  );
  const m = new RegExp(`const ${name} = \\[([^\\]]*)\\]`).exec(vocab);
  expect(m, `${name} moved or was renamed on the desktop`).not.toBeNull();
  return [...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("the two trees order the axes identically", () => {
  it("TOOL_MODES is this tree's LAUNCH_TOOL_MODES, in order", () => {
    expect(desktopOrder("TOOL_MODES")).toEqual([...LAUNCH_TOOL_MODES]);
  });

  it("MESSAGE_MODES is this tree's LAUNCH_MESSAGE_MODES, in order", () => {
    expect(desktopOrder("MESSAGE_MODES")).toEqual([...LAUNCH_MESSAGE_MODES]);
  });
});

describe("the clamp answers identically on every pair", () => {
  it.each(
    LAUNCH_TOOL_MODES.flatMap((req) =>
      LAUNCH_TOOL_MODES.map((ceil) => [req, ceil] as const)
    )
  )("tools: request %s against ceiling %s", (req, ceil) => {
    expect(clampPosture({ tools: req }, { ...EMPTY_AGENT_POSTURE, tools: ceil }).tools).toBe(
      main.narrowTo(req, ceil, LAUNCH_TOOL_MODES)
    );
  });

  it.each(
    LAUNCH_MESSAGE_MODES.flatMap((req) =>
      LAUNCH_MESSAGE_MODES.map((ceil) => [req, ceil] as const)
    )
  )("messages: request %s against ceiling %s", (req, ceil) => {
    expect(
      clampPosture({ messages: req }, { ...EMPTY_AGENT_POSTURE, messages: ceil }).messages
    ).toBe(main.narrowTo(req, ceil, LAUNCH_MESSAGE_MODES));
  });

  it("an UNRECOGNISED request resolves to the ceiling on BOTH sides", () => {
    // ⚠ The direction that must never fail open, and it is unreachable from a real
    // request on either side — which is precisely why it needs a test rather than a
    // comment. `-1 > n` is FALSE, so a bare index comparison would pass it through.
    const bogus = "godmode" as never;
    expect(clampPosture({ tools: bogus }, { ...EMPTY_AGENT_POSTURE, tools: "manual" }).tools).toBe(
      "manual"
    );
    expect(main.narrowTo("godmode", "manual", LAUNCH_TOOL_MODES)).toBe("manual");
  });

  it("reports `clamped` on the same inputs", () => {
    const ceiling = { ...EMPTY_AGENT_POSTURE, tools: "manual" as const };
    expect(clampPosture({ tools: "bypass" }, ceiling).clamped).toBe(true);
    expect(clampPosture({ tools: "manual" }, ceiling).clamped).toBe(false);
    expect(
      main.resolvePosture({ tools: "bypass" }, { tools: "manual", messages: "ask" },
        LAUNCH_TOOL_MODES, LAUNCH_MESSAGE_MODES).clamped
    ).toBe(true);
  });
});

describe("an axis NOBODY asked for resolves to the ceiling on both sides", () => {
  // 🔒 REVIEW D4 (2026-09-02). The desktop has always done this — `resolvePosture`
  // is `narrowTo(...) || max.tools`, so an unasked axis takes its ceiling — and
  // the server answered `null`, which made `resolved_*` unable to tell "no
  // ceiling recorded" from "no request made" and made G6's non-null claim false.
  // Bringing the server into line is parity, and it only ever NARROWS: the
  // machine's clamp still runs on top.
  it.each(LAUNCH_TOOL_MODES)("tools: no request against ceiling %s", (ceil) => {
    expect(clampPosture({}, { ...EMPTY_AGENT_POSTURE, tools: ceil }).tools).toBe(
      main.resolvePosture({}, { tools: ceil, messages: "ask" },
        LAUNCH_TOOL_MODES, LAUNCH_MESSAGE_MODES).tools
    );
  });

  it.each(LAUNCH_MESSAGE_MODES)("messages: no request against ceiling %s", (ceil) => {
    expect(clampPosture({}, { ...EMPTY_AGENT_POSTURE, messages: ceil }).messages).toBe(
      main.resolvePosture({}, { tools: "manual", messages: ceil },
        LAUNCH_TOOL_MODES, LAUNCH_MESSAGE_MODES).messages
    );
  });

  it("chain: not asking takes the ceiling, both ways", () => {
    expect(resolveChain(null, { ...EMPTY_AGENT_POSTURE, chain: true })).toBe(
      main.resolveChain(null, true).chain
    );
    expect(resolveChain(null, { ...EMPTY_AGENT_POSTURE, chain: false })).toBe(
      main.resolveChain(null, false).chain
    );
  });

  it("`clamped` stays FALSE — nothing the caller asked for was narrowed", () => {
    // ⚠ The flag reports what the CALLER lost, and a caller that named no posture
    // lost nothing. Reporting a clamp here would teach an orchestrator to go
    // looking for a request it never made.
    expect(clampPosture({}, { ...EMPTY_AGENT_POSTURE, tools: "manual" }).clamped).toBe(false);
  });
});

describe("the one place the two DELIBERATELY differ, and why", () => {
  it("NO CEILING: this tree passes the request through; the desktop always has one", () => {
    // ⚠ **NOT A DRIFT — A DIFFERENT QUESTION.** The desktop's ceiling is the
    // operator's own stored pair and is never absent (`channel-prefs.js ›
    // getLaunchPosture` always answers), so `narrowTo` has no "no ceiling" case to
    // have. The SERVER's ceiling is a nullable column, and `null` there means "not
    // recorded" — inventing a narrowing from an absence would refuse what nobody
    // asked to refuse. The desktop's clamp still runs afterwards either way.
    expect(clampPosture({ tools: "bypass" }, EMPTY_AGENT_POSTURE).tools).toBe("bypass");
    expect(main.narrowTo("bypass", "", LAUNCH_TOOL_MODES)).toBe("");
  });
});

describe("the chain rule matches, all three states", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
    [null, true],
    [null, false],
  ] as Array<[boolean | null, boolean]>)(
    "requested %s, allowed %s",
    (requested, allowed) => {
      const ceiling = { ...EMPTY_AGENT_POSTURE, chain: allowed };
      const theirs = main.resolveChain(requested, allowed);
      expect(chainRefused(requested, ceiling)).toBe(theirs.refused);
      // ⚠ THE SHAPES DIFFER BY DESIGN: the desktop answers a BOOLEAN because it is
      // about to spawn, and this answers a TRI-STATE because "did not ask" has to
      // survive to the machine that will. They are compared where they overlap —
      // a refusal, and what an explicit request resolves to.
      if (!theirs.refused && requested !== null) {
        expect(resolveChain(requested, ceiling)).toBe(theirs.chain);
      }
    }
  );

  it("an UNRECORDED chain ceiling refuses nothing, and resolves to nothing", () => {
    // ⚠ `null` NOW HAS ONE MEANING ON THIS AXIS TOO: "no ceiling is recorded", so
    // the machine's `channelAgentChain` toggle is the only answer. It is the one
    // case D4's non-null preference cannot reach, which is why it is a stored
    // value and not a constraint.
    expect(chainRefused(true, EMPTY_AGENT_POSTURE)).toBe(false);
    expect(resolveChain(null, EMPTY_AGENT_POSTURE)).toBeNull();
  });
});
