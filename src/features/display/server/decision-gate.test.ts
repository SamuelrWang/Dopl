import { describe, expect, it, vi } from "vitest";
import { decisionDraft, decisionGate } from "./decision-gate";

describe("decisionDraft — refuses only a confident choice", () => {
  it.each([
    "Which should I take?\n1. Ship now\n2. Wait for review",
    "Two ways to fix the picker:\n1. Hide old models - picker shows the current four\n2. Remove them - resuming an old agent fails\nWhich do you want?",
    "Pick one:\nA) Rebase onto master\nB) Merge master in\n\nYour call?",
    "Should I go ahead?\n\n1. Merge now: lands today\n2. Wait: lands after review\n3. Drop it: nothing lands",
    "Decision needed.\n1. Override this once\n2. You run the merge\nOk to go with 1?",
  ])("draft for %j", (body) => {
    const d = decisionDraft(body);
    expect(d).not.toBeNull();
    expect(d!.options.length).toBeGreaterThanOrEqual(2);
    expect(d!.summary.length).toBeGreaterThan(0);
  });

  it.each([
    ["no question at all", "Done today:\n1. Merged the fix\n2. Removed the worktree\n3. Tests green"],
    ["a single option", "Should I do this?\n1. Merge the fix now and remove the worktree"],
    ["seven options (a card holds six)", "Which one?\n1. a1\n2. b2\n3. c3\n4. d4\n5. e5\n6. f6\n7. g7"],
    ["options inside a code block", "```\n1. Ship now\n2. Wait\n```\nWhich one should I take? It is in the block above, already answered."],
    ["quoted options", "> 1. Ship now\n> 2. Wait for review\nThey asked which one should we pick? I answered in the thread."],
    ["a question that is not a choice", "Steps I ran:\n1. Rebased\n2. Re-ran tests\n3. Fast-forwarded\nAny questions or concerns?"],
    ["a question far from the list", "Should I keep going on this tomorrow?\n\nSome context here.\nMore context.\nEven more.\n1. Rebased\n2. Re-ran tests"],
    ["a URL query, not a question", "See https://x.test/a?which=1 for detail.\n1. Rebased\n2. Re-ran tests"],
    ["too short", "a or b?\n1. a\n2. b"],
  ])("no draft: %s", (_why, body) => expect(decisionDraft(body)).toBeNull());

  it("splits a label from what it means, and keeps the question as the summary", () => {
    const d = decisionDraft("Which fix?\n1. Hide old models — picker shows only the current four\n2. Remove them: resuming fails");
    expect(d).toEqual({
      summary: "Which fix?",
      options: [
        { label: "Hide old models", consequence: "picker shows only the current four" },
        { label: "Remove them", consequence: "resuming fails" },
      ],
    });
  });

  it("clips to the card's bounds", () => {
    const long = "x".repeat(300);
    const d = decisionDraft(`Which should I take?\n1. ${long}\n2. ${long}`)!;
    for (const o of d.options) {
      expect(o.label.length).toBeLessThanOrEqual(80);
      expect(o.consequence.length).toBeLessThanOrEqual(200);
    }
  });
});

describe("decisionGate — the metric", () => {
  it("logs a refused choice with refused:true", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const d = decisionGate({ body: "Which should I take?\n1. Ship now\n2. Wait for review", channelId: "c", sessionId: "s" });
    expect(d).not.toBeNull();
    const line = JSON.parse(String(log.mock.calls[0][0]).replace("[display-nudge] ", ""));
    expect(line).toMatchObject({ evt: "structured_without_display", hint: "choice", refused: true, options: 2 });
    log.mockRestore();
  });

  it("logs nothing when it lets a post through", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(decisionGate({ body: "Merged at 2000832e. Worktree removed.", channelId: "c", sessionId: null })).toBeNull();
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
