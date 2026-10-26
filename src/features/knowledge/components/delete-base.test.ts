/**
 * The ONE base-delete flow both delete buttons run (`base-settings-general.tsx`, `base-header.tsx`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];

vi.mock("../client/api", () => ({
  deleteBase: vi.fn(async (id: string, ws: string) => {
    calls.push(`deleteBase:${id}:${ws}`);
  }),
}));
vi.mock("../client/hooks", () => ({
  evictDeletedBase: vi.fn((_qc: unknown, ws: string, id: string) => {
    calls.push(`evict:${ws}:${id}`);
  }),
}));
vi.mock("@/shared/ui/toast", () => ({
  toast: vi.fn((t: { title: string; description?: string }) => {
    calls.push(`toast:${t.title}${t.description ? `|${t.description}` : ""}`);
  }),
}));
vi.mock("@/shared/api/user-facing-message", () => ({
  userFacingMessage: (err: unknown) => `msg(${(err as Error).message})`,
}));

import { deleteBase } from "../client/api";
import { deleteBaseAndLeave } from "./delete-base";

const BASE = { id: "b1", name: "Notes" };
const routing = () => ({
  goToBase: vi.fn((base: unknown, mode: string) => {
    calls.push(`goToBase:${base}:${mode}`);
  }),
  refreshServerData: vi.fn(() => {
    calls.push("refresh");
  }),
});

beforeEach(() => {
  calls.length = 0;
});

describe("deleteBaseAndLeave", () => {
  it("deletes, toasts, evicts the base's cache, drops to the root (replace), re-pulls — in that order", async () => {
    await deleteBaseAndLeave(BASE, "ws1", {} as never, routing());
    expect(calls).toEqual([
      "deleteBase:b1:ws1",
      'toast:"Notes" deleted',
      "evict:ws1:b1",
      "goToBase:null:replace",
      "refresh",
    ]);
  });

  it("a failed delete toasts the reason, never throws, and does not navigate or evict", async () => {
    vi.mocked(deleteBase).mockRejectedValueOnce(new Error("nope"));
    await expect(deleteBaseAndLeave(BASE, "ws1", {} as never, routing())).resolves.toBeUndefined();
    expect(calls).toEqual(["toast:Couldn't delete|msg(nope)"]);
  });
});
