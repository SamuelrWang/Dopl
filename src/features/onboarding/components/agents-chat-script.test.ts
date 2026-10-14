import { describe, expect, it } from "vitest";
import { SCRIPT, agentsFinalFrame, buildAgentsTimeline } from "./agents-chat-script";

describe("agents chat script", () => {
  const { frames, cycle } = buildAgentsTimeline();

  it("opens with the Orchestrator, then the user", () => {
    const [a, b] = SCRIPT;
    expect(a).toMatchObject({ kind: "msg", who: "orch" });
    expect(b).toMatchObject({ kind: "msg", who: "you" });
  });

  it("raises all three pills, then drops each as that agent starts posting", () => {
    const peak = Math.max(...frames.map((f) => f.working.length));
    expect(peak).toBe(3);
    for (const who of ["inbox", "reply", "cal"] as const) {
      const idx = SCRIPT.findIndex((it) => it.kind === "msg" && it.who === who);
      const typing = frames.filter((f) => f.count === idx + 1);
      expect(typing.length).toBeGreaterThan(0);
      typing.forEach((f) => expect(f.working).not.toContain(who));
    }
    expect(frames[frames.length - 1].working).toEqual([]);
  });

  it("is monotonic, ends with a clear inside the cycle", () => {
    frames.forEach((f, i) => i && expect(f.at).toBeGreaterThanOrEqual(frames[i - 1].at));
    expect(frames[frames.length - 1]).toMatchObject({ clearing: true });
    expect(frames[frames.length - 1].at).toBeLessThan(cycle);
  });

  it("reduced motion shows the whole story with no pills", () => {
    expect(agentsFinalFrame()).toMatchObject({ count: SCRIPT.length, working: [], clearing: false });
  });
});
