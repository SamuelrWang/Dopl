// @vitest-environment jsdom
/**
 * 🔒 THE LAUNCH PANEL'S AUTHORSHIP MARKER — a SECURITY SIGNAL on the surface that
 * takes most of the launch traffic (RESTORED 2026-08-30, Samuel's standing §5A
 * ruling; ledger ASK-21).
 *
 * WHAT WAS LOST AND WHY IT MATTERED. On 2026-08-27 the composer's identity
 * chevron was replaced by the retired slide-out's Identity row, and that
 * row narrowed the list to `{id, name}` — no `authorMarker`, no visibility,
 * nothing in the accessible name. INVARIANTS §5A calls the marker *"a SECURITY
 * SIGNAL, NOT DECORATION… the ONLY signal shown to the human BEFORE the choice
 * is made"*: a `team`/`workspace` identity's instructions are another member's
 * text about to run on this machine under this operator's credential.
 * `IdentityApprovalDialog` still fires on first use, so the FENCE never moved —
 * what went missing is the warning before the click, on the busiest lane.
 *
 * ⚠ THE MARKER MUST REACH THE ACCESSIBLE NAME, not merely the pixels. Every
 * assertion below addresses rows BY THEIR ACCESSIBLE NAME (`getByRole
 * ("menuitem", { name })`), so a marker painted in a `<span>` the a11y tree
 * cannot see fails exactly as a missing one does. That is the same property
 * `identity-picker.tsx › IdentityRow` holds via its `aria-label`; here it comes
 * from `MenuItem`'s `description`, which renders INSIDE the `role="menuitem"`
 * button.
 *
 * ⚠ AN UNRESOLVABLE AUTHOR IS STILL FOREIGN — "by another member", never no
 * marker. `createdBy` is a WORKSPACE member and the map is the CHANNEL roster,
 * so an identity shared by someone outside this channel resolves to no name;
 * `created_by` is also nulled when its author leaves the workspace. Dropping the
 * marker there would turn UNKNOWN into MINE (INVARIANTS §11).
 *
 * ⚠ MUTATION-VERIFY — MEASURED 2026-08-30, 5 tests baseline, 5 reverts,
 *   0 vacuous:
 *   - `description` dropped from the option (marker computed, never
 *     rendered — the 2026-08-27 regression exactly) ............... 3 red
 *   - `authorMarker`'s nameless arm returns `null` instead of
 *     "by another member" ........................................ 2 red
 *   - `authorMarker`'s own-identity guard removed ................ 1 red
 *   - the CHANNEL roster widened so an off-channel author resolves
 *     to a name .................................................. 1 red
 *   The last two are why the own-identity and off-channel cases are written
 *   separately: each is the only one that catches its own revert.
 *
 * ⚠ `useThreadWrites` and the identities endpoint are MOCKED — this file is about
 * one row's face and name, not about the write layer or the read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

const identityList = vi.hoisted(() => ({ identities: [] as unknown[] }));
vi.mock("@/features/agent-identities/hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({
    identities: identityList.identities,
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

import { ChannelsComposer } from "./composer";
import type { AgentLaunchControls } from "./use-agents-panel";
import { member, CHANNEL_ID, ME, PEER } from "./test-fixtures";

/** A member of the WORKSPACE who is NOT in this channel — the nameless case. */
const OFF_CHANNEL = "u-off-channel";

const MEMBERS = [
  member({ userId: ME, displayName: "Sam Wang" }),
  member({ userId: PEER, displayName: "Diana Taylor", role: "member" }),
];

const MINTED = "k3v7d2mq";
const mintAgentId = vi.fn();

function launcher(): AgentLaunchControls {
  return {
    canLaunch: true,
    launchBusy: false,
    launchError: null,
    launchAgent: vi.fn().mockResolvedValue({ ok: true, agentId: MINTED }),
    approveIdentity: vi.fn().mockResolvedValue({ ok: true }),
  };
}

beforeEach(() => {
  mintAgentId.mockReset().mockResolvedValue({ ok: true, agentId: MINTED });
  // ⚠ `apiRequest` IS THE SPA MARKER (`spa-bridge.ts › getSpaBridge`) — without
  // it the bridge reads as absent and the Bot icon never renders.
  (window as { dopl?: unknown }).dopl = {
    apiRequest: () =>
      Promise.resolve({ status: 200, statusText: "OK", hasBody: false }),
    sessions: {
      mintAgentId,
      rename: vi.fn().mockResolvedValue({ ok: true }),
      describe: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
});

afterEach(() => {
  cleanup();
  delete (window as { dopl?: unknown }).dopl;
  identityList.identities = [];
});

/**
 * The accessible name of one option row, as a pattern.
 *
 * ⚠ `\s*`, NOT A LITERAL SPACE, AND THAT IS NOT A LOOSENING. The option button holds
 * the label and the marker as two sibling nodes; jsdom loads no stylesheet,
 * so the accessible-name algorithm sees them as INLINE and joins them with no
 * separator ("Code auditorby Diana Taylor") where a browser inserts one. The
 * pattern is anchored at both ends, so it still fails on a missing marker, a
 * reordered one, or extra text.
 */
const NAME_RE = (label: string, marker: string) =>
  new RegExp(`^${label}\\s*${marker}$`);

/**
 * Open the Bot popup; returns nothing — assert on roles.
 *
 * ⚠ THERE IS NO MENU TO OPEN SINCE 2026-09-08 (Samuel's popup-panel ruling). Identity is a
 * `SegmentedControl` row, so every option is on screen as a `role="tab"` the moment the dialog
 * is — which is a STRONGER reading of §5A than the dropdown gave: the marker is now visible
 * before the operator even reaches for the row, not just before the click.
 */
async function openIdentityMenu() {
  render(
    <ChannelsComposer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
      newAgent={launcher()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
  // ⚠ **THE MINT NO LONGER SHOWS UP IN THE NAME FIELD (Samuel, 2026-09-15: *"The name should be
  // blank"*), so this waited on a prefill that is gone.** The id is still minted and still
  // forwarded on the launch — it is the agent's ADDRESS — it is simply not rendered, so the
  // readiness signal is the CALL plus its settle rather than a value on screen.
  await waitFor(() => expect(mintAgentId).toHaveBeenCalled());
  // ⚠ AND THE DIALOG'S OWN MOUNT — `ModalShell` reveals on a rAF, which the old prefill
  // assertion happened to wait out as a side effect. The Launch button is the one control every
  // one of these popups has.
  await waitFor(() => expect(screen.getByRole("button", { name: "Launch" })).toBeTruthy());
}

describe("the launch popup's Identity row carries the authorship marker", () => {
  it("names the AUTHOR of an identity this operator did not write", async () => {
    identityList.identities = [
      { id: "tpl-1", name: "Code auditor", workspaceId: "ws-1", createdBy: PEER },
    ];
    await openIdentityMenu();

    // The marker is IN the accessible name, before the choice is made.
    expect(
      await screen.findByRole("tab", { name: NAME_RE("Code auditor", "by Diana Taylor") })
    ).toBeTruthy();
  });

  it("still marks an identity whose author the CHANNEL roster cannot name", async () => {
    // The author is a workspace member outside this channel — no name, and the
    // marker must NOT disappear. UNKNOWN is not MINE.
    identityList.identities = [
      {
        id: "tpl-2",
        name: "Release notes",
        workspaceId: "ws-1",
        createdBy: OFF_CHANNEL,
      },
    ];
    await openIdentityMenu();

    expect(
      await screen.findByRole("tab", { name: NAME_RE("Release notes", "by another member") })
    ).toBeTruthy();
  });

  it("marks an identity whose author has LEFT the workspace (createdBy null)", async () => {
    identityList.identities = [
      { id: "tpl-3", name: "Orphan", workspaceId: "ws-1", createdBy: null },
    ];
    await openIdentityMenu();

    expect(
      await screen.findByRole("tab", { name: NAME_RE("Orphan", "by another member") })
    ).toBeTruthy();
  });

  it("wears NO marker on this operator's OWN identity", async () => {
    // A marker over your own configuration is the noise that stops markers
    // being read — so the absence here is load-bearing, not an omission.
    identityList.identities = [
      { id: "tpl-4", name: "My auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    await openIdentityMenu();

    expect(
      await screen.findByRole("tab", { name: /^My auditor$/ })
    ).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /by /i })).toBeNull();
  });

  it("leaves None unmarked — it is a configuration, not somebody's text", async () => {
    identityList.identities = [
      { id: "tpl-5", name: "Code auditor", workspaceId: "ws-1", createdBy: PEER },
    ];
    await openIdentityMenu();

    expect(
      // ⚠ **"Blank agent" → "None" ON 2026-09-13** (Samuel, docs/specs/agent-colors.md item 7).
      // ⚠ THIS SUITE MOUNTS `composer.tsx` AND REACHES THE SAME DIALOG the sibling
      // `launch-agent-dialog.test.tsx` mounts directly — the `SegmentedControl` row this
      // docblock describes is `launch-agent-dialog.tsx › identityOptions`, so the label moved
      // here too. The WIRE is unchanged (`identityId: null`), which is why the marker property
      // this case actually guards is untouched.
      await screen.findByRole("tab", { name: "None" })
    ).toBeTruthy();
  });
});
