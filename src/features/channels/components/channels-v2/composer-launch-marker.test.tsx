// @vitest-environment jsdom
/**
 * 🔒 THE LAUNCH PANEL'S AUTHORSHIP MARKER — a SECURITY SIGNAL on the surface that
 * takes most of the launch traffic (RESTORED 2026-08-30, Samuel's standing §5A
 * ruling; ledger ASK-21).
 *
 * WHAT WAS LOST AND WHY IT MATTERED. On 2026-08-27 the composer's template
 * chevron was replaced by `composer-launch-panel.tsx`'s Template row, and that
 * row narrowed the list to `{id, name}` — no `authorMarker`, no visibility,
 * nothing in the accessible name. INVARIANTS §5A calls the marker *"a SECURITY
 * SIGNAL, NOT DECORATION… the ONLY signal shown to the human BEFORE the choice
 * is made"*: a `team`/`workspace` template's instructions are another member's
 * text about to run on this machine under this operator's credential.
 * `TemplateApprovalDialog` still fires on first use, so the FENCE never moved —
 * what went missing is the warning before the click, on the busiest lane.
 *
 * ⚠ THE MARKER MUST REACH THE ACCESSIBLE NAME, not merely the pixels. Every
 * assertion below addresses rows BY THEIR ACCESSIBLE NAME (`getByRole
 * ("menuitem", { name })`), so a marker painted in a `<span>` the a11y tree
 * cannot see fails exactly as a missing one does. That is the same property
 * `template-picker.tsx › TemplateRow` holds via its `aria-label`; here it comes
 * from `MenuItem`'s `description`, which renders INSIDE the `role="menuitem"`
 * button.
 *
 * ⚠ AN UNRESOLVABLE AUTHOR IS STILL FOREIGN — "by another member", never no
 * marker. `createdBy` is a WORKSPACE member and the map is the CHANNEL roster,
 * so a template shared by someone outside this channel resolves to no name;
 * `created_by` is also nulled when its author leaves the workspace. Dropping the
 * marker there would turn UNKNOWN into MINE (INVARIANTS §11).
 *
 * ⚠ MUTATION-VERIFY — MEASURED 2026-08-30, 5 tests baseline, 5 reverts,
 *   0 vacuous:
 *   - `marker: null` in `ComposerLaunch`'s option map ............. 3 red
 *   - `description` dropped from the option (marker computed, never
 *     rendered — the 2026-08-27 regression exactly) ............... 3 red
 *   - `authorMarker`'s nameless arm returns `null` instead of
 *     "by another member" ........................................ 2 red
 *   - `authorMarker`'s own-template guard removed ................ 1 red
 *   - the CHANNEL roster widened so an off-channel author resolves
 *     to a name .................................................. 1 red
 *   The last two are why the own-template and off-channel cases are written
 *   separately: each is the only one that catches its own revert.
 *
 * ⚠ `useThreadWrites` and the templates endpoint are MOCKED — this file is about
 * one row's face and name, not about the write layer or the read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../hooks/use-thread-writes", () => ({
  useThreadWrites: () => ({
    send: { mutate: vi.fn() },
    fanOutThreads: { mutate: vi.fn() },
    pending: false,
  }),
}));

const templateList = vi.hoisted(() => ({ templates: [] as unknown[] }));
vi.mock("@/features/agent-templates/hooks/use-agent-templates", () => ({
  useAgentTemplates: () => ({
    templates: templateList.templates,
    loading: false,
    error: null,
    resolved: true,
    refetch: () => {},
  }),
}));

import { ChannelsV2Composer } from "./composer";
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
    approveTemplate: vi.fn().mockResolvedValue({ ok: true }),
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
  templateList.templates = [];
});

/**
 * The accessible name of one option row, as a pattern.
 *
 * ⚠ `\s*`, NOT A LITERAL SPACE, AND THAT IS NOT A LOOSENING. `MenuItem` puts the
 * label and the marker in two `display:block` spans; jsdom loads no stylesheet,
 * so the accessible-name algorithm sees them as INLINE and joins them with no
 * separator ("Code auditorby Diana Taylor") where a browser inserts one. The
 * pattern is anchored at both ends, so it still fails on a missing marker, a
 * reordered one, or extra text.
 */
const NAME_RE = (label: string, marker: string) =>
  new RegExp(`^${label}\\s*${marker}$`);

/** Open the Bot panel and its Template menu; returns nothing — assert on roles. */
async function openTemplateMenu() {
  render(
    <ChannelsV2Composer
      channelId={CHANNEL_ID}
      workspaceId="ws-1"
      members={MEMBERS}
      currentUserId={ME}
      gate={{ begin: vi.fn(), end: vi.fn() }}
      newAgent={launcher()}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
  await waitFor(() =>
    expect((screen.getByLabelText("Agent name") as HTMLInputElement).value).toBe(
      `Agent #${MINTED}`
    )
  );
  fireEvent.click(screen.getByRole("button", { name: "Agent template" }));
}

describe("the launch panel's Template row carries the authorship marker", () => {
  it("names the AUTHOR of a template this operator did not write", async () => {
    templateList.templates = [
      { id: "tpl-1", name: "Code auditor", workspaceId: "ws-1", createdBy: PEER },
    ];
    await openTemplateMenu();

    // The marker is IN the accessible name, before the choice is made.
    expect(
      await screen.findByRole("menuitem", { name: NAME_RE("Code auditor", "by Diana Taylor") })
    ).toBeTruthy();
  });

  it("still marks a template whose author the CHANNEL roster cannot name", async () => {
    // The author is a workspace member outside this channel — no name, and the
    // marker must NOT disappear. UNKNOWN is not MINE.
    templateList.templates = [
      {
        id: "tpl-2",
        name: "Release notes",
        workspaceId: "ws-1",
        createdBy: OFF_CHANNEL,
      },
    ];
    await openTemplateMenu();

    expect(
      await screen.findByRole("menuitem", { name: NAME_RE("Release notes", "by another member") })
    ).toBeTruthy();
  });

  it("marks a template whose author has LEFT the workspace (createdBy null)", async () => {
    templateList.templates = [
      { id: "tpl-3", name: "Orphan", workspaceId: "ws-1", createdBy: null },
    ];
    await openTemplateMenu();

    expect(
      await screen.findByRole("menuitem", { name: NAME_RE("Orphan", "by another member") })
    ).toBeTruthy();
  });

  it("wears NO marker on this operator's OWN template", async () => {
    // A marker over your own configuration is the noise that stops markers
    // being read — so the absence here is load-bearing, not an omission.
    templateList.templates = [
      { id: "tpl-4", name: "My auditor", workspaceId: "ws-1", createdBy: ME },
    ];
    await openTemplateMenu();

    expect(
      await screen.findByRole("menuitem", { name: /^My auditor$/ })
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /by /i })).toBeNull();
  });

  it("leaves Blank agent unmarked — it is a configuration, not somebody's text", async () => {
    templateList.templates = [
      { id: "tpl-5", name: "Code auditor", workspaceId: "ws-1", createdBy: PEER },
    ];
    await openTemplateMenu();

    expect(
      await screen.findByRole("menuitem", { name: "Blank agent" })
    ).toBeTruthy();
  });
});
