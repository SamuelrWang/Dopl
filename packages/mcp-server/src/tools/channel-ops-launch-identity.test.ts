// `manage action="launch"` create-time identity refusals: an ambiguous name is refused and listed,
// never picked; a miss names the rule, and a place only when the server supplied `details.elsewhere`.

import { describe, it, expect, vi } from "vitest";
import { opLaunchAgent } from "./channel-ops-launch";
import { launchClient as client } from "./launch-fixtures";

/** Duck-typed as `channel-ops-launch.ts` reads it across the @dopl/client boundary. */
const apiError = (status: number, code: string, details?: unknown) =>
  Object.assign(new Error(code), { status, code, details });

describe("the identity ref", () => {
  it("an AMBIGUOUS name is refused and EVERY match is listed with its id and visibility", async () => {
    // Names are not unique (an index across visibility would leak private rows), so any tie-break
    // would silently start the wrong identity.
    const res = await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(409, "AGENT_IDENTITY_AMBIGUOUS", {
            matches: [
              { id: "t-1", name: "Researcher", visibility: "private" },
              { id: "t-2", name: "Researcher", visibility: "workspace" },
            ],
          });
        }),
      }),
      "general",
      { name: "Scout", identity: "Researcher" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("nothing was filed");
    expect(out).toContain("`t-1`");
    expect(out).toContain("`t-2`");
    expect(out).toContain("(private)");
    expect(out).toContain("(workspace)");
    expect(out).not.toContain("Channel not found");
    expect(out).not.toContain("still PENDING");
  });

  it("an UNRESOLVABLE identity says so, and never says whether it EXISTS", async () => {
    // 404-never-403: "no such identity" and "not shared with you" are one answer, or it is an id probe.
    const res = await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_IDENTITY_NOT_FOUND");
        }),
      }),
      "general",
      { name: "Scout", identity: "Ghost" },
    );
    const out = res.content[0].text as string;
    expect(res.isError).toBe(true);
    expect(out).toContain("`Ghost`");
    expect(out).toContain("nothing was filed");
    expect(out).not.toContain("Channel not found");
    // The row is filtered by `workspace_id` before visibility; naming that rule reveals no row.
    expect(out).toContain("CHECK THE TENANCY BEFORE THE SPELLING");
    expect(out).toContain("a home channel IS its own container");
    expect(out).toContain("ONE answer here on purpose");
    expect(out).not.toContain("not in this channel's own container");
  });

  it("a channel 404 with NO identity code is still a channel not-found", async () => {
    const res = await opLaunchAgent(
      client({ createLaunchDirective: vi.fn(async () => { throw apiError(404, "LAUNCH_DIRECTIVE_NOT_FOUND"); }) }),
      "general",
      { name: "Scout", identity: "Code Auditor" },
    );
    expect(res.content[0].text).toContain("general");
    expect(res.content[0].text).not.toContain("agent identity");
  });

  it("an identity that lives in ANOTHER tenancy of the caller's is NAMED, with the place", async () => {
    // `details.elsewhere` only covers rows the caller could already list, so naming the place discloses nothing.
    const out = (await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_IDENTITY_NOT_FOUND", {
            elsewhere: { name: "Code Auditor", label: "your home shelf" },
          });
        }),
      }),
      "general",
      { name: "Scout", identity: "Code Auditor" },
    )).content[0].text as string;
    expect(out).toContain("`Code Auditor`");
    expect(out).toContain("lives in `your home shelf`, not in this channel's own container");
    expect(out).toContain("nothing was filed");
    expect(out).toContain("Owning it is not enough");
    expect(out).toContain("create it there");
    expect(out).not.toContain("ONE answer here on purpose");
  });

  it("ANOTHER MEMBER'S private identity elsewhere is never named — the arm simply does not fire", async () => {
    // `service-resolve-ref.ts › classifyMissingIdentityRef` never classifies a stranger's private row.
    const out = (await opLaunchAgent(
      client({
        createLaunchDirective: vi.fn(async () => {
          throw apiError(404, "AGENT_IDENTITY_NOT_FOUND", { elsewhere: null });
        }),
      }),
      "general",
      { name: "Scout", identity: "Someone Elses Auditor" },
    )).content[0].text as string;
    expect(out).toContain("ONE answer here on purpose");
    expect(out).not.toContain("not in this channel's own container");
  });

  it("a malformed `elsewhere` is ignored rather than rendered", async () => {
    // Anything but two non-empty strings falls back to the probe-proof arm.
    for (const bad of [{}, { name: "x" }, { name: "", label: "y" }, "elsewhere", 7]) {
      const out = (await opLaunchAgent(
        client({
          createLaunchDirective: vi.fn(async () => {
            throw apiError(404, "AGENT_IDENTITY_NOT_FOUND", { elsewhere: bad });
          }),
        }),
        "general",
        { name: "Scout", identity: "Ghost" },
      )).content[0].text as string;
      expect(out, JSON.stringify(bad)).toContain("ONE answer here on purpose");
      expect(out, JSON.stringify(bad)).not.toContain("not in this channel's own container");
    }
  });

});
