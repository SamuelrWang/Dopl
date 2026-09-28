// @vitest-environment jsdom
/**
 * Settings → Glasses, over a mocked TRANSPORT (not mocked hooks): the real User API paths,
 * bodies and cache invalidation are what is under test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { GlassesDevice } from "./glasses-api";

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
import { GlassesSettings } from "./glasses-settings";
import { EVEN_G2_INFO } from "../platforms/even-g2/info";

const CHANNELS = [
  { id: "ch-1", name: "General", isMember: true, isDirect: false },
  { id: "ch-2", name: "Ops", isMember: true, isDirect: false },
  { id: "ch-3", name: "Lurked", isMember: false, isDirect: false },
  { id: "ch-4", name: "Ada", isMember: true, isDirect: true },
];

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
const HEY_EVEN = {
  key: "he_secret_key",
  url: "https://www.usedopl.com/api/glasses/hey-even/v1/chat/completions",
};

function route(path: string, opts: Record<string, unknown> = {}): Promise<unknown> {
  const method = (opts.method as string | undefined) ?? "GET";
  if (path === "/api/glasses/devices" && method === "GET") return Promise.resolve({ devices });
  if (path === "/api/channels") return Promise.resolve({ channels: CHANNELS });
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

function renderPane() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <GlassesSettings />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  devices = [];
  toasts.length = 0;
  request.mockReset();
  request.mockImplementation(route);
});
afterEach(cleanup);

describe("pairing", () => {
  it("shows only the pair control when nothing is paired", async () => {
    renderPane();
    await waitFor(() => expect(deviceReads()).toBe(1));
    expect(screen.getByLabelText("Pairing code")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Paired glasses" })).toBeNull();
  });

  it("normalizes the code and claims it, then refetches the list", async () => {
    renderPane();
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

  it("sends the picked channel, offering only the caller's non-direct channels", async () => {
    renderPane();
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "ABC23D" } });
    fireEvent.click(await screen.findByRole("button", { name: "Channel for the new glasses" }));
    const menu = await screen.findByRole("menu");
    await within(menu).findByRole("menuitem", { name: "Ops" });
    expect(within(menu).getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      "No channel",
      "General",
      "Ops",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Ops" }));
    fireEvent.click(screen.getByRole("button", { name: "Pair" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].body).toEqual({ code: "ABC23D", channel_id: "ch-2" });
  });

  it("shows the server's message when the code is refused", async () => {
    request.mockImplementation((path, opts) =>
      path === "/api/glasses/pair/claim"
        ? Promise.reject(new ApiError(404, "NOT_FOUND", "Code expired"))
        : route(path, opts)
    );
    renderPane();
    fireEvent.change(screen.getByLabelText("Pairing code"), { target: { value: "ABC23D" } });
    fireEvent.keyDown(screen.getByLabelText("Pairing code"), { key: "Enter" });
    expect(await screen.findByText("Code expired")).toBeTruthy();
  });
});

describe("device list", () => {
  it("renders name, platform, presence and the linked channel", async () => {
    devices = [device(), device({ id: "dev-2", name: "Spare", online: false, linked_channel: null })];
    renderPane();
    const list = await screen.findByRole("list", { name: "Paired glasses" });
    expect(within(list).getByText("My G2")).toBeTruthy();
    expect(within(list).getByText("Even G2 · Online")).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Channel for My G2" }).textContent).toContain(
      "General"
    );
    expect(within(list).getByRole("button", { name: "Channel for Spare" }).textContent).toContain(
      "No channel"
    );
  });

  it("keeps a linked channel the list does not carry on the menu", async () => {
    devices = [device({ linked_channel: { id: "ch-9", name: "" } })];
    renderPane();
    const picker = await screen.findByRole("button", { name: "Channel for My G2" });
    expect(picker.textContent).toContain("Unknown channel");
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

  it("unlinks the channel with a null channel_id", async () => {
    devices = [device()];
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "Channel for My G2" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "No channel" }));
    await waitFor(() =>
      expect(writes()).toEqual([
        { path: "/api/glasses/devices/dev-1", method: "PATCH", body: { channel_id: null } },
      ])
    );
  });

  it("revokes only after the confirm", async () => {
    devices = [device()];
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    expect(writes()).toEqual([]);
    const dialog = await screen.findByRole("dialog", { name: "Revoke My G2?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
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
