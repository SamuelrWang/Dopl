// @vitest-environment jsdom
/**
 * THE SENDER PILL OPENS THAT AGENT'S VIEW (Samuel, 2026-08-28, over a channel transcript
 * screenshot of an `#rrr5o70x` pill: *"make the pill a clickable button that opens that
 * agent's agent view"*).
 *
 * ⚠ ITS OWN FILE, NOT A BLOCK IN `agent-attribution.test.tsx`, which is at the 500-line cap.
 * The seam is also the honest one (INVARIANTS §1): that file pins the WORDING and the
 * run-grouping — what a pill SAYS — and this one pins the pill's new VERB and the gate on it.
 *
 * The properties that fail quietly, and are therefore what this file is for:
 *
 *  - **THE ID IT SENDS.** The pane resolves `openAgent` with `agents-model.ts › agentKey`,
 *    which for a stamped row IS the instance id — so sending the message id, the author id,
 *    or a sibling's id opens the wrong agent's pane, or none, with nothing saying so.
 *  - **ONLY AGENT ROWS.** A human's pill names a colleague; the transcript is one system and
 *    only the agent case gained a verb.
 *  - **THE GATE IS A HOST FACT.** `AuthorIndex.agents` is empty wherever there is no desktop
 *    feed (the guest web lane, a plain browser) and `onOpenAgent` is absent wherever there is
 *    no pane (the pop-out window). Either absence must render the SPAN — an inert button is
 *    indistinguishable from a broken one, the same absent-not-disabled rule the launch
 *    controls follow.
 *  - **THE FACE DOES NOT FORK.** /home repaints the HUMAN pill on
 *    `[data-attribution-pill]`, so a human button has to carry the attribute and the same
 *    capsule classes or the account palette silently stops reaching those rows.
 *
 * ⚠ **THE AGENT ROW LOST ITS CAPSULE ON 2026-09-13 AND THE VERB CAME WITH IT**
 * (`message-row-agent.tsx`, which carries Samuel's ruling): the sender is now the NAME on a
 * flat header line, marked `data-agent-sender` in both its pressable and its inert form. Every
 * property above is unchanged — the id it sends, the two gates, absent-not-disabled — and the
 * only thing that moved is which element carries them. A human row is still the capsule.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { Transcript } from "./transcript";
import { AttributionPill } from "./attribution-pill";
import { indexMembers } from "./view-model";
import { threadRows } from "./view-model-rows";
import { ME, PEER, member, message } from "./test-fixtures";

afterEach(cleanup);

const A = "k3v7d2mq";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

/** A machine with a desktop feed that knows agent A — `view-model.ts › indexAgents`'s output. */
const WITH_A = indexMembers(
  MEMBERS,
  ME,
  new Map([[A, { displayName: null, description: null }]])
);
/** The web tree, the guest lane and the pop-out: a roster, and no agents at all. */
const NO_FEED = indexMembers(MEMBERS, ME);

/** An agent post by one of the viewer's own instances — `main/session-dispatch.js`'s stamp. */
function byAgent(id: string, agentId: string | null, seq = 1) {
  return message({
    id,
    seq,
    body: `BODY-${id}`,
    authorUserId: ME,
    authorKind: "agent",
    metadata: { taskId: "t-1" },
    clientMsgId: agentId === null ? null : `agent-${agentId}-${seq}`,
  });
}

/**
 * ⚠ `onOpenAgent` IS NOT DEFAULTED, deliberately: `undefined` is one of the states under test
 * (the pop-out window's), and a default parameter would silently fill it in.
 */
function renderWith(
  messages: ReturnType<typeof message>[],
  index = WITH_A,
  onOpenAgent?: (agentId: string) => void
) {
  render(
    <Transcript
      rows={threadRows(messages, "t-1", index, formatChannelTimestamp)}
      index={index}
      flashId={null}
      onOpenAgent={onOpenAgent}
      onOpenThread={vi.fn()}
    />
  );
}

/** The row a body landed in. */
const rowFor = (body: string) =>
  screen.getByText(body).closest("article") as HTMLElement;

/** The AGENT row's sender — the name, pressable or not. */
const senderFor = (body: string) =>
  rowFor(body).querySelector("[data-agent-sender]") as HTMLElement;

/** The HUMAN row's capsule, which this ruling did not touch. */
const pillFor = (body: string) =>
  rowFor(body).querySelector("[data-attribution-pill]") as HTMLElement;

describe("an agent's sender pill opens that agent's view", () => {
  it("renders the agent pill as a button and opens THAT agent", () => {
    const onOpenAgent = vi.fn();
    renderWith([byAgent("m-1", A)], WITH_A, onOpenAgent);
    const sender = senderFor("BODY-m-1");
    expect(sender.tagName).toBe("BUTTON");
    // ⚠ THE NAME, NEVER A BARE ID — `#<id>` IS the display name (global invariant).
    expect(sender.getAttribute("aria-label")).toBe(`Open agent #${A}`);
    fireEvent.click(sender);
    // ⚠ THE ID, AND EXACTLY THE ID. This is the assertion a wrong argument fails.
    expect(onOpenAgent).toHaveBeenCalledTimes(1);
    expect(onOpenAgent).toHaveBeenCalledWith(A);
  });

  /** ⚠ ONE WORDING FUNCTION, so a rename reaches the label and the name line together. */
  it("names the renamed agent in the button's label", () => {
    const named = indexMembers(
      MEMBERS,
      ME,
      new Map([[A, { displayName: "Research", description: null }]])
    );
    renderWith([byAgent("m-1", A)], named, vi.fn());
    expect(senderFor("BODY-m-1").getAttribute("aria-label")).toBe("Open agent Research");
  });

  /** ⚠ THE SECOND AGENT IN ONE THREAD OPENS ITSELF, not the run above it — the multiplayer
   *  case the per-agent pill exists for (F-251). */
  it("sends each of two agents' own id", () => {
    const B = "a1b2c3d4";
    const onOpenAgent = vi.fn();
    const index = indexMembers(
      MEMBERS,
      ME,
      new Map([
        [A, { displayName: null, description: null }],
        [B, { displayName: null, description: null }],
      ])
    );
    renderWith([byAgent("m-1", A, 1), byAgent("m-2", B, 2)], index, onOpenAgent);
    fireEvent.click(senderFor("BODY-m-2"));
    expect(onOpenAgent).toHaveBeenCalledWith(B);
    fireEvent.click(senderFor("BODY-m-1"));
    expect(onOpenAgent).toHaveBeenLastCalledWith(A);
  });

  /** ⚠ A HUMAN PILL IS NOT A CONTROL, and the map beside it is irrelevant. */
  it("leaves a HUMAN pill a plain span", () => {
    const onOpenAgent = vi.fn();
    renderWith(
      [message({ id: "h", seq: 1, body: "HUMAN", authorUserId: ME, metadata: { taskId: "t-1" } })],
      WITH_A,
      onOpenAgent
    );
    const pill = pillFor("HUMAN");
    expect(pill.tagName).toBe("SPAN");
    expect(pill.getAttribute("aria-label")).toBeNull();
    expect(onOpenAgent).not.toHaveBeenCalled();
  });

  /**
   * ⚠ THE `agent` FLAG IS ITS OWN GUARD, pinned at the COMPONENT rather than through the row
   * builder. `view-model-rows.ts › toMessageRow` already refuses to read a stamp off a human
   * post, so the transcript can never hand this shape down — which is exactly why dropping the
   * flag from the pill's own condition would pass every test above while making a human pill
   * pressable the day anything else feeds this component.
   */
  it("refuses to become a button on a NON-AGENT pill, whatever id it is handed", () => {
    const onOpenAgent = vi.fn();
    render(
      <AttributionPill
        author={{ userId: ME, email: null, displayName: "Sam Wang", avatarUrl: null }}
        authorLabel="You"
        agent={false}
        agentId={A}
        time="12:00"
        onOpenAgent={onOpenAgent}
      />
    );
    const pill = document.querySelector("[data-attribution-pill]") as HTMLElement;
    expect(pill.tagName).toBe("SPAN");
    expect(onOpenAgent).not.toHaveBeenCalled();
  });

  /** ⚠ "CANNOT SAY WHICH AGENT" HAS NO PANE TO OPEN — the unstamped row stays inert. */
  it("leaves an UNSTAMPED agent pill a plain span", () => {
    renderWith([byAgent("m-1", null)], WITH_A, vi.fn());
    expect(senderFor("BODY-m-1").tagName).toBe("SPAN");
  });

  /**
   * ⚠ THE GUEST WEB LANE AND EVERY PLAIN BROWSER. No bridge ⇒ no feed ⇒ `AuthorIndex.agents`
   * is empty, and `agent-panel.tsx` could not resolve the click even if it fired. A PEER's
   * agent takes this same arm for free: it runs on their machine and never enters this map,
   * which is the "state only, never openable" rule the peer CARDS already keep.
   */
  it("leaves the pill a span on a host whose agent index does not know it", () => {
    renderWith([byAgent("m-1", A)], NO_FEED, vi.fn());
    expect(senderFor("BODY-m-1").tagName).toBe("SPAN");
  });

  /** ⚠ THE POP-OUT WINDOW — no agent pane beside it, so it hands no callback and gets no
   *  button. Doubly gated there, since its index carries no agents either. */
  it("leaves the pill a span on a host that hands no open mechanism", () => {
    renderWith([byAgent("m-1", A)], WITH_A, undefined);
    expect(senderFor("BODY-m-1").tagName).toBe("SPAN");
  });

  /**
   * ⚠ THE ROW'S HOOKS AND A FACE WITH NO BOX IN IT. `data-agent-id` moved to the ARTICLE when
   * the capsule went (the row, not a capsule, is what a host can now address), and the sender
   * must NOT pick up `[data-attribution-pill]` — /home repaints that in a RAISED PILL face, so
   * an agent name carrying it would re-box the thing Samuel had removed.
   */
  it("keeps the row's hooks and gives the button a flat face", () => {
    renderWith([byAgent("m-1", A)], WITH_A, vi.fn());
    const row = rowFor("BODY-m-1");
    expect(row.getAttribute("data-agent-id")).toBe(A);
    const sender = senderFor("BODY-m-1");
    expect(sender.tagName).toBe("BUTTON");
    expect(sender.getAttribute("type")).toBe("button");
    // ⚠ NO CAPSULE ANYWHERE ON THIS ROW — neither the kit's card nor /home's hook.
    expect(row.querySelector(".bento")).toBeNull();
    expect(row.querySelector("[data-attribution-pill]")).toBeNull();
    // The pressable half is ink + a pointer; no local shadow or colour recipe.
    expect(sender.className).toContain("cursor-pointer");
    expect(sender.className).toContain("text-text-primary");
    expect(row.outerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    expect(row.outerHTML).not.toMatch(/\bshadow-\[/);
  });
});
