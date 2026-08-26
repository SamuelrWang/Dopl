// @vitest-environment jsdom
/**
 * THE AUTO-SEND + FULL-TOOLS + PEER WARNING (Samuel, 2026-08-26 — plan §6, M6).
 *
 * TWO HALVES, AND THEY ARE DELIBERATELY SEPARATE. The PREDICATE is a pure
 * conjunction and is pinned exhaustively — every conjunct falsified alone, so a
 * dropped `&&` cannot pass. The DIALOG half is pinned on the one thing a
 * predicate cannot express: that it fires on the TRANSITION INTO the combination
 * and at no other moment, that cancelling writes NOTHING, and that confirming
 * writes exactly the change that was clicked.
 *
 * ⚠ THE COPY IS ASSERTED OFF `document.body`, not the render container.
 * `ModalShell` portals itself in from an effect a frame after `open` flips, so
 * the dialog is neither in the container nor in the DOM on the click that asked
 * for it — every case here `await`s it (the technique `thread-manage.test.tsx`
 * states).
 *
 * ⚠ THE VIEW IS DRIVEN THROUGH ITS REAL CONTROLS, never through the hook. What is
 * under test is that BOTH axes route through the warning — either one can be the
 * flip — and a test that called `usePostureWarning` directly would still pass
 * with one of the two `onChange` handlers wired around it.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import {
  POSTURE_WARNING_CONFIRM,
  POSTURE_WARNING_TITLE,
  entersPostureWarning,
  posturePeerLabel,
  postureWarningDescription,
  warrantsPostureWarning,
  type PostureWarningInputs,
} from "./posture-warning";
import { agentView, postureSends, postureTools } from "./settings-agent-harness";
import type { MessageMode } from "../../lib/permission-modes";
import type { AgentToolProfile, ChannelMember } from "../../types";

afterEach(cleanup);

const ME = "user-me";
const PEER = "user-peer";

/** A roster row with only the fields the warning reads. */
function member(userId: string, displayName: string | null = null) {
  return { userId, displayName, email: null } as unknown as ChannelMember;
}

const WITH_PEER = [member(ME, "Me"), member(PEER, "Dana Reyes")];
const SOLO = [member(ME, "Me")];

/** The combination, and the one input each case moves off it. */
function inputs(over: Partial<PostureWarningInputs> = {}): PostureWarningInputs {
  return {
    messageMode: "auto_both",
    toolProfile: "full",
    roster: WITH_PEER,
    currentUserId: ME,
    ...over,
  };
}

describe("warrantsPostureWarning — the three conjuncts, each falsified alone", () => {
  it("is TRUE only for auto_both + full + somebody else on the roster", () => {
    expect(warrantsPostureWarning(inputs())).toBe(true);
  });

  // ⚠ EVERY OTHER VALUE OF AXIS B, not just one. The warning is about the mode
  // that sends BOTH ways without asking; `auto_outbound` is the near miss a
  // `!== "ask"` mutation would let through, so it is listed by name.
  const otherModes: MessageMode[] = ["ask", "auto_inbound", "auto_outbound"];
  for (const messageMode of otherModes) {
    it(`is FALSE at messages="${messageMode}", everything else in place`, () => {
      expect(warrantsPostureWarning(inputs({ messageMode }))).toBe(false);
    });
  }

  const otherProfiles: AgentToolProfile[] = ["dopl_only", "read_only"];
  for (const toolProfile of otherProfiles) {
    it(`is FALSE at tools="${toolProfile}", everything else in place`, () => {
      expect(warrantsPostureWarning(inputs({ toolProfile }))).toBe(false);
    });
  }

  it("is FALSE when the roster is the caller alone — nobody receives", () => {
    expect(warrantsPostureWarning(inputs({ roster: SOLO }))).toBe(false);
  });

  it("is FALSE on an empty roster", () => {
    expect(warrantsPostureWarning(inputs({ roster: [] }))).toBe(false);
  });

  it("is FALSE when the posture cannot be read at all (no bridge)", () => {
    // ⚠ UNKNOWN is not EMPTY (INVARIANTS §11): with no posture there is no axis
    // to flip and no launch this machine will run.
    expect(warrantsPostureWarning(inputs({ messageMode: null }))).toBe(false);
  });

  it("is FALSE when the caller is unknown — a peer cannot be told from you", () => {
    expect(warrantsPostureWarning(inputs({ currentUserId: null }))).toBe(false);
  });
});

describe("entersPostureWarning — the TRANSITION, not the state", () => {
  it("fires when the change creates the combination", () => {
    expect(
      entersPostureWarning(inputs({ messageMode: "ask" }), inputs())
    ).toBe(true);
  });

  it("does NOT fire when the channel is already in it", () => {
    expect(entersPostureWarning(inputs(), inputs())).toBe(false);
  });

  it("does NOT fire when the change LEAVES the combination", () => {
    expect(
      entersPostureWarning(inputs(), inputs({ toolProfile: "read_only" }))
    ).toBe(false);
  });

  it("does NOT fire when neither side is in it", () => {
    expect(
      entersPostureWarning(
        inputs({ messageMode: "ask", toolProfile: "read_only" }),
        inputs({ messageMode: "ask" })
      )
    ).toBe(false);
  });
});

describe("posturePeerLabel — who the copy names", () => {
  it("names the single peer", () => {
    expect(posturePeerLabel(WITH_PEER, ME)).toBe("Dana Reyes");
  });

  it("falls back to the email, then to a generic, never to the caller", () => {
    const anon = [member(ME, "Me"), { userId: PEER, email: "d@x.io" }];
    expect(posturePeerLabel(anon, ME)).toBe("d@x.io");
    expect(posturePeerLabel([member(ME, "Me"), member(PEER)], ME)).toBe(
      "your teammate"
    );
  });

  it("COUNTS rather than lists once there is more than one", () => {
    const three = [...WITH_PEER, member("user-3", "Sam")];
    expect(posturePeerLabel(three, ME)).toBe("the 2 other people here");
  });

  it("never counts the caller as an audience", () => {
    expect(posturePeerLabel(SOLO, ME)).toBe("your teammates");
  });
});

describe("the copy states the RISK, not the settings", () => {
  it("says the review step is what is going away", () => {
    const text = postureWarningDescription("Dana Reyes");
    expect(text).toContain("Dana Reyes");
    expect(text).toContain("without your review");
    expect(text).toContain("full tools");
  });
});

describe("the one production mount actually hands the roster over", () => {
  /**
   * ⚠ A SOURCE PIN, AND IT EARNS ITS BRITTLENESS. `roster` / `currentUserId` are
   * OPTIONAL props (an out-of-tree caller must not be broken by them), and the
   * absent answer warns about NOTHING — so a mount that silently stops passing
   * them disables this whole feature with every test above still green. The
   * roster is read off data `channel-manage.tsx` already holds; if that surface
   * ever opens a read of its own for it, THAT is the change to argue about.
   */
  it("`channel-manage.tsx` passes both to ChannelAgentSettings", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "src/features/channels/components/channels-v2/channel-manage.tsx"
      ),
      "utf8"
    );
    const mount = source.slice(
      source.indexOf("<ChannelAgentSettings"),
      source.indexOf("/>", source.indexOf("<ChannelAgentSettings"))
    );
    expect(mount).toContain("roster={members}");
    expect(mount).toContain("currentUserId={currentUserId}");
  });
});

/** The view at the combination minus ONE axis, so a single click completes it. */
function mount(over: Parameters<typeof agentView>[0] = {}) {
  const onChangePosture = vi.fn();
  const onSetToolProfile = vi.fn();
  agentView({
    roster: WITH_PEER,
    currentUserId: ME,
    onChangePosture,
    onSetToolProfile,
    ...over,
  });
  return { onChangePosture, onSetToolProfile };
}

/** Pick a Sends option by its rendered label. */
function pickSends(label: RegExp) {
  fireEvent.click(postureSends());
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
}

describe("the DIALOG fires on the transition, from EITHER axis", () => {
  it("asks before the SENDS axis completes the combination", async () => {
    const { onChangePosture } = mount({
      profile: "full",
      posture: { tools: "manual", messages: "ask" },
    });
    pickSends(/^Automatic/);
    expect(await screen.findByText(POSTURE_WARNING_TITLE)).toBeTruthy();
    // ⚠ THE WRITE HAS NOT HAPPENED YET. Asking after the fact would leave the
    // combination live while the operator reads the question.
    expect(onChangePosture).not.toHaveBeenCalled();
  });

  it("asks before the TOOLS axis completes the combination", async () => {
    const { onSetToolProfile } = mount({
      profile: "dopl_only",
      posture: { tools: "manual", messages: "auto_both" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Full access/ }));
    expect(await screen.findByText(POSTURE_WARNING_TITLE)).toBeTruthy();
    expect(onSetToolProfile).not.toHaveBeenCalled();
  });

  it("names the peer who would receive", async () => {
    mount({ profile: "full", posture: { tools: "manual", messages: "ask" } });
    pickSends(/^Automatic/);
    await screen.findByText(POSTURE_WARNING_TITLE);
    expect(document.body.textContent).toContain("Dana Reyes");
  });
});

describe("the DIALOG does NOT fire on anything else", () => {
  it("stays silent on a channel ALREADY in the combination", async () => {
    const { onChangePosture } = mount({
      profile: "full",
      posture: { tools: "manual", messages: "auto_both" },
    });
    // The OTHER axis — Permissions — on a channel that already sends
    // automatically with full tools. Re-asking here is how a confirmation
    // becomes a thing people click through.
    fireEvent.click(postureTools());
    fireEvent.click(screen.getByRole("menuitem", { name: /^Bypass/ }));
    await waitFor(() =>
      expect(onChangePosture).toHaveBeenCalledWith({ tools: "bypass" })
    );
    expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull();
  });

  it("stays silent when the caller is the only person here", async () => {
    const { onChangePosture } = mount({
      roster: SOLO,
      profile: "full",
      posture: { tools: "manual", messages: "ask" },
    });
    pickSends(/^Automatic/);
    await waitFor(() =>
      expect(onChangePosture).toHaveBeenCalledWith({ messages: "auto_both" })
    );
    expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull();
  });

  it("stays silent on an unrelated change (a narrower profile)", async () => {
    const { onSetToolProfile } = mount({
      profile: "full",
      posture: { tools: "manual", messages: "auto_both" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Read only/ }));
    await waitFor(() => expect(onSetToolProfile).toHaveBeenCalledWith("read_only"));
    expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull();
  });

  it("stays silent on a change that LEAVES the combination", async () => {
    const { onChangePosture } = mount({
      profile: "full",
      posture: { tools: "manual", messages: "auto_both" },
    });
    pickSends(/^Ask each time/);
    await waitFor(() =>
      expect(onChangePosture).toHaveBeenCalledWith({ messages: "ask" })
    );
    expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull();
  });

  it("stays silent with no posture to read at all (no bridge)", async () => {
    const { onSetToolProfile } = mount({ profile: "dopl_only", posture: null });
    fireEvent.click(screen.getByRole("radio", { name: /Full access/ }));
    await waitFor(() => expect(onSetToolProfile).toHaveBeenCalledWith("full"));
    expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull();
  });
});

describe("what the two answers do", () => {
  it("CANCEL leaves the setting exactly as it was", async () => {
    const { onChangePosture } = mount({
      profile: "full",
      posture: { tools: "manual", messages: "ask" },
    });
    pickSends(/^Automatic/);
    fireEvent.click(await screen.findByText("Cancel"));
    // ⚠ Nothing to revert, because nothing was written — the dialog fires
    // BEFORE the write, so cancel is an absence rather than an undo.
    expect(onChangePosture).not.toHaveBeenCalled();
    expect(postureSends().textContent).toContain("Ask each time");
    // ⚠ AND THE HELD CHANGE IS DROPPED. A dialog that stays open (or reopens on
    // the next unrelated click, still holding the cancelled patch) is the shape
    // this assertion exists to refuse.
    await waitFor(() =>
      expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull()
    );
  });

  it("CONFIRM writes exactly the change that was clicked", async () => {
    const { onChangePosture } = mount({
      profile: "full",
      posture: { tools: "manual", messages: "ask" },
    });
    pickSends(/^Automatic/);
    fireEvent.click(await screen.findByText(POSTURE_WARNING_CONFIRM));
    await waitFor(() =>
      expect(onChangePosture).toHaveBeenCalledWith({ messages: "auto_both" })
    );
    expect(onChangePosture).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText(POSTURE_WARNING_TITLE)).toBeNull()
    );
  });

  it("CONFIRM on the tools axis writes the profile, not a posture patch", async () => {
    const { onSetToolProfile, onChangePosture } = mount({
      profile: "dopl_only",
      posture: { tools: "manual", messages: "auto_both" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Full access/ }));
    fireEvent.click(await screen.findByText(POSTURE_WARNING_CONFIRM));
    await waitFor(() => expect(onSetToolProfile).toHaveBeenCalledWith("full"));
    expect(onSetToolProfile).toHaveBeenCalledTimes(1);
    expect(onChangePosture).not.toHaveBeenCalled();
  });
});
