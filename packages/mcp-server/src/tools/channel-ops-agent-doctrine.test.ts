// The doctrine half of `manage end/rename`'s two-sided pin: fails when `channel-doctrine.ts` is
// reworded, where `channel-ops-agent.test.ts` fails when `channel-facts.ts`'s fields move.

import { describe, it, expect } from "vitest";
import { channelDoctrine } from "./channel-doctrine";
import { endText, renameText, settled } from "./launch-fixtures";

// Sentences these results stopped carrying: absent from every result AND present in the doctrine,
// since a result check alone cannot tell a move from a delete, nor a doctrine check a move from a copy.
const MOVED_DOCTRINE = [
  // …an end touches nothing else, and the handle it spends is gone.
  "A THREAD HAS NO FINISHED STATE: nothing settles one, no op ends one",
  "the thread stays readable and postable",
  '"end" stops one, and there is no undo — instance ids are never reused',
  "A REFUSAL IS A NORMAL ANSWER",
  "re-issuing changes nothing unless the word says so",
  "`no-session` no such agent",
  // …the two verbs the launch toggle does not gate, in one clause with the two it does.
  '`no-bridge` the operator\'s LAUNCH toggle is off',
  'it gates "launch" and "posture", never "end" or "rename"',
  "`bad-name` the label was not one line of 1-60 visible characters",
  // …a rename changes how people and agents reach the session.
  "what people see and what agents tag it by",
  "A TIMEOUT IS NOT A FAILURE: the request stays PENDING",
  "re-issuing without the SAME `client_msg_id` starts a SECOND agent",
] as const;

// Prose cut from the doctrine (contracts only), pinned absent so a re-expansion is a decision, not
// drift. Each is derivable from a contract still pinned; sibling suites point here, not at a copy.
const RETIRED_BY_RULING = [
  // …that `no-session` on an END is the outcome the caller wanted (`retry=no` already says it).
  "On an END this is usually GOOD NEWS",
  "the agent already finished and there was nothing left to stop",
  // …that the listing keeps printing the id after a rename (`confirm=none` already says it).
  "keeps printing the id after a rename",
  // …not to hunt around the operator's consent setting (`retry=no` already says it).
  "do not look for another route",
] as const;

describe("the doctrine still carries every paragraph these results dropped", () => {
  it('each moved sentence is one rooms(action="help") away', () => {
    for (const phrase of MOVED_DOCTRINE) {
      expect(channelDoctrine(), `${phrase} left the doctrine`).toContain(phrase);
    }
  });

  it("…and the ones retired by ruling stay OUT of it", () => {
    // One assertion over the whole list, so a failure reports every phrase, not the first.
    const grownBack = RETIRED_BY_RULING.filter((phrase) =>
      channelDoctrine().includes(phrase),
    );
    expect(
      grownBack,
      "these were CUT by ruling — the doctrine carries contracts only (wave B " +
        "spec §4). Each is a consequence of a contract that is still there, or " +
        "encouragement about one. Putting one back is a decision to make in the " +
        "spec, not a sentence to slip into channel-doctrine.ts › MANAGE.",
    ).toEqual([]);
  });

  it("and no result on this lane carries one back", async () => {
    // Every terminal shape: prose grows back on the branch nobody re-reads.
    const lines = await Promise.all([
      endText(settled({ status: "done" })),
      endText(settled({ status: "refused", refusalReason: "no-session" })),
      endText(settled({ status: "expired" })),
      endText(settled({ status: "pending" })),
      renameText(settled({ kind: "rename", status: "done", targetName: "Research" })),
      renameText(settled({ kind: "rename", status: "refused", refusalReason: "bad-name" })),
      renameText(settled({ kind: "rename", status: "pending" })),
    ]);
    for (const text of lines) {
      // One line always: a second line is how a paragraph comes back.
      expect(text.split("\n"), text).toHaveLength(1);
      for (const phrase of [...MOVED_DOCTRINE, ...RETIRED_BY_RULING]) {
        expect(text, `${phrase} is back in a result`).not.toContain(phrase);
      }
    }
  });
});
