// @vitest-environment jsdom
/**
 * The keys table's self-serve controls (P3). The properties that fail quietly:
 *  - 🔒 a `developer` sees no Create, Rotate or Revoke (the server refuses anyway; the UI must
 *    not offer a dead button);
 *  - Create posts exactly `{ env, kind }` to the project's keys route and shows the secret once;
 *  - Revoke goes through a confirm and a DELETE on the key; a dead key offers neither verb.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh }) }));

const { KeysTable } = await import("./keys-table");
type KeyView = import("./keys-table").KeyView;

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const active: KeyView = {
  id: "k-active",
  masked: "sk_test_AbCd••••",
  kind: "secret",
  scopes: ["connect"],
  created: "1d ago",
  lastUsed: "Never",
  status: { kind: "active" },
};
const revoked: KeyView = { ...active, id: "k-dead", status: { kind: "revoked" } };

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ok = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("KeysTable", () => {
  it("🔒 offers no write controls to a developer", () => {
    render(<KeysTable projectId={PROJECT} env="test" keys={[active]} canManage={false} />);
    expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rotate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(screen.getByText(/Only an org owner or admin/)).toBeTruthy();
  });

  it("a dead key offers neither Rotate nor Revoke", () => {
    render(<KeysTable projectId={PROJECT} env="test" keys={[revoked]} canManage />);
    expect(screen.queryByRole("button", { name: "Rotate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });

  it("creates a key with exactly env + kind and shows the secret once", async () => {
    fetchMock.mockReturnValue(ok({ secret: "sk_live_SECRET", key: { id: "new" } }, 201));
    render(<KeysTable projectId={PROJECT} env="live" keys={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Create live key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    await waitFor(() => expect(screen.getByText("sk_live_SECRET")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/developers/projects/${PROJECT}/keys`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ env: "live", kind: "secret" });
    expect(screen.getByText(/Shown once/)).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it("revokes through a confirm, with a DELETE on the key", async () => {
    fetchMock.mockReturnValue(ok({ ok: true }));
    render(<KeysTable projectId={PROJECT} env="test" keys={[active]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke key" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/developers/keys/k-active");
    expect(init.method).toBe("DELETE");
  });

  it("shows the server's refusal text", async () => {
    fetchMock.mockReturnValue(ok({ error: { code: "KEY_LIMIT", message: "A project can have at most 10 active test keys." } }, 409));
    render(<KeysTable projectId={PROJECT} env="test" keys={[]} canManage />);
    fireEvent.click(screen.getByRole("button", { name: "Create test key" }));
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/at most 10 active test keys/));
  });
});
