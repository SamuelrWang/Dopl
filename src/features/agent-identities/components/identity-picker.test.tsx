// @vitest-environment jsdom
// The picker chooses an identity and starts nothing; the wiring that opens the prefilled launch
// popup is pinned in `channels/components/agents-tab-launch.test.tsx`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { fileURLToPath } from "node:url";
import { readCode } from "@/shared/testing/source-text";
import type { AgentIdentity } from "../client/types";
import { identity as blankIdentity } from "./identity-editor-harness";

let identities: AgentIdentity[] = [];
let listError: unknown = null;
let listLoading = false;

vi.mock("../hooks/use-agent-identities", () => ({
  useAgentIdentities: () => ({
    identities,
    loading: listLoading,
    error: listError,
    refetch: () => {},
  }),
}));

const { IdentityLaunchPicker, authorMarker, SEARCH_THRESHOLD } = await import(
  "./identity-picker"
);

const ME = "user-me";
const THEM = "user-them";

const identity = (over: Partial<AgentIdentity> = {}) =>
  blankIdentity({
    name: "Code auditor",
    instructions: "Audit the diff. Report findings.",
    model: "claude-opus-5",
    createdBy: ME,
    ...over,
  });

const NAMES = new Map([
  [ME, "Sam Wang"],
  [THEM, "Diana Taylor"],
]);

function mount(
  over: Partial<React.ComponentProps<typeof IdentityLaunchPicker>> = {}
) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <IdentityLaunchPicker
      open
      at={{ x: 0, y: 0 }}
      onClose={onClose}
      workspaceId="ws-1"
      currentUserId={ME}
      memberNames={NAMES}
      onPick={onPick}
      {...over}
    />
  );
  return { onPick, onClose };
}

beforeEach(() => {
  identities = [];
  listError = null;
  listLoading = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("what the popover offers", () => {
  it("puts Blank agent first, focused, and chooses NO identity", () => {
    identities = [identity()];
    const { onPick, onClose } = mount();

    const rows = screen.getAllByRole("menuitem");
    const blank = screen.getByRole("menuitem", { name: /Blank agent/ });
    expect(rows[0]).toBe(blank);
    expect(document.activeElement).toBe(blank);

    fireEvent.click(blank);
    expect(onClose).toHaveBeenCalled();
    // `null` is the blank agent; the popup lands on `None`.
    expect(onPick).toHaveBeenCalledWith(null);
  });

  it("hands a row's WHOLE IDENTITY up, and closes — it starts nothing", () => {
    // The popup prefills from this object (`channels/components/use-agent-launch.ts › applyIdentity`),
    // so handing up only the id would arrive as three empty fields.
    identities = [identity({ id: "id-9" })];
    const { onPick, onClose } = mount();

    fireEvent.click(screen.getByRole("menuitem", { name: /^Launch Code auditor/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onPick).toHaveBeenCalledWith(identities[0]);
  });

  it("offers ONE control per row — the launch-sheet chevron is gone with the sheet", () => {
    // One launch surface (INVARIANTS §5A): a second per-row control would be a second way in.
    identities = [identity({ id: "id-9" })];
    mount();
    expect(
      screen.queryByRole("menuitem", { name: "Launch options for Code auditor" })
    ).toBeNull();
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
  });

  it("renders a model chip only when the identity carries a model", () => {
    identities = [
      identity({ id: "a", name: "With model", model: "claude-opus-5" }),
      identity({ id: "b", name: "No model", model: null }),
    ];
    mount();
    // The chip is the short label; an unset model renders nothing (a row states what an identity
    // carries).
    expect(screen.getByText("Opus")).toBeTruthy();
    expect(screen.queryByText("Default")).toBeNull();
  });

  it("says 'could not ask' rather than 'nothing to show' when the read failed", () => {
    listError = new Error("boom");
    mount();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("No identities yet.")).toBeNull();
  });
});

// A security signal: a shared identity's instructions are another member's text about to run under
// this operator's credential. It must be in the accessible name, not only on the face.
describe("the foreign-authorship marker", () => {
  it("is absent on the operator's own identity", () => {
    identities = [identity({ createdBy: ME })];
    mount();
    const row = screen.getByRole("menuitem", { name: /^Launch Code auditor/ });
    expect(row.getAttribute("aria-label")).toBe("Launch Code auditor");
    expect(screen.queryByText(/^by /)).toBeNull();
  });

  it("names the author on the face AND in the accessible name", () => {
    identities = [identity({ createdBy: THEM, visibility: "team" })];
    mount();
    expect(screen.getByText("by Diana Taylor")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", {
        name: "Launch Code auditor (by Diana Taylor)",
      })
    ).toBeTruthy();
  });

  it("still marks an identity whose author cannot be named — UNKNOWN is not MINE", () => {
    // A member outside this channel's roster and a creator who left (`created_by` SET NULL) read alike.
    expect(authorMarker(identity({ createdBy: "user-ghost" }), ME, NAMES)).toBe(
      "by another member"
    );
    expect(authorMarker(identity({ createdBy: null }), ME, NAMES)).toBe(
      "by another member"
    );
    expect(authorMarker(identity({ createdBy: ME }), ME, NAMES)).toBeNull();
  });
});

describe("grouping and search", () => {
  function named(n: number, over: Partial<AgentIdentity> = {}) {
    return Array.from({ length: n }, (_, i) =>
      identity({ id: `t${i}`, name: `Identity ${i}`, ...over })
    );
  }

  it("renders NO group header when only one scope is non-empty", () => {
    identities = named(3, { visibility: "private" });
    mount();
    expect(screen.queryByText("Private")).toBeNull();
  });

  it("renders headers in SECTIONS order, with 'Public' over the wire's 'workspace'", () => {
    identities = [
      identity({ id: "w", name: "Wide", visibility: "workspace" }),
      identity({ id: "p", name: "Mine", visibility: "private" }),
    ];
    mount();
    const headers = screen
      .getAllByText(/^(Private|Team|Public)$/)
      .map((el) => el.textContent);
    expect(headers).toEqual(["Private", "Public"]);
    expect(screen.queryByText("workspace")).toBeNull();
  });

  it("hides the search field at the threshold and shows it past it", () => {
    identities = named(SEARCH_THRESHOLD);
    mount();
    expect(screen.queryByLabelText("Search identities")).toBeNull();
    cleanup();

    identities = named(SEARCH_THRESHOLD + 1);
    mount();
    expect(screen.getByLabelText("Search identities")).toBeTruthy();
  });

  it("filters on name, and does NOT take its own field away mid-word", () => {
    identities = named(SEARCH_THRESHOLD + 1);
    mount();
    const search = screen.getByLabelText("Search identities");
    fireEvent.change(search, { target: { value: "Identity 3" } });
    expect(screen.getByRole("menuitem", { name: /^Launch Identity 3/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Launch Identity 4/ })).toBeNull();
    // The threshold reads the whole list, never the filtered one.
    expect(screen.getByLabelText("Search identities")).toBeTruthy();
  });
});

// Source read, like `./identity-editor-surface.test.tsx › no concave surfaces`, naming the launch-path
// files explicitly so a narrowed sweep cannot drop them. Code only: docblocks name the banned recipes.
describe("no concave surfaces on the launch path", () => {
  const FILES = ["./identity-picker.tsx", "./identity-approval.tsx", "../lib/launch-overrides.ts"].map(
    (file) => fileURLToPath(new URL(file, import.meta.url))
  );
  const FORBIDDEN = [
    "concave-field",
    "concave-track",
    "auth-field-3d",
    "FIELD_WELL",
    "SECTION_BOX_INSET",
  ];

  it.each(FILES)("%s wears no pressed-in recipe", (file) => {
    const code = readCode(file);
    for (const forbidden of FORBIDDEN) {
      expect(code, `${file} must not use ${forbidden}`).not.toContain(forbidden);
    }
  });
});
