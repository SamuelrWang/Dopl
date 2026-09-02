/**
 * `op="launch_agent"` — **THE TEMPLATE REF, AND THE FOUR THINGS A MISS CAN MEAN.**
 *
 * ⚠ SPLIT OUT OF `channel-ops-launch.test.ts` ON 2026-09-01, AT THE 500-LINE CAP
 * AND ON A REAL SEAM. That file drives the op's FOUR TERMINAL SHAPES (offline,
 * launched, refused, pending); this one drives the ONE argument whose failure
 * modes are a subject of their own — and they move on different clocks, this one
 * when agent-template tenancy does.
 *
 * THE TWO PROPERTIES EVERY CASE HERE SERVES:
 *
 *   1. **AN AMBIGUOUS NAME REFUSES AND LISTS, AND NEVER PICKS.**
 *      `agent_templates` has no name uniqueness on purpose, so two visible
 *      "Researcher"s is a legitimate state and every tie-break silently starts
 *      an identity the caller did not choose.
 *   2. **A MISS NAMES THE RULE, AND NAMES A PLACE ONLY WHEN THE SERVER DID.**
 *      "No such template" and "not shared with you" are ONE answer here, or the
 *      refusal is an id probe (T35). `details.elsewhere` is the single exception,
 *      and it is not a crack in that: the server produces it only over rows the
 *      caller could already list for themselves.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient } from "@dopl/client";
import { opLaunchAgent } from "./channel-ops-launch";

// ⚠ THE MINIMUM CLIENT THIS LANE NEEDS, and deliberately not the sibling file's:
// every case here fails INSIDE `createLaunchDirective`, so there is no directive
// to poll and no `directive()` fixture to keep in step. A shared harness for two
// stubs would couple two suites that fail for different reasons.
const CHANNEL = { id: "chan-1", slug: "general", name: "General", visibility: "private" };

function client(over: Record<string, unknown> = {}): DoplClient {
  return {
    listChannels: vi.fn(async () => [CHANNEL]),
    ...over,
  } as unknown as DoplClient;
}

/** ⚠ Duck-typed exactly as `channel-ops-launch.ts` reads it across the
 *  @dopl/client boundary — `status`, `code`, `details` and nothing else. */
const apiError = (status: number, code: string, details?: unknown) =>
  Object.assign(new Error(code), { status, code, details });

describe("the template ref", () => {
  it("an AMBIGUOUS name is refused and EVERY match is listed with its id and visibility", async () => {
    // ⚠ REFUSES AND LISTS, NEVER PICKS. Names are deliberately not unique — a
    // unique index across a visibility boundary would leak the existence of a
    // private row through a conflict error — so two visible "Researcher"s is a
    // legitimate state and any tie-break silently starts the wrong identity.
    const res = await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(409, "AGENT_TEMPLATE_AMBIGUOUS", {
            matches: [
              { id: "t-1", name: "Researcher", visibility: "private" },
              { id: "t-2", name: "Researcher", visibility: "workspace" },
            ],
          });
        }),
      }),
      "general",
      { template: "Researcher" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("nothing was filed");
    expect(out).toContain("`t-1`");
    expect(out).toContain("`t-2`");
    expect(out).toContain("(private)");
    expect(out).toContain("(workspace)");
    // ⚠ It must not read as a CHANNEL problem, and it must not tell the agent to
    // wait for a machine: nothing was asked of one.
    expect(out).not.toContain("Channel not found");
    expect(out).not.toContain("still PENDING");
  });

  it("an UNRESOLVABLE template says so, and never says whether it EXISTS", async () => {
    // ⚠ 404-never-403 all the way down: "no such template" and "not shared with
    // you" are ONE answer, or the refusal becomes an id-probe.
    const res = await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_TEMPLATE_NOT_FOUND");
        }),
      }),
      "general",
      { template: "Ghost" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("`Ghost`");
    expect(out).toContain("nothing was filed");
    expect(out).not.toContain("Channel not found");
    // ⚠ THE TENANCY RULE IS STATED, AND IT IS NOT THE ORACLE (T35). The row is
    // filtered by `workspace_id` BEFORE visibility runs, so "you own it" and
    // "it resolves here" are different questions — an agent that does not know
    // that re-checks the spelling of a name that was never wrong. Naming the
    // RULE reveals nothing about which rows exist.
    expect(out).toContain("CHECK THE TENANCY BEFORE THE SPELLING");
    expect(out).toContain("a home channel IS its own container");
    // ⚠ AND WITH NO `details.elsewhere` IT NAMES NO PLACE. This is the arm that
    // covers "no such template" AND "somebody else's, not yours to see", and
    // those must stay ONE answer or the refusal becomes an id probe.
    expect(out).toContain("ONE answer here on purpose");
    expect(out).not.toContain("not in this channel's own container");
  });

  it("a template that lives in ANOTHER tenancy of the caller's is NAMED, with the place (T35)", async () => {
    // ⚠ THE MISS THAT IS NOT A MYSTERY. `details.elsewhere` is produced ONLY for
    // a row this caller could already list for themselves — their own, or
    // `workspace`-visible, in a workspace they belong to — so naming the place
    // discloses nothing a list call would not, and the sentence that used to be
    // withheld is the one the agent needed: the NAME was never wrong.
    const out = (await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_TEMPLATE_NOT_FOUND", {
            elsewhere: { name: "Code Auditor", label: "your personal shelf" },
          });
        }),
      }),
      "general",
      { template: "Code Auditor" },
    )).content[0].text as string;
    expect(out).toContain("`Code Auditor`");
    expect(out).toContain("lives in `your personal shelf`, not in this channel's own container");
    expect(out).toContain("nothing was filed");
    // The fix, and it is a MOVE rather than a re-spelling.
    expect(out).toContain("Owning it is not enough");
    expect(out).toContain("create it there");
    // ⚠ IT MUST NOT ALSO RECITE THE PROBE-PROOF DISJUNCTION. There is nothing
    // ambiguous left to hedge: the server said where it is.
    expect(out).not.toContain("ONE answer here on purpose");
  });

  it("ANOTHER MEMBER'S private template elsewhere is never named — the arm simply does not fire", async () => {
    // 🔒 THE PROPERTY, PINNED AT THIS END TOO. The classifier answers over the
    // caller's OWN rows and `workspace`-visible ones only
    // (`agent-templates/server/service-resolve-ref.ts › classifyMissingTemplateRef`),
    // so a stranger's private template produces NO `details.elsewhere` in any
    // workspace — and this surface has no other way to invent one.
    const out = (await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_TEMPLATE_NOT_FOUND", { elsewhere: null });
        }),
      }),
      "general",
      { template: "Someone Elses Auditor" },
    )).content[0].text as string;
    expect(out).toContain("ONE answer here on purpose");
    expect(out).not.toContain("not in this channel's own container");
  });

  it("a malformed `elsewhere` is ignored rather than rendered", async () => {
    // ⚠ FAILS TO THE PROBE-PROOF ARM, never to a half-sentence: the payload is
    // duck-typed across the @dopl/client boundary, so anything that is not two
    // non-empty strings is nothing at all.
    for (const bad of [{}, { name: "x" }, { name: "", label: "y" }, "elsewhere", 7]) {
      const out = (await opLaunchAgent(
        client({
          createLaunchDirective: vi.fn(async () => {
            throw apiError(404, "AGENT_TEMPLATE_NOT_FOUND", { elsewhere: bad });
          }),
        }),
        "general",
        { template: "Ghost" },
      )).content[0].text as string;
      expect(out, JSON.stringify(bad)).toContain("ONE answer here on purpose");
      expect(out, JSON.stringify(bad)).not.toContain("not in this channel's own container");
    }
  });

});
