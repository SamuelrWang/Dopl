/**
 * `/oauth/authorize` consent screen — the anti-phishing marking (P1 2026-08-08).
 *
 * `client_name` is attacker-controllable (RFC 7591 registration is open), and it
 * was rendered verbatim as a bold label, so anyone could register a client
 * called "Dopl Official Desktop" and phish an /authorize link. These tests pin
 * that a client the user has never connected is marked UNVERIFIED and its name
 * is framed as a self-reported claim — while a client the user has connected
 * before (or the reserved first-party device client) renders clean.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEVICE_CLIENT_ID } from "@/shared/auth/mcp-credential";

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getClient: vi.fn(),
  userHasPriorGrant: vi.fn(),
}));

vi.mock("@/shared/supabase/server", () => ({ getUser: mocks.getUser }));
vi.mock("@/shared/auth/mcp-oauth", () => ({ getClient: mocks.getClient }));
vi.mock("@/shared/auth/oauth-client-verification", () => ({
  userHasPriorGrant: mocks.userHasPriorGrant,
}));
// The split layout pulls in styling-only chrome; render its children inline.
vi.mock("@/shared/layout/auth-split", () => ({
  AuthSplitLayout: ({ children }: { children: React.ReactNode }) => children,
}));

import AuthorizePage from "./page";

const REDIRECT_URI = "https://client.example/cb";

function params(over: Record<string, string> = {}) {
  return Promise.resolve({
    response_type: "code",
    client_id: "dopl_client_x",
    redirect_uri: REDIRECT_URI,
    code_challenge: "chal",
    code_challenge_method: "S256",
    scope: "dopl.read dopl.write",
    ...over,
  });
}

async function markup(searchParams: ReturnType<typeof params>): Promise<string> {
  const el = await AuthorizePage({ searchParams });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
  mocks.getClient.mockResolvedValue({
    client_id: "dopl_client_x",
    client_name: "Dopl Official Desktop", // the phishing name
    redirect_uris: [REDIRECT_URI],
  });
  mocks.userHasPriorGrant.mockResolvedValue(false);
});

describe("unverified (never-connected) client", () => {
  it("shows the Unverified badge and frames the name as a self-reported claim", async () => {
    const html = await markup(params());
    expect(html).toContain("Unverified app");
    expect(html).toContain("chosen by the app itself");
    // The attacker-chosen name is quoted, not presented as an official label.
    expect(html).toContain("“Dopl Official Desktop”");
    // The consent form is intact — approval still works.
    expect(html).toContain('action="/api/oauth/authorize"');
  });
});

describe("verified client", () => {
  it("a previously-authorized client renders clean (no badge)", async () => {
    mocks.userHasPriorGrant.mockResolvedValue(true);
    const html = await markup(params());
    expect(html).not.toContain("Unverified app");
    expect(html).toContain("wants to access your Dopl workspaces");
  });

  it("the reserved first-party device client short-circuits without a history lookup", async () => {
    mocks.getClient.mockResolvedValue({
      client_id: DEVICE_CLIENT_ID,
      client_name: "Dopl Desktop (device tokens)",
      redirect_uris: [REDIRECT_URI],
    });
    const html = await markup(params({ client_id: DEVICE_CLIENT_ID }));
    expect(html).not.toContain("Unverified app");
    expect(mocks.userHasPriorGrant).not.toHaveBeenCalled();
  });
});
