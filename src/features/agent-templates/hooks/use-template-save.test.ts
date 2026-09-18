// @vitest-environment jsdom
/**
 * **THE ONE SAVE ORCHESTRATION BEHIND BOTH AUTHORING SURFACES** (P18, collapsed 2026-09-17).
 *
 * ⚠ **PINNED HERE AND NOT ON EITHER HOST**, because what this file is about is the half both
 * hosts now share. What each host ADDS is still pinned where it is decided —
 * `pages/home/agent-authoring.test.tsx` owns `homeScoped` and G16's `acknowledgeShared`.
 *
 * MUTATION-VERIFY: spread `extras.patch` INTO the body before `isEmptyPatch` and the
 * no-op-with-an-acknowledgement case sends a PATCH; call `onDone` outside the `try` and the
 * failure case closes the dialog.
 */

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { AgentTemplate } from "../client/types";
import { draftFromTemplate } from "../lib/template-draft";

const writes = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), pending: false },
  update: { mutateAsync: vi.fn(), pending: false },
  remove: { mutateAsync: vi.fn(), pending: false },
}));
vi.mock("./use-agent-template-writes", () => ({
  useAgentTemplateWrites: () => writes,
}));

import { useTemplateSave } from "./use-template-save";

const TEMPLATE: AgentTemplate = {
  id: "tpl-1",
  workspaceId: "ws-1",
  name: "Release captain",
  description: "Runs the release checklist",
  instructions: "Be terse.",
  model: "claude-opus-5",
  fields: [],
  visibility: "private",
  teamIds: [],
  knowledgeBases: [],
  knowledge: [],
  createdBy: "user-1",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

function mount(over: Partial<Parameters<typeof useTemplateSave>[0]> = {}) {
  const onDone = vi.fn();
  const view = renderHook(() =>
    useTemplateSave({
      workspaceId: "ws-1",
      shelf: "workspace",
      noun: "template",
      onDone,
      ...over,
    })
  );
  return { ...view, onDone };
}

describe("creating", () => {
  it("sends the draft's create body plus whatever the HOST adds", async () => {
    const { result } = mount({
      noun: "agent",
      extras: () => ({ create: { homeScoped: true } }),
    });
    await act(async () => {
      await result.current.save({ ...draftFromTemplate(TEMPLATE), name: "Scout" }, null);
    });
    expect(writes.create.mutateAsync).toHaveBeenCalledWith({
      body: expect.objectContaining({ name: "Scout", homeScoped: true }),
    });
  });
});

describe("patching", () => {
  it("skips a PATCH that moves no column — Save means 'I'm done', not 'write something'", async () => {
    const { result, onDone } = mount();
    await act(async () => {
      await result.current.save(draftFromTemplate(TEMPLATE), TEMPLATE);
    });
    expect(writes.update.mutateAsync).not.toHaveBeenCalled();
    // ⚠ AND THE DIALOG STILL CLOSES: nothing failed.
    expect(onDone).toHaveBeenCalled();
  });

  /** 🔒 F-404's CLASS, and the rule that lived in ONE of the two copies until P18. */
  it("🔒 an acknowledgement alone is NOT a change — still no PATCH", async () => {
    const { result } = mount({
      extras: () => ({ patch: { acknowledgeShared: true } }),
    });
    await act(async () => {
      await result.current.save(draftFromTemplate(TEMPLATE), TEMPLATE);
    });
    expect(writes.update.mutateAsync).not.toHaveBeenCalled();
  });

  it("rides the acknowledgement along a REAL change, with the optimistic row", async () => {
    const { result } = mount({
      extras: () => ({ patch: { acknowledgeShared: true } }),
    });
    await act(async () => {
      await result.current.save(
        { ...draftFromTemplate(TEMPLATE), name: "Renamed" },
        TEMPLATE
      );
    });
    const call = writes.update.mutateAsync.mock.calls.at(-1)![0];
    expect(call.templateId).toBe("tpl-1");
    expect(call.body).toEqual({ name: "Renamed", acknowledgeShared: true });
    expect(call.optimistic).toMatchObject({ id: "tpl-1", name: "Renamed" });
  });
});

describe("when the write fails", () => {
  it("🔒 falls back to the host's OWN noun and leaves the dialog open", async () => {
    // ⚠ A WORDLESS REJECTION is what reaches the fallback — `agentTemplateErrorMessage`
    // prefers the server's own sentence whenever there is one.
    writes.create.mutateAsync.mockRejectedValueOnce({});
    const { result, onDone } = mount({ noun: "agent" });
    await act(async () => {
      await result.current.save({ ...draftFromTemplate(TEMPLATE), name: "Scout" }, null);
    });
    expect(result.current.error).toMatch(/Couldn't save the agent/);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("deletes through the same path, and refuses a delete with no row", async () => {
    const { result, onDone } = mount();
    await act(async () => {
      await result.current.remove(null);
    });
    expect(writes.remove.mutateAsync).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.remove(TEMPLATE);
    });
    expect(writes.remove.mutateAsync).toHaveBeenCalledWith({ templateId: "tpl-1" });
    expect(onDone).toHaveBeenCalled();
  });
});
