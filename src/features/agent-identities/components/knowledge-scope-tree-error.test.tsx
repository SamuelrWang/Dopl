// @vitest-environment jsdom
// A failed tree read is unknown, not empty (INVARIANTS §11).

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KnowledgeScopePicker } from "./knowledge-scope-picker";

const refetch = vi.hoisted(() => vi.fn());
vi.mock("@/features/knowledge/client/hooks", () => ({
  useKnowledgeTree: (baseId: string | null) =>
    baseId
      ? { data: null, status: "error", error: { status: 403, message: "Forbidden" }, refetch }
      : { data: null, status: "idle", error: null, refetch },
}));

afterEach(cleanup);

describe("a base whose tree read failed", () => {
  it("shows the failure and a retry, not 'Empty'", () => {
    render(
      <KnowledgeScopePicker
        workspaceId="ws-1"
        bases={[{ id: "kb-1", name: "Runbooks" }]}
        selected={[]}
        onChange={vi.fn()}
        emptyLine="No knowledge here yet."
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand Runbooks" }));
    expect(screen.queryByText("Empty")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Forbidden");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
