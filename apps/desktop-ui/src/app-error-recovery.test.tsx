import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { installBridge, ok } from "#/test-utils/bridge";
import { App } from "./app";

/**
 * A query left in `error` by a sleep or a network drop recovers WITHOUT a
 * reload: main's wake push, the network returning, or the window regaining
 * focus refetches it. The route is a probe; the provider stack is the real one.
 */

vi.mock("#/routes", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const { apiRequest } = await import("#/lib/api");
  function Probe() {
    const q = useQuery({
      queryKey: ["probe"],
      queryFn: () => apiRequest<{ name: string }>("/api/probe"),
      retry: false,
    });
    if (q.status === "error") return <div>PROBE ERROR</div>;
    if (q.status === "success") return <div>PROBE {q.data.name}</div>;
    return <div>PROBE PENDING</div>;
  }
  return { routes: [{ path: "/", element: <Probe /> }] };
});

vi.mock("#/lib/query-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#/lib/query-client")>();
  return {
    ...actual,
    createQueryPersister: () => ({
      persistClient: async () => {},
      restoreClient: async () => undefined,
      removeClient: async () => {},
    }),
  };
});

const OFFLINE = {
  status: 0,
  statusText: "",
  hasBody: true,
  body: { error: { code: "NETWORK_UNAVAILABLE" } },
};

let wakeListeners: (() => void)[] = [];
const apiRequest = vi.fn();

async function renderErrored() {
  apiRequest.mockResolvedValue(OFFLINE);
  window.location.hash = "#/";
  render(<App />);
  await screen.findByText("PROBE ERROR");
  apiRequest.mockResolvedValue(ok({ name: "back" }));
}

describe("App — errored queries recover without a reload", () => {
  beforeEach(() => {
    wakeListeners = [];
    apiRequest.mockReset();
    installBridge({
      apiRequest,
      getAuthState: vi.fn(async () => ({ signedIn: true, userId: "u" })),
      onWake: vi.fn((cb: () => void) => {
        wakeListeners.push(cb);
        return () => {
          wakeListeners = wakeListeners.filter((fn) => fn !== cb);
        };
      }),
    });
  });

  it("main's wake push refetches the errored query", async () => {
    await renderErrored();
    expect(wakeListeners).toHaveLength(1);
    for (const fn of wakeListeners) fn();
    expect(await screen.findByText("PROBE back")).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledTimes(2);
  });

  it("the network returning refetches it", async () => {
    await renderErrored();
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByText("PROBE back")).toBeInTheDocument();
  });

  it("the window regaining focus refetches it", async () => {
    await renderErrored();
    window.dispatchEvent(new Event("focus"));
    expect(await screen.findByText("PROBE back")).toBeInTheDocument();
  });

  it("a healthy query is left alone on wake", async () => {
    apiRequest.mockResolvedValue(ok({ name: "fine" }));
    window.location.hash = "#/";
    render(<App />);
    await screen.findByText("PROBE fine");
    for (const fn of wakeListeners) fn();
    await Promise.resolve();
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
