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
import type { AgentTemplate } from "../client/types";
import {
  cleanFields,
  containerCopyDraft,
  draftFromTemplate,
  draftToCreateBody,
  draftToPatchBody,
  emptyDraft,
  isDraftSavable,
  isEmptyPatch,
  optimisticTemplate,
} from "./template-draft";

function template(over: Partial<AgentTemplate> = {}): AgentTemplate {
  return {
    id: "tpl-1",
    workspaceId: "ws-1",
    name: "Release captain",
    description: "Runs the release checklist",
    instructions: "Be terse.",
    model: "claude-opus-5",
    fields: [{ key: "repo", value: "dopl" }],
    visibility: "private",
    teamIds: [],
    knowledgeBases: [{ id: "kb-1", name: "Runbooks" }],
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
      knowledgeBaseIds: ["kb-1", "kb-2"],
    });
    expect(body).toEqual({
      name: "Scout",
      visibility: "private",
      description: "Finds things",
      instructions: "Search first.",
      model: "claude-sonnet-5",
      fields: [{ key: "repo", value: "dopl" }],
      knowledgeBaseIds: ["kb-1", "kb-2"],
    });
  });

  it("sends teamIds ONLY on the team scope", () => {
    // ⚠ Not a tidiness rule: `../schema.ts` REFUSES `teamIds` without
    // `visibility: "team"` ("teamIds requires visibility 'team'"), so a stale
    // set on a private template is a 400, not a harmless extra key.
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
    const row = template();
    const draft = { ...draftFromTemplate(row), name: "Release pilot" };
    expect(draftToPatchBody(draft, row)).toEqual({ name: "Release pilot" });
  });

  it("is empty when nothing was edited", () => {
    const row = template();
    expect(isEmptyPatch(draftToPatchBody(draftFromTemplate(row), row))).toBe(true);
  });

  it("sends an EMPTIED optional as null — clearing is an edit, not an omission", () => {
    // ⚠ `null`, not `""`: the schema's own split (absent leaves the column
    // alone, null CLEARS it), and for `model` it is not even a choice — that
    // field is a `safeLabel` carrying a `.min(1)`, so `""` is a 400 on the
    // operator picking Default.
    const row = template();
    expect(
      draftToPatchBody({ ...draftFromTemplate(row), description: "   " }, row)
    ).toEqual({ description: null });
    expect(draftToPatchBody({ ...draftFromTemplate(row), model: "" }, row)).toEqual({
      model: null,
    });
  });

  it("sends the scope and the teams together when the scope changes", () => {
    const row = template();
    const draft = {
      ...draftFromTemplate(row),
      visibility: "team" as const,
      teamIds: ["team-9"],
    };
    expect(draftToPatchBody(draft, row)).toEqual({
      visibility: "team",
      teamIds: ["team-9"],
    });
  });

  it("leaves teamIds OUT when the scope moved away from team", () => {
    const row = template({ visibility: "team", teamIds: ["team-9"] });
    const draft = {
      ...draftFromTemplate(row),
      visibility: "workspace" as const,
      teamIds: [],
    };
    expect(draftToPatchBody(draft, row)).toEqual({ visibility: "workspace" });
  });

  it("treats knowledge bases as a SET and custom fields as a LIST", () => {
    const row = template({
      knowledgeBases: [
        { id: "kb-1", name: "Runbooks" },
        { id: "kb-2", name: "Specs" },
      ],
      fields: [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ],
    });
    const before = draftFromTemplate(row);
    // Reordered attachments are the same attachments.
    expect(
      draftToPatchBody({ ...before, knowledgeBaseIds: ["kb-2", "kb-1"] }, row)
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
  it("refuses a nameless template", () => {
    expect(isDraftSavable({ ...emptyDraft(), name: "   " })).toBe(false);
  });

  it("refuses a Team template with no team named", () => {
    // A team-scoped template with no team is visible to nobody — a private
    // template wearing the wrong label. Fail closed at the button.
    const draft = { ...emptyDraft(), name: "Scout", visibility: "team" as const };
    expect(isDraftSavable(draft)).toBe(false);
    expect(isDraftSavable({ ...draft, teamIds: ["team-1"] })).toBe(true);
  });
});

describe("optimisticTemplate", () => {
  const names: Record<string, string> = { "kb-7": "Playbooks" };
  const lookup = (id: string) => names[id];

  it("names a freshly attached base from the PICKER, not from the round trip", () => {
    // The wire sends ids and answers with `{id, name}` pairs; without the
    // picker's own label the chip would render blank for one frame, which reads
    // as "detached".
    const row = template({ knowledgeBases: [] });
    const draft = { ...draftFromTemplate(row), knowledgeBaseIds: ["kb-7"] };
    expect(optimisticTemplate(row, draft, lookup).knowledgeBases).toEqual([
      { id: "kb-7", name: "Playbooks" },
    ]);
  });

  it("falls back to the id rather than to an empty chip", () => {
    const row = template({ knowledgeBases: [] });
    const draft = { ...draftFromTemplate(row), knowledgeBaseIds: ["kb-unknown"] };
    expect(optimisticTemplate(row, draft, lookup).knowledgeBases).toEqual([
      { id: "kb-unknown", name: "kb-unknown" },
    ]);
  });

  it("empties an emptied optional to null, and drops the teams off a non-team scope", () => {
    const row = template({ visibility: "team", teamIds: ["team-9"] });
    const draft = {
      ...draftFromTemplate(row),
      description: "",
      visibility: "private" as const,
      teamIds: [],
    };
    const next = optimisticTemplate(row, draft, lookup);
    expect(next.description).toBeNull();
    expect(next.teamIds).toEqual([]);
    expect(next.visibility).toBe("private");
  });
});

describe("containerCopyDraft — \"Use in this channel\"", () => {
  it("carries what a template IS, and drops the KNOWLEDGE BASES", () => {
    // 🔒 A home-workspace KB id is NOT in the container and the attach gate
    // ("a KB the caller can currently read") would 404 it, so carrying the ids
    // turns a copy into a failed write. The rest of the template rides along —
    // instructions, model and custom fields are what the operator is reusing.
    const body = draftToCreateBody(containerCopyDraft(template()));
    expect(body).toEqual({
      name: "Release captain",
      visibility: "private",
      description: "Runs the release checklist",
      instructions: "Be terse.",
      model: "claude-opus-5",
      fields: [{ key: "repo", value: "dopl" }],
    });
    // ⚠ ABSENT, not `[]` — a create OMITS an empty optional (see the top of this
    // file), and the assertion is spelled out because "the key is missing" is
    // what "cleared" MEANS on this body.
    expect("knowledgeBaseIds" in body).toBe(false);
    expect("teamIds" in body).toBe(false);
  });

  it("FORCES private, even from a template that was shared where it came from", () => {
    // ⚠ The gesture's word is "use". It must never silently PUBLISH the
    // operator's own agent into a container the peer is standing in — sharing it
    // is a second, deliberate edit.
    const source = template({ visibility: "workspace" });
    expect(containerCopyDraft(source).visibility).toBe("private");
    expect(draftToCreateBody(containerCopyDraft(source)).visibility).toBe("private");
  });

  it("clears the TEAMS, which a container has none of anyway", () => {
    // A container has no teams (INVARIANTS §4A), and the schema REFUSES a
    // `teamIds` key without `visibility: 'team'` — so carrying them is a 400,
    // not a harmless extra.
    const source = template({ visibility: "team", teamIds: ["team-9"] });
    expect(containerCopyDraft(source).teamIds).toEqual([]);
  });

  it("keeps the NAME exactly, with no \"(copy)\" suffix", () => {
    // ⚠ Templates have NO name uniqueness, deliberately — there is no unique
    // index and no 409 on the route — so a suffix would be dodging a constraint
    // that does not exist, and renaming the operator's agent to do it.
    expect(containerCopyDraft(template()).name).toBe("Release captain");
    expect(containerCopyDraft(template({ name: "Scout" })).name).toBe("Scout");
  });

  it("is a SNAPSHOT: nothing in the draft points back at the original", () => {
    // No FK, no back-pointer, no sync (precedent: `channel_sessions.template_name`
    // — a denormalized snapshot, and nothing may "fix" that later). The draft is
    // the editor's own six fields and carries no id at all.
    const draft = containerCopyDraft(template());
    expect(Object.values(draft)).not.toContain("tpl-1");
    expect(Object.values(draft)).not.toContain("ws-1");
  });
});
