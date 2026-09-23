// @vitest-environment jsdom
/**
 * **THE ONE SAVE ORCHESTRATION BEHIND BOTH AUTHORING SURFACES** (P18, collapsed 2026-09-17).
 *
 * ⚠ **PINNED HERE AND NOT ON EITHER HOST**, because what this file is about is the half both
 * hosts now share. What each host ADDS is still pinned where it is decided —
 * `pages/home/identity-authoring.test.tsx` owns `homeScoped` and G16's `acknowledgeShared`.
 *
 * MUTATION-VERIFY: spread `extras.patch` INTO the body before `isEmptyPatch` and the
 * no-op-with-an-acknowledgement case sends a PATCH; call `onDone` outside the `try` and the
 * failure case closes the dialog.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { AgentIdentityApiError } from "../client/api";
import type { AgentIdentity } from "../client/types";
import { draftFromIdentity } from "../lib/identity-draft";

const writes = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), pending: false },
  update: { mutateAsync: vi.fn(), pending: false },
  remove: { mutateAsync: vi.fn(), pending: false },
}));
vi.mock("./use-agent-identity-writes", () => ({
  useAgentIdentityWrites: () => writes,
}));

import { useIdentitySave } from "./use-identity-save";

// The hoisted mocks outlive a case; without a reset the "no PATCH" cases pass only
// when they happen to run first (T2-03).
beforeEach(() => {
  for (const w of Object.values(writes)) w.mutateAsync.mockReset();
});

const IDENTITY: AgentIdentity = {
  id: "id-1",
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

function mount(over: Partial<Parameters<typeof useIdentitySave>[0]> = {}) {
  const onDone = vi.fn();
  const view = renderHook(() =>
    useIdentitySave({
      workspaceId: "ws-1",
      shelf: "workspace",
      noun: "identity",
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
      await result.current.save({ ...draftFromIdentity(IDENTITY), name: "Scout" }, null);
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
      await result.current.save(draftFromIdentity(IDENTITY), IDENTITY);
    });
    expect(writes.update.mutateAsync).not.toHaveBeenCalled();
    // ⚠ AND THE DIALOG STILL CLOSES: nothing failed.
    expect(onDone).toHaveBeenCalled();
  });

  /** 🔒 F-404's CLASS, and the rule that lived in ONE of the two copies until P18. */
  it("an acknowledgement alone is NOT a change — still no PATCH", async () => {
    const { result } = mount({
      extras: () => ({ patch: { acknowledgeShared: true } }),
    });
    await act(async () => {
      await result.current.save(draftFromIdentity(IDENTITY), IDENTITY);
    });
    expect(writes.update.mutateAsync).not.toHaveBeenCalled();
  });

  it("rides the acknowledgement along a REAL change, with the optimistic row", async () => {
    const { result } = mount({
      extras: () => ({ patch: { acknowledgeShared: true } }),
    });
    await act(async () => {
      await result.current.save(
        { ...draftFromIdentity(IDENTITY), name: "Renamed" },
        IDENTITY
      );
    });
    const call = writes.update.mutateAsync.mock.calls[0][0];
    expect(call.identityId).toBe("id-1");
    expect(call.body).toEqual({ name: "Renamed", acknowledgeShared: true });
    expect(call.optimistic).toMatchObject({ id: "id-1", name: "Renamed" });
  });

  /**
   * 🔒 **THE EDITOR SAVES UNDER THE VERSION IT WAS OPENED ON** (F-747,
   * 2026-09-18). Both authoring surfaces run through this one function, so this
   * case is what makes the app's half of the precondition true on BOTH of them.
   */
  it("carries the loaded row's `updatedAt` as the write's precondition", async () => {
    const { result } = mount();
    await act(async () => {
      await result.current.save(
        { ...draftFromIdentity(IDENTITY), name: "Renamed" },
        IDENTITY
      );
    });
    const call = writes.update.mutateAsync.mock.calls[0][0];
    expect(call.expectedUpdatedAt).toBe("2026-08-01T00:00:00Z");
  });
});

describe("when the write fails", () => {
  it("falls back to the host's OWN noun and leaves the dialog open", async () => {
    // ⚠ A WORDLESS REJECTION is what reaches the fallback — `agentIdentityErrorMessage`
    // prefers the server's own sentence whenever there is one.
    writes.create.mutateAsync.mockRejectedValueOnce({});
    const { result, onDone } = mount({ noun: "agent" });
    await act(async () => {
      await result.current.save({ ...draftFromIdentity(IDENTITY), name: "Scout" }, null);
    });
    expect(result.current.error).toMatch(/Couldn't save the agent/);
    expect(onDone).not.toHaveBeenCalled();
  });

  /**
   * ⚠ **THE 412 GETS THE EDITOR'S OWN SENTENCE**, not the server's — that one
   * ("Stale write rejected — row was modified at …") is written for an agent
   * reconciling two bodies. ⚠ AND THE DIALOG STAYS OPEN, because the operator's
   * typing is the only copy of it left once the optimistic patch rolled back.
   */
  it("says the row changed elsewhere on a conflict, in the host's own noun", async () => {
    writes.update.mutateAsync.mockRejectedValueOnce(
      new AgentIdentityApiError(412, "AGENT_IDENTITY_STALE_VERSION", "Stale write rejected — row was modified at X.")
    );
    const { result, onDone } = mount({ noun: "agent" });
    await act(async () => {
      await result.current.save(
        { ...draftFromIdentity(IDENTITY), name: "Renamed" },
        IDENTITY
      );
    });
    expect(result.current.error).toBe(
      "This agent changed elsewhere. Reopen it to see the current version."
    );
    expect(result.current.error).not.toMatch(/Stale write rejected/);
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
      await result.current.remove(IDENTITY);
    });
    expect(writes.remove.mutateAsync).toHaveBeenCalledWith({ identityId: "id-1" });
    expect(onDone).toHaveBeenCalled();
  });
});
