// @vitest-environment jsdom
/**
 * Settings → Connect → Devices, over a mocked TRANSPORT (not mocked hooks): the real API paths,
 * bodies and cache invalidation are what is under test — computers (`/api/devices`) and paired
 * glasses (`/api/glasses/devices`) in one list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GlassesDevice } from "@/features/glasses/settings/glasses-api";
import type { ComputerDeviceDto } from "../types";

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

import { ApiError } from "@/shared/api/api-envelope";
import { EVEN_G2_INFO } from "@/features/glasses/platforms/even-g2/info";
import { DevicesPanel } from "./devices-panel";

function device(over: Partial<GlassesDevice> = {}): GlassesDevice {
  return {
    id: "dev-1",
    name: "My G2",
    platform: "even_g2",
    created_at: "2026-09-26T00:00:00Z",
    last_seen: "2026-09-26T00:00:00Z",
    online: true,
    linked_channel: { id: "ch-1", name: "General" },
    has_hey_even_key: false,
    ...over,
  };
}

let devices: GlassesDevice[];
let computers: ComputerDeviceDto[];

function computer(over: Partial<ComputerDeviceDto> = {}): ComputerDeviceDto {
  return {
    id: "c0ffee00-0000-4000-8000-000000000001",
    kind: "computer",
    name: "Samuel's MacBook Pro",
    platform: "macos",
    online: true,
    status: "active",
    last_seen: new Date().toISOString(),
    created_at: "2026-09-20T00:00:00Z",
    app_version: "1.38.0",
    os_version: "26.1",
    current: true,
    legacy: false,
    ...over,
  };
}
const HEY_EVEN = {
  key: "he_secret_key",
  url: "https://www.usedopl.com/api/glasses/hey-even/v1/chat/completions",
};

function route(path: string, opts: Record<string, unknown> = {}): Promise<unknown> {
  const method = (opts.method as string | undefined) ?? "GET";
  if (path === "/api/glasses/devices" && method === "GET") return Promise.resolve({ devices });
  if (path === "/api/devices" && method === "GET") return Promise.resolve({ devices: computers });
  if (path.startsWith("/api/devices/") && method === "DELETE") return Promise.resolve({ ok: true });
  if (path.startsWith("/api/devices/") && method === "PATCH") return Promise.resolve({ device: computer() });
  if (path === "/api/glasses/pair/claim") return Promise.resolve({ device: device() });
  if (path.endsWith("/hey-even-key")) return Promise.resolve(HEY_EVEN);
  if (path.startsWith("/api/glasses/devices/")) return Promise.resolve(undefined);
  return Promise.reject(new Error(`unrouted ${method} ${path}`));
}

const writes = () =>
  request.mock.calls
    .filter(([, o]) => o?.method && o.method !== "GET")
    .map(([path, o]) => ({ path, method: o?.method, body: o?.body }));

const deviceReads = () =>
  request.mock.calls.filter(([p, o]) => p === "/api/glasses/devices" && !o?.method).length;

function openPairing() {
  fireEvent.click(screen.getByRole("button", { name: "Pair glasses" }));
}

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DevicesPanel />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  devices = [];
  computers = [];
  toasts.length = 0;
  request.mockReset();
  request.mockImplementation(route);
});
afterEach(cleanup);

describe("pairing", () => {
  it("hides the pair control until asked, and says when there are no devices", async () => {
    renderPane();
    await waitFor(() => expect(deviceReads()).toBe(1));
    expect(await screen.findByText("No devices yet.")).toBeTruthy();
    expect(screen.queryByLabelText("Pairing code")).toBeNull();
    openPairing();
    expect(screen.getByLabelText("Pairing code")).toBeTruthy();
  });

  it("normalizes the code and claims it, then refetches the list", async () => {
    renderPane();
    openPairing();
    const input = screen.getByLabelText("Pairing code") as HTMLInputElement;
    const pair = screen.getByRole("button", { name: "Pair" }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: "ab-c 2" } });
    expect(input.value).toBe("ABC2");
    expect(pair.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "ab-c 23d9" } });
    expect(input.value).toBe("ABC23D");
    await waitFor(() => expect(deviceReads()).toBe(1));
    fireEvent.click(pair);

    await waitFor(() => expect(deviceReads()).toBe(2));
    expect(writes()).toEqual([
      { path: "/api/glasses/pair/claim", method: "POST", body: { code: "ABC23D" } },
    ]);
    expect(input.value).toBe("");
    expect(toasts).toEqual(["Glasses paired"]);
  });

  it("pairs by code alone: no channel picker, no channel_id", async () => {
    renderPane();
    openPairing();
    expect(screen.queryByRole("button", { name: "Channel for the new glasses" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "ABC23D" } });
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ code: "ABC23D" });
  });

  it("shows the server's message when the code is refused", async () => {
    request.mockImplementation((path, opts) =>
      path === "/api/glasses/pair/claim"
        ? Promise.reject(new ApiError(404, "NOT_FOUND", "Code expired"))
        : route(path, opts)
    );
    renderPane();
    openPairing();
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "ABC23D" } });
    fireEvent.keyDown(screen.getByLabelText("Pairing code"), { key: "Enter" });
    expect(await screen.findByText("Code expired")).toBeTruthy();
  });
});

describe("glasses rows", () => {
  it("renders name, platform and presence, with no channel control", async () => {
    devices = [device(), device({ id: "dev-2", name: "Spare", online: false, linked_channel: null })];
    renderPane();
    const list = await screen.findByRole("list", { name: "Devices" });
    await within(list).findByText("My G2");
    expect(within(list).getByText("My G2")).toBeTruthy();
    expect(within(list).getByText("Even G2 · Online")).toBeTruthy();
    expect(within(list).queryByRole("button", { name: /^Channel for/ })).toBeNull();
    expect(within(list).queryByText("General")).toBeNull();
  });

  it("renames inline", async () => {
    devices = [device()];
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "My G2" }));
    const input = screen.getByLabelText("Glasses name");
    fireEvent.change(input, { target: { value: "  Work G2 " } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(writes()).toEqual([
        { path: "/api/glasses/devices/dev-1", method: "PATCH", body: { name: "Work G2" } },
      ])
    );
  });

  it("removes only after the confirm", async () => {
    devices = [device()];
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "Remove" }));
    expect(writes()).toEqual([]);
    const dialog = await screen.findByRole("dialog", { name: "Remove My G2?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        { path: "/api/glasses/devices/dev-1", method: "DELETE", body: undefined },
      ])
    );
  });
});

describe("Hey Even", () => {
  it("shows a new key once, with the URL and where it goes", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    devices = [device()];
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "Hey Even" }));

    const dialog = await screen.findByRole("dialog", { name: "Hey Even" });
    expect(writes()).toEqual([
      { path: "/api/glasses/devices/dev-1/hey-even-key", method: "POST", body: undefined },
    ]);
    expect(within(dialog).getByText(EVEN_G2_INFO.assistant.setupPath)).toBeTruthy();
    expect(within(dialog).getByText(HEY_EVEN.url)).toBeTruthy();
    expect(within(dialog).getByText(HEY_EVEN.key)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Copy URL" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HEY_EVEN.url));
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy key" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HEY_EVEN.key));

    fireEvent.click(within(dialog).getByText("Close"));
    await waitFor(() => expect(screen.queryByText(HEY_EVEN.key)).toBeNull());
  });

  it("asks before replacing an existing key", async () => {
    devices = [device({ has_hey_even_key: true })];
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "Hey Even" }));
    const confirm = await screen.findByRole("dialog", { name: "Replace the Hey Even key?" });
    expect(writes()).toEqual([]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Replace" }));
    expect(await screen.findByText(HEY_EVEN.key)).toBeTruthy();
  });
});

describe("computers", () => {
  it("lists this computer first with its platform, presence and app version", async () => {
    computers = [
      computer({ id: "c0ffee00-0000-4000-8000-000000000002", name: "Air", current: false, online: false, last_seen: null }),
      computer(),
    ];
    devices = [device({ online: false, last_seen: null })];
    renderPane();
    const list = await screen.findByRole("list", { name: "Devices" });
    await within(list).findByText("Samuel's MacBook Pro");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0].textContent).toContain("Samuel's MacBook Pro");
    expect(rows[0].textContent).toContain("This computer");
    expect(within(rows[0]).getByText("macOS · Online · Dopl 1.38.0")).toBeTruthy();
    expect(rows.map((r) => r.textContent ?? "").join("|")).toContain("Air");
    expect(within(list).getByText("macOS · Offline · Dopl 1.38.0")).toBeTruthy();
  });

  it("removes a computer after the confirm, then refetches", async () => {
    computers = [computer({ current: false })];
    renderPane();
    const list = await screen.findByRole("list", { name: "Devices" });
    fireEvent.click(await within(list).findByRole("button", { name: "Remove" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove Samuel's MacBook Pro?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        { path: "/api/devices/c0ffee00-0000-4000-8000-000000000001", method: "DELETE", body: undefined },
      ])
    );
    expect(toasts).toContain("Computer removed");
  });

  it("renames a computer inline; clearing the name restores the detected one", async () => {
    computers = [computer({ name: "Studio", detected_name: "Samuel's MacBook Pro", renamed: true })];
    renderPane();
    const path = "/api/devices/c0ffee00-0000-4000-8000-000000000001";
    fireEvent.click(await screen.findByRole("button", { name: "Studio" }));
    let input = screen.getByLabelText("Computer name") as HTMLInputElement;
    expect(input.placeholder).toBe("Samuel's MacBook Pro");
    fireEvent.change(input, { target: { value: " Desk Mac " } });
    fireEvent.blur(input);
    await waitFor(() =>
      expect(writes()).toEqual([{ path, method: "PATCH", body: { name: "Desk Mac" } }])
    );
    fireEvent.click(await screen.findByRole("button", { name: "Studio" }));
    input = screen.getByLabelText("Computer name") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await waitFor(() => expect(writes()[1]).toEqual({ path, method: "PATCH", body: { name: null } }));
  });

  it("offers no rename on a legacy computer (a bare device token)", async () => {
    computers = [computer({ legacy: true, current: false })];
    renderPane();
    const list = await screen.findByRole("list", { name: "Devices" });
    await within(list).findByText("Samuel's MacBook Pro");
    expect(within(list).queryByRole("button", { name: "Samuel's MacBook Pro" })).toBeNull();
  });
});
