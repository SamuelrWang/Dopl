/**
 * THE SAVE PAYLOAD, pinned away from the modal.
 *
 * These are the properties that fail QUIETLY: a body that carries `model: ""`
 * instead of omitting it, a stale `teamIds` grant riding a scope the operator
 * left (which the schema REFUSES with a 400, not a shrug), a
 * PATCH that sends every field back and reverts whatever moved under an open
 * editor. None of them throws, and all three are wrong on the server.
 */

import { describe, expect, it } from "vitest";
import type { AgentIdentity, IdentityKnowledgeRef } from "../client/types";
import {
  cleanFields,
  draftFromIdentity,
  draftToCreateBody,
  draftToPatchBody,
  emptyDraft,
  isDraftSavable,
  isEmptyPatch,
  optimisticIdentity,
} from "./identity-draft";

/** ⚠ THE THREE SHAPES, minted the way the picker mints them — a ref carries its
 *  own label, which is what removed `optimisticIdentity`'s name lookup. */
function ref(baseId: string, baseName: string): IdentityKnowledgeRef {
  return { baseId, baseName, scope: "base", path: baseName };
}
function folderRef(
  baseId: string,
  baseName: string,
  folderId: string,
  folderName: string
): IdentityKnowledgeRef {
  return {
    baseId,
    baseName,
    scope: "folder",
    folderId,
    folderName,
    path: `${baseName} / ${folderName}`,
    toolPath: folderName,
  };
}
function entryRef(
  baseId: string,
  baseName: string,
  entryId: string,
  entryTitle: string
): IdentityKnowledgeRef {
  return {
    baseId,
    baseName,
    scope: "entry",
    entryId,
    entryTitle,
    path: `${baseName} / ${entryTitle}`,
    toolPath: entryTitle,
  };
}

function identity(over: Partial<AgentIdentity> = {}): AgentIdentity {
  return {
    id: "id-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: "Runs the release checklist",
    instructions: "Be terse.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "dopl" }],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [{ id: "kb-1", name: "Runbooks" }],
    knowledge: [ref("kb-1", "Runbooks")],
    createdBy: "user-1",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...over,
  };
}

describe("draftToCreateBody", () => {
  it("sends the name and the scope, and OMITS every empty optional", () => {
    // ⚠ `model: ""` is the Default sentinel this tree deliberately does not
    // have — absence IS Default (channels/lib/agent-models.ts).
    expect(draftToCreateBody({ ...emptyDraft(), name: "  Scout  " })).toEqual({
      name: "Scout",
      visibility: "private",
    });
  });

  it("carries instructions, model, fields and knowledge bases when set", () => {
    const body = draftToCreateBody({
      ...emptyDraft(),
      name: "Scout",
      description: "Finds things",
      instructions: "Search first.",
      model: "claude-sonnet-5",
      fields: [{ key: "repo", value: "dopl" }],
      // ⚠ ONE OF EACH SHAPE. The body must carry `knowledge` and NEVER
      // `knowledgeBaseIds` — the schema refuses both keys in one request, and a
      // folder scope cannot be spelled in the older one at all.
      knowledge: [
        ref("kb-1", "Runbooks"),
        folderRef("kb-1", "Runbooks", "f-1", "Deploys"),
        entryRef("kb-2", "Specs", "e-1", "Rollback"),
      ],
    });
    expect(body).toEqual({
      name: "Scout",
      visibility: "private",
      description: "Finds things",
      instructions: "Search first.",
      model: "claude-sonnet-5",
      fields: [{ key: "repo", value: "dopl" }],
      knowledge: [
        { baseId: "kb-1", scope: "base" },
        { baseId: "kb-1", scope: "folder", folderId: "f-1" },
        { baseId: "kb-2", scope: "entry", entryId: "e-1" },
      ],
    });
    expect(body).not.toHaveProperty("knowledgeBaseIds");
  });

  it("sends teamIds ONLY on the team scope", () => {
    // ⚠ Not a tidiness rule: `../schema.ts` REFUSES `teamIds` without
    // `visibility: "team"` ("teamIds requires visibility 'team'"), so a stale
    // set on a private identity is a 400, not a harmless extra key.
    const draft = { ...emptyDraft(), name: "Scout", teamIds: ["team-1"] };
    expect(draftToCreateBody({ ...draft, visibility: "private" }).teamIds).toBeUndefined();
    expect(draftToCreateBody({ ...draft, visibility: "workspace" }).teamIds).toBeUndefined();
    expect(draftToCreateBody({ ...draft, visibility: "team" }).teamIds).toEqual(["team-1"]);
  });

  it("drops a field row whose KEY is blank and keeps a blank VALUE", () => {
    expect(
      cleanFields([
        { key: " repo ", value: "dopl" },
        { key: "", value: "orphan" },
        { key: "flag", value: "" },
      ])
    ).toEqual([
      { key: "repo", value: "dopl" },
      { key: "flag", value: "" },
    ]);
  });
});

describe("draftToPatchBody", () => {
  it("sends ONLY what changed", () => {
    const row = identity();
    const draft = { ...draftFromIdentity(row), name: "Release pilot" };
    expect(draftToPatchBody(draft, row)).toEqual({ name: "Release pilot" });
  });

  it("is empty when nothing was edited", () => {
    const row = identity();
    expect(isEmptyPatch(draftToPatchBody(draftFromIdentity(row), row))).toBe(true);
  });

  it("sends an EMPTIED optional as null — clearing is an edit, not an omission", () => {
    // ⚠ `null`, not `""`: the schema's own split (absent leaves the column
    // alone, null CLEARS it), and for `model` it is not even a choice — that
    // field is a `safeLabel` carrying a `.min(1)`, so `""` is a 400 on the
    // operator picking Default.
    const row = identity();
    expect(
      draftToPatchBody({ ...draftFromIdentity(row), description: "   " }, row)
    ).toEqual({ description: null });
    expect(draftToPatchBody({ ...draftFromIdentity(row), model: "" }, row)).toEqual({
      model: null,
    });
  });

  it("sends the scope and the teams together when the scope changes", () => {
    const row = identity();
    const draft = {
      ...draftFromIdentity(row),
      visibility: "team" as const,
      teamIds: ["team-9"],
    };
    expect(draftToPatchBody(draft, row)).toEqual({
      visibility: "team",
      teamIds: ["team-9"],
    });
  });

  it("leaves teamIds OUT when the scope moved away from team", () => {
    const row = identity({ visibility: "team", teamIds: ["team-9"] });
    const draft = {
      ...draftFromIdentity(row),
      visibility: "workspace" as const,
      teamIds: [],
    };
    expect(draftToPatchBody(draft, row)).toEqual({ visibility: "workspace" });
  });

  it("treats knowledge bases as a SET and custom fields as a LIST", () => {
    const row = identity({
      knowledgeBases: [
        { id: "kb-1", name: "Runbooks" },
        { id: "kb-2", name: "Specs" },
      ],
      knowledge: [ref("kb-1", "Runbooks"), ref("kb-2", "Specs")],
      fields: [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
    });
    const before = draftFromIdentity(row);
    // Reordered attachments are the same attachments.
    expect(
      draftToPatchBody({ ...before, knowledge: [...before.knowledge].reverse() }, row)
    ).toEqual({});
    // Reordered rows are an edit — the operator arranged them.
    expect(
      draftToPatchBody({ ...before, fields: [...before.fields].reverse() }, row).fields
    ).toEqual([
      { key: "b", value: "2" },
      { key: "a", value: "1" },
    ]);
  });
});

describe("isDraftSavable", () => {
  it("refuses a nameless identity", () => {
    expect(isDraftSavable({ ...emptyDraft(), name: "   " })).toBe(false);
  });

  it("refuses a Team identity with no team named", () => {
    // A team-scoped identity with no team is visible to nobody — a private
    // identity wearing the wrong label. Fail closed at the button.
    const draft = { ...emptyDraft(), name: "Scout", visibility: "team" as const };
    expect(isDraftSavable(draft)).toBe(false);
    expect(isDraftSavable({ ...draft, teamIds: ["team-1"] })).toBe(true);
  });
});

describe("optimisticIdentity", () => {
  it("names a freshly attached base from the PICKER, not from the round trip", () => {
    // The wire sends ids and answers with names and paths; without the picker's
    // own label the chip would render blank for one frame, which reads as
    // "detached". ⚠ The draft holds REFS since 2026-09-08, so the label rides
    // with the pick and the `id → name` lookup this case used to take is gone.
    const row = identity({ knowledgeBases: [], knowledge: [] });
    const draft = { ...draftFromIdentity(row), knowledge: [ref("kb-7", "Playbooks")] };
    expect(optimisticIdentity(row, draft).knowledgeBases).toEqual([
      { id: "kb-7", name: "Playbooks" },
    ]);
  });

  it("keeps a folder scope out of the BASE-LEVEL slice", () => {
    // 🔒 Listing the base because one folder of it is attached would be a WIDER
    // claim than the row makes — an older reader would be told the whole base
    // is attached. The scope is in `knowledge`; the slice stays empty.
    const row = identity({ knowledgeBases: [], knowledge: [] });
    const draft = {
      ...draftFromIdentity(row),
      knowledge: [folderRef("kb-7", "Playbooks", "f-2", "Runbooks")],
    };
    const next = optimisticIdentity(row, draft);
    expect(next.knowledgeBases).toEqual([]);
    expect(next.knowledge).toHaveLength(1);
    expect(next.knowledge?.[0]?.folderId).toBe("f-2");
  });

  /**
   * 🔒 §8 STALE CACHE — the fixture WITHOUT the key. A row cached by the bundle
   * before scopes shipped has no `knowledge`, and `draftFromIdentity` mapping
   * over `undefined` would throw and blank the editor. `EMPTY_KNOWLEDGE` is the
   * honest reading of "not sent".
   */
  it("survives a row cached before `knowledge` existed", () => {
    const row = identity({ knowledgeBases: [{ id: "kb-1", name: "Runbooks" }] });
    delete (row as { knowledge?: unknown }).knowledge;
    const draft = draftFromIdentity(row);
    expect(draft.knowledge).toEqual([]);
    expect(optimisticIdentity(row, draft).knowledgeBases).toEqual([]);
  });

  it("empties an emptied optional to null, and drops the teams off a non-team scope", () => {
    const row = identity({ visibility: "team", teamIds: ["team-9"] });
    const draft = {
      ...draftFromIdentity(row),
      description: "",
      visibility: "private" as const,
      teamIds: [],
    };
    const next = optimisticIdentity(row, draft);
    expect(next.description).toBeNull();
    expect(next.teamIds).toEqual([]);
    expect(next.visibility).toBe("private");
  });
});

// ⚠ **THE `containerCopyDraft` BLOCK (FIVE CASES) IS DELETED HERE, 2026-09-02**
// (wave B slice B15, Samuel's ruling B11: *grants replace copies*). It pinned
// what the "Use in this channel" COPY carried and dropped — the forced
// `workspace` visibility, the cleared teams and knowledge bases, the unsuffixed
// name, and the absence of any back-pointer. **None of it has a successor
// assertion**: the control is a GRANT now
// (`apps/desktop-ui/src/pages/home/agent-share.tsx`), it composes no draft at
// all, and what it writes is pinned in
// `apps/desktop-ui/src/pages/home/identity-authoring.test.tsx › share into this
// channel`. The rest of this file — the shared editor draft — is untouched.

