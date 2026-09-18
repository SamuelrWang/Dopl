/**
 * 🔒 **F-719 — A SLUG THAT NAMES TWO CONTAINERS IS REFUSED, NOT PICKED**
 * (Samuel ruled YES, 2026-09-17).
 *
 * `workspaces.slug` has NO uniqueness constraint — `20260504000000_workspaces_
 * public_id.sql` dropped it deliberately — and R-32 then made a slug an
 * ADDRESS. So a caller can see two rows spelled the same (a home channel a PEER
 * minted and named, against their own workspace) and `Array.find` picked
 * whichever it reached first, silently. This is F-701's fix one table over.
 *
 * Four claims:
 *   1. TWO VISIBLE ROWS → REFUSAL, naming BOTH ids and kinds, picking neither;
 *   2. ONE visible row → resolves, byte-identically to before;
 *   3. ⚠ **THE FENCE IS WHAT THE CALLER CAN SEE** — a slug ambiguous
 *      account-wide but naming one row in THIS caller's directory resolves;
 *   4. an ID never ties, which is the escape hatch the refusal points at.
 */

import { describe, it, expect, vi } from "vitest";
import type { DoplClient, WorkspaceListItem } from "@dopl/client";
import {
  createWorkspaceDirectory,
  isAmbiguousContainer,
} from "./workspace-directory.js";
import { resolveCallAddress } from "./container-resolve.js";

function wsItem(
  id: string,
  slug: string,
  name: string,
  kind: "standard" | "link" | "personal",
): WorkspaceListItem {
  return {
    id,
    ownerId: "owner",
    name,
    slug,
    publicId: `pub-${id}`,
    description: null,
    kind,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    role: "owner",
  };
}

/** ⚠ ONE SLUG, TWO ROWS, AND NEITHER IS A MISTAKE: `ops` is this caller's own
 *  workspace, and `ops` is also the room a peer minted and named. */
const MINE = wsItem("id-ws-ops", "ops", "Ops", "standard");
const THEIRS = wsItem("id-room-ops", "ops", "Ops", "link");
const HOME = wsItem("id-home", "sam", "Sam", "personal");

function client(directory: WorkspaceListItem[]): DoplClient {
  return {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces: directory }),
  } as unknown as DoplClient;
}

const directoryOf = (rows: WorkspaceListItem[]) =>
  createWorkspaceDirectory(client(rows), { directory: rows });

/** The refusal an addressed call actually renders, through the ONE resolver. */
async function addressWith(rows: WorkspaceListItem[], container: string) {
  const outcome = await resolveCallAddress(
    "dopl_kb",
    "list_bases",
    { container },
    { directory: directoryOf(rows), activeWorkspace: null },
  );
  return outcome;
}

const textOf = (r: { content: Array<{ text: string }> }) =>
  r.content.map((c) => c.text).join("");

describe("an ambiguous container slug refuses and names every candidate", () => {
  it("TWO visible rows → refusal, both ids, both kinds, and nothing picked", async () => {
    const resolved = await directoryOf([MINE, THEIRS, HOME]).resolveContainerRef(
      "ops",
    );
    expect(resolved).not.toBeNull();
    expect(isAmbiguousContainer(resolved!)).toBe(true);
    // ⚠ Id-ordered, so a caller re-reading the refusal can act on "the second".
    expect(
      isAmbiguousContainer(resolved!) ? resolved.ambiguous.map((w) => w.id) : [],
    ).toEqual(["id-room-ops", "id-ws-ops"]);
  });

  it("the CALL refuses, in `dopl_kb`'s own `ambiguous_slug` shape", async () => {
    const outcome = await addressWith([MINE, THEIRS, HOME], "ops");
    expect(outcome.kind).toBe("refusal");
    const text =
      outcome.kind === "refusal" ? textOf(outcome.response) : "(not a refusal)";
    // ⚠ **THE SAME LITERAL `dopl_kb` TEACHES** — the whole mechanism is string
    // equality between the description and the wire, so a paraphrase here is a
    // remedy the agent can never match.
    expect(text).toContain("reason=ambiguous_slug");
    expect(text).toContain("retry=use the id");
    // ⚠ THE LIST IS THE WHOLE VALUE: both ids, and the kind that tells a room
    // from a workspace.
    expect(text).toContain("`id-ws-ops`");
    expect(text).toContain("`id-room-ops`");
    expect(text).toContain("kind=`workspace`");
    expect(text).toContain("kind=`home_channel`");
    // ⚠ And it PICKED NOTHING — a refusal that also ran is the defect.
    expect(outcome.kind).not.toBe("addressed");
  });

  it("ONE visible row resolves — the happy path is untouched", async () => {
    const resolved = await directoryOf([MINE, HOME]).resolveContainerRef("ops");
    expect(resolved).toEqual(MINE);
    const outcome = await addressWith([MINE, HOME], "ops");
    expect(outcome.kind).toBe("addressed");
    expect(outcome.kind === "addressed" && outcome.effective.id).toBe("id-ws-ops");
  });

  it("🔒 ambiguous GLOBALLY but ONE row visible here → resolves", async () => {
    // ⚠ **THE FENCE IS WHAT THE CALLER CAN SEE, NOT WHAT EXISTS.** Somebody
    // else's `ops` is a row this caller is not a member of, so it never reaches
    // the directory — and refusing on its account would leak its existence.
    const outcome = await addressWith([THEIRS, HOME], "ops");
    expect(outcome.kind).toBe("addressed");
    expect(outcome.kind === "addressed" && outcome.effective.id).toBe("id-room-ops");
    expect(outcome.kind === "addressed" && outcome.effective.kind).toBe(
      "home_channel",
    );
  });

  it("a LOCKED session sees one row, so the same slug resolves", async () => {
    // 🔒 The container lock narrows the directory before the match runs, so the
    // tie cannot exist for a session that can only see one container.
    const locked = createWorkspaceDirectory(client([MINE, THEIRS, HOME]), {
      directory: [MINE, THEIRS, HOME],
      lockedTo: THEIRS,
    });
    expect(await locked.resolveContainerRef("ops")).toEqual(THEIRS);
  });

  it("an ID never ties — it is the remedy the refusal hands back", async () => {
    const d = directoryOf([MINE, THEIRS, HOME]);
    expect(await d.resolveContainerRef("id-ws-ops")).toEqual(MINE);
    expect(await d.resolveContainerRef("id-room-ops")).toEqual(THEIRS);
    const outcome = await addressWith([MINE, THEIRS, HOME], "id-room-ops");
    expect(outcome.kind).toBe("addressed");
  });

  it("refuses on the DEPRECATED alias too, and names the arg the caller sent", async () => {
    const outcome = await resolveCallAddress(
      "dopl_kb",
      "list_bases",
      { workspace: "ops" },
      { directory: directoryOf([MINE, THEIRS, HOME]), activeWorkspace: null },
    );
    expect(outcome.kind).toBe("refusal");
    const text = outcome.kind === "refusal" ? textOf(outcome.response) : "";
    expect(text).toContain("reason=ambiguous_slug");
    // ⚠ A remedy naming an argument the caller did not send is a dead end.
    expect(text).toContain("`workspace=<id>`");
  });
});
