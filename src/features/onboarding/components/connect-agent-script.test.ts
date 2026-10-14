import { describe, expect, it } from "vitest";
import { SEGMENTS, buildTimeline, finalFrame, words } from "./connect-agent-script";

describe("connect-agent script", () => {
  const { frames, cycle } = buildTimeline();

  it("plays Claude then Gemini, each opening empty and closing with a clear", () => {
    expect(SEGMENTS.map((s) => s.logo)).toEqual(["claude", "gemini"]);
    for (const seg of [0, 1]) {
      const own = frames.filter((f) => f.seg === seg);
      expect(own[0]).toMatchObject({ count: 0, clearing: false });
      expect(own[own.length - 1]).toMatchObject({ count: SEGMENTS[seg].msgs.length, clearing: true });
    }
  });

  it("types by word: one frame per word, user first", () => {
    const first = SEGMENTS[0].msgs[0];
    expect(first.kind).toBe("user");
    const typed = frames.filter((f) => f.seg === 0 && f.count === 1);
    expect(typed.map((f) => f.words)).toEqual(
      words(first.kind === "user" ? first.text : "").map((_, i) => i + 1)
    );
  });

  it("each segment uses different Dopl tools", () => {
    const tools = SEGMENTS.map(
      (s) => new Set(s.msgs.flatMap((m) => (m.kind === "tool" ? [m.label] : [])))
    );
    expect(tools[0].size).toBeGreaterThan(0);
    expect([...tools[1]].some((t) => tools[0].has(t))).toBe(false);
  });

  it("is monotonic and ends inside the cycle", () => {
    frames.forEach((f, i) => i && expect(f.at).toBeGreaterThanOrEqual(frames[i - 1].at));
    expect(frames[frames.length - 1].at).toBeLessThan(cycle);
  });

  it("reduced motion is segment 1, finished", () => {
    expect(finalFrame()).toMatchObject({ seg: 0, count: SEGMENTS[0].msgs.length, clearing: false });
  });
});
