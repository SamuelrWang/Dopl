import { describe, expect, it, vi } from "vitest";
import { displayNudge, structuredProseSignals } from "./nudge";

const hint = (body: string) => structuredProseSignals(body).hint;

describe("structuredProseSignals", () => {
  it.each([
    ["Which one should I take?\n1. Ship now\n2. Wait for review", "choice"],
    ["Pick one:\nA) Rebase onto master\nB) Merge master in\nWhich do you prefer?", "choice"],
    ["Should I ship the migration tonight or wait for Samuel's review tomorrow?", "choice"],
    ["| Job | State |\n| --- | --- |\n| web | done |", "structure"],
    ["Status of the deploy today:\n- web done\n- desktop running\n- notary pending", "structure"],
    ["Here is where things stand now:\nBuild: green\nTests: 1319 passed\nDeploy: pending", "structure"],
  ])("%j → %s", (body, expected) => expect(hint(body)).toBe(expected));

  it.each([
    "short?\n1. a\n2. b",
    "I shipped the migration and the index. Nothing else changed; CI is green on the branch.",
    "```\n1. Ship now\n2. Wait for review\n```\nWhich one should I take? It is in the block above.",
    "> 1. Ship now\n> 2. Wait for review\nThey asked which one? I answered it in the thread already.",
    "Run `1. a` then `2. b` locally; is that what you meant by the two steps?",
  ])("plain prose stays plain: %j", (body) => expect(hint(body)).toBeNull());
});

describe("displayNudge", () => {
  it("never throttles a choice; throttles structure once per session per 30 min, and logs", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const s = { channelId: "c", sessionId: "c:t:agent-1", userId: "u" };
    const list = "Status of the deploy today:\n- web done\n- desktop running\n- notary pending";
    const choice = "Which one should I take?\n1. Ship now\n2. Wait for review";
    expect(displayNudge({ ...s, body: list }, 0)).toBe("structure");
    expect(displayNudge({ ...s, body: list }, 60_000)).toBeNull();
    expect(displayNudge({ ...s, body: list }, 31 * 60_000)).toBe("structure");
    expect(displayNudge({ ...s, body: choice }, 60_000)).toBe("choice");
    expect(displayNudge({ ...s, body: choice }, 61_000)).toBe("choice");
    const lines = log.mock.calls.map(([l]) => String(l)).filter((l) => l.startsWith("[display-nudge] "));
    expect(lines).toHaveLength(5);
    expect(lines.filter((l) => l.includes('"throttled":true'))).toHaveLength(1);
    log.mockRestore();
  });

  it("rapid structure posts in one session tip once per window, and each session is its own window", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const list = "Status of the deploy today:\n- web done\n- desktop running\n- notary pending";
    const at = (sessionId: string, t: number) => displayNudge({ channelId: "c", sessionId, userId: "u", body: list }, t);
    const base = 10 * 3_600_000;
    const hits = [0, 1, 2, 500, 29 * 60_000, 30 * 60_000 - 1].map((t) => at("s-rapid", base + t));
    expect(hits.filter(Boolean)).toHaveLength(1);
    expect(at("s-rapid", base + 30 * 60_000)).toBe("structure");
    expect(at("s-other", base + 1)).toBe("structure");
    log.mockRestore();
  });
});
