/**
 * The /home card's "Add knowledge" popup rides the editor's own picker and save
 * (P9-02/03/04): a lost race reads the editor's sentence, the tree gets the
 * picker's arrow keys, and a failed or pending base read is never "Loading…"
 * forever or "no knowledge".
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentIdentityApiError } from "@/features/agent-identities/client/api";
import type { AgentIdentity } from "@/features/agent-identities/client/types";

const writes = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), pending: false },
  update: { mutateAsync: vi.fn(), pending: false },
  remove: { mutateAsync: vi.fn(), pending: false },
}));
vi.mock("@/features/agent-identities/hooks/use-agent-identity-writes", () => ({
  useAgentIdentityWrites: () => writes,
}));

const bases = vi.hoisted(() => ({
  result: {} as { data: unknown; status: string; refetch: () => void },
}));
vi.mock("@/features/knowledge/client/hooks", async () => ({
  useKnowledgeBaseList: () => bases.result,
  useKnowledgeTree: (await import("@/features/agent-identities/components/knowledge-tree-mock"))
    .useKnowledgeTree,
}));

import { IdentityKnowledgeDialog } from "./identity-card-knowledge";

const IDENTITY: AgentIdentity = {
  id: "tpl-1",
  workspaceId: "ws-home",
  name: "Scout",
  description: null,
  instructions: null,
  model: null,
  fields: [],
  visibility: "private",
  teamIds: [],
  knowledgeBases: [],
  knowledge: [],
  createdBy: "user-1",
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
};

const ready = (list: Array<{ id: string; name: string }>) => ({
  data: { bases: list },
  status: "success",
  refetch: vi.fn(),
});

/** ⚠ `await`ed because the dialog shell mounts a FRAME after it opens. */
async function open() {
  const onClose = vi.fn();
  render(<IdentityKnowledgeDialog identity={IDENTITY} workspaceId="ws-home" onClose={onClose} />);
  await screen.findByRole("dialog");
  return { onClose };
}

beforeEach(() => {
  for (const w of Object.values(writes)) w.mutateAsync.mockReset();
  bases.result = ready([
    { id: "kb-1", name: "Runbooks" },
    { id: "kb-2", name: "Specs" },
  ]);
});
afterEach(cleanup);

describe("the card's knowledge popup", () => {
  it("saves through the editor's save: the whole set, under the version it opened on", async () => {
    const { onClose } = await open();
    fireEvent.click(await screen.findByRole("treeitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const call = writes.update.mutateAsync.mock.calls[0][0];
    expect(call.body).toEqual({ knowledge: [{ baseId: "kb-2", scope: "base" }] });
    expect(call.expectedUpdatedAt).toBe(IDENTITY.updatedAt);
  });

  it("an unchanged set sends nothing and closes", async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(writes.update.mutateAsync).not.toHaveBeenCalled();
  });

  it("a lost race reads the editor's sentence, never the agent-facing one (P9-02)", async () => {
    writes.update.mutateAsync.mockRejectedValueOnce(
      new AgentIdentityApiError(412, "AGENT_IDENTITY_STALE_VERSION", "Stale write rejected — row was modified at X.")
    );
    await open();
    fireEvent.click(await screen.findByRole("treeitem", { name: "Specs" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This identity changed elsewhere. Reopen it to see the current version."
    );
  });

  it("the tree takes the picker's arrow keys (P9-03)", async () => {
    await open();
    const rows = await screen.findAllByRole("treeitem");
    rows[0].focus();
    fireEvent.keyDown(screen.getByRole("tree"), { key: "ArrowDown" });
    expect(document.activeElement).toBe(rows[1]);
  });

  it("a FAILED base read says so with a retry — not 'Loading…' forever (P9-04)", async () => {
    const refetch = vi.fn();
    bases.result = { data: null, status: "error", refetch };
    await open();
    expect(screen.queryByText(/Loading/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load knowledge.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("a PENDING base read is not 'no knowledge here' (P9-04)", async () => {
    bases.result = { data: null, status: "loading", refetch: vi.fn() };
    await open();
    expect(screen.queryByText("No knowledge here yet.")).toBeNull();
    expect(screen.queryByRole("tree")).toBeNull();
  });
});
