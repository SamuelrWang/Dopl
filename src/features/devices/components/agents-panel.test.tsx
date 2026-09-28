// @vitest-environment jsdom
/**
 * Settings → Connect → Agents over a mocked transport: one row per agent app, Disconnect behind a
 * confirm, and the "Connect an agent" recipes behind the header control.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AgentApp } from "../types";

const { request, toasts } = vi.hoisted(() => ({
  request: vi.fn<(path: string, opts?: Record<string, unknown>) => Promise<unknown>>(),
  toasts: [] as string[],
}));

vi.mock("@/shared/api/api-client", async () => {
  const envelope = await import("@/shared/api/api-envelope");
  return { ...envelope, apiRequest: request };
});
vi.mock("@/shared/ui/toast", () => ({
  toast: ({ title }: { title: string }) => toasts.push(title),
}));

import { AgentsPanel } from "./agents-panel";

let apps: AgentApp[];

function route(path: string, opts: Record<string, unknown> = {}): Promise<unknown> {
  const method = (opts.method as string | undefined) ?? "GET";
  if (path === "/api/oauth/apps" && method === "GET") return Promise.resolve({ apps });
  if (path.startsWith("/api/oauth/apps/") && method === "DELETE") return Promise.resolve({ ok: true });
  return Promise.reject(new Error(`unrouted ${method} ${path}`));
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgentsPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  apps = [];
  toasts.length = 0;
  request.mockReset();
  request.mockImplementation(route);
});
afterEach(cleanup);

describe("agents panel", () => {
  it("lists one row per app with its last use", async () => {
    apps = [
      { key: "claude-code", name: "Claude Code", connections: 3, last_used_at: new Date().toISOString(), created_at: "2026-09-01T00:00:00Z" },
      { key: "codex", name: "Codex", connections: 1, last_used_at: null, created_at: "2026-09-01T00:00:00Z" },
    ];
    renderPanel();
    const list = await screen.findByRole("list", { name: "Connected agents" });
    await within(list).findByText("Claude Code");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByText("Last used just now")).toBeTruthy();
    expect(within(list).getByText("Not used yet")).toBeTruthy();
  });

  it("says so when nothing is connected", async () => {
    renderPanel();
    expect(await screen.findByText("No agents connected yet.")).toBeTruthy();
  });

  it("disconnects an app only after the confirm", async () => {
    apps = [{ key: "codex", name: "Codex", connections: 2, last_used_at: null, created_at: "2026-09-01T00:00:00Z" }];
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect Codex?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith("/api/oauth/apps/codex", { method: "DELETE" })
    );
    expect(toasts).toEqual(["Codex disconnected"]);
  });

  it("shows how to connect each client behind the header control", async () => {
    renderPanel();
    expect(screen.queryByRole("list", { name: "Connect an agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect an agent" }));
    const recipes = screen.getByRole("list", { name: "Connect an agent" });
    expect(within(recipes).getByText(/claude mcp add --transport http dopl .*\/api\/mcp/)).toBeTruthy();
    expect(within(recipes).getByText(/codex mcp add dopl --url .*\/api\/mcp/)).toBeTruthy();
    expect(within(recipes).getByRole("button", { name: "Copy for Claude" })).toBeTruthy();
  });
});
