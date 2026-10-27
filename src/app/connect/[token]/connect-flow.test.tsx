// @vitest-environment jsdom
/**
 * The hosted Connect card (A4): labels and controls only, consent grouped by risk tier with T2+
 * unticked, the developer's branding, and the consent POST carrying exactly the ticked scopes
 * (a downgrade is just an untick).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ConnectFlow } from "./connect-flow";

const branding = { display_name: "Acme", accent_color: "#112233" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ConnectFlow", () => {
  it("shows the expired ending", () => {
    render(<ConnectFlow token="ct_x" view={{ state: "expired", branding }} />);
    expect(screen.getByText("This link has expired")).toBeTruthy();
    expect(screen.getByText("Acme")).toBeTruthy();
  });

  it("lists devices with their pre-check count", () => {
    render(
      <ConnectFlow
        token="ct_x"
        view={{
          state: "choose",
          branding,
          candidates: [{ adapter_id: "even_g2", kind: "glasses", label: "Even G2", pairing: "enter_code", supported: ["present.*"], unsupported: ["act.lock"] }],
        }}
      />
    );
    expect(screen.getByText("Even G2")).toBeTruthy();
    expect(screen.getByText("1/2 supported")).toBeTruthy();
  });

  it("consent: T1 ticked, T2 unticked, Allow posts only the ticked scopes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ redirect_url: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ConnectFlow
        token="ct_x"
        view={{
          state: "consent",
          branding,
          device: "Simulated phone",
          scopes: [
            { scope: "present.*", tier: "T1", checked: true },
            { scope: "capture.photo", tier: "T2", checked: false },
          ],
        }}
      />
    );
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(screen.getByText("Camera and microphone")).toBeTruthy();
    fireEvent.click(screen.getByText("Allow"));
    await waitFor(() => expect(screen.getByText("Connected")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/connect/ct_x/consent");
    expect(JSON.parse(String(init.body))).toEqual({ scopes: ["present.*"] });
  });
});
