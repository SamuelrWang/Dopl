// @vitest-environment jsdom
// The save orchestration both authoring surfaces share; what each host adds (`homeScoped`,
// `acknowledgeShared`) is pinned in `apps/desktop-ui/src/pages/home/identity-authoring.test.tsx`.

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

// Hoisted mocks outlive a case; without a reset the "no PATCH" cases pass only when they run first.
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
    // The dialog still closes: nothing failed.
    expect(onDone).toHaveBeenCalled();
  });

  // F-404: the acknowledgement is spread in only after `isEmptyPatch`.
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

  // F-747: both surfaces save under the version they opened on.
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
    // Wordless, because `agentIdentityErrorMessage` prefers the server's sentence when there is one.
    writes.create.mutateAsync.mockRejectedValueOnce({});
    const { result, onDone } = mount({ noun: "agent" });
    await act(async () => {
      await result.current.save({ ...draftFromIdentity(IDENTITY), name: "Scout" }, null);
    });
    expect(result.current.error).toMatch(/Couldn't save the agent/);
    expect(onDone).not.toHaveBeenCalled();
  });

  // The server's 412 sentence is written for an agent; the dialog stays open because the typing is
  // the only copy left once the optimistic patch rolls back.
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
