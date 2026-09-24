// `no-bridge` means the launch toggle on `launch`/`posture` (`main/launch-directive-vocab.js ›
// KINDS_NEEDING_LAUNCH_CONSENT`) and explicitly not on `end`/`rename`; this suite keeps the two apart.

import { describe, it, expect } from "vitest";
import { opRenameAgent } from "./channel-ops-agent";
import { channelDoctrine } from "./channel-doctrine";
import { AGENT, endText, settledMode as settled } from "./launch-fixtures";
import { sourceOf } from "./tool-group-files";

describe("the sibling verbs keep their own answers (the two maps stay two)", () => {
  it("an END's `no-bridge` still DENIES the launch toggle — the opposite claim", async () => {
    const text = await endText(
      settled({ kind: "end", status: "refused", refusalReason: "no-bridge" }),
    );
    // Same verdict pair as a re-posture; the launch lane's wording must not ride along.
    expect(text).toContain("reason=no-bridge");
    expect(text).toContain("retry=no");
    expect(text).not.toMatch(/turn(ed)? (it )?on/i);
    // Both claims must stay findable in the shared text, or they have collapsed into one answer.
    expect(channelDoctrine()).toContain("`no-bridge` the operator's LAUNCH toggle is off");
    expect(channelDoctrine()).toContain('it gates "launch" and "posture", never "end" or "rename"');
  });

  it("an END's pending line still points at the disappearance, not at a posture", async () => {
    const text = await endText(settled({ kind: "end", status: "pending" }));
    // The one kind with a real confirmation surface: the agent disappearing from `op="status"`.
    expect(text).toContain("confirm=status");
    expect(channelDoctrine()).toContain(
      'op="status" reads your own machine\'s live sessions and the directions waiting for them',
    );
  });

  it("a RENAME's pending line is still the rename's", async () => {
    const text = (
      await opRenameAgent(
        settled({ kind: "rename", status: "pending" }),
        "general",
        AGENT,
        "Research",
        { waitMs: 0 },
      )
    ).content[0].text as string;
    // Nothing can confirm a rename landed.
    expect(text).toContain("confirm=none");
    expect(text).not.toContain("confirm=status");
    // No `asked=`: that is what tells a rename's line from a re-posture's, since both answer `confirm=none`.
    expect(text).not.toContain("asked=");
    expect(channelDoctrine()).toContain("what people see and what agents tag it by");
  });
});

// A raw-source negative over the whole ungated module: the one check a behavioural test cannot make.
describe("the ungated verbs' copy never sends a caller to the launch toggle", () => {
  const src = sourceOf("channel-ops-agent.ts");

  it("states the DENIAL, and states it positively", () => {
    expect(channelDoctrine()).toContain('never "end" or "rename"');
  });

  it("never tells that caller to have the toggle turned on", () => {
    // The launch op's own advice, which a copy-paste would carry here.
    expect(src).not.toContain("If you believe they want it on, ASK THEM");
    expect(src).not.toContain("ask your operator to turn it on");
  });

  it("and the GATED verb is the only one whose copy says the toggle applies", () => {
    // The doctrine grants the gate to `launch` and `posture` by name; the ungated module never claims it.
    expect(channelDoctrine()).toContain('it gates "launch" and "posture"');
    expect(src).not.toContain("IS gated by it");
  });
});
