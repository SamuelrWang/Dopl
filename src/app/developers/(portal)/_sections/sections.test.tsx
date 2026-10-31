// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INTEGRATIONS } from "@/features/device-sdk/portal/catalog";
import type { PortalProject } from "@/features/device-sdk/portal/scope";
import type { Call, EndpointView, Issue, KeyView, MetricRow, PortalUser } from "@/features/device-sdk/portal/view";
import { PortalProvider } from "../_components/portal-store";
import { ActivitySection } from "./activity";
import { ConnectSection } from "./connect";
import { DevicesSection } from "./devices";
import { IntegrationPageSection } from "./integration-page";
import { IssuesSection } from "./issues";
import { KeysSection } from "./keys";
import { OverviewSection } from "./overview";
import { PlaygroundSection } from "./playground";
import { TeamSection } from "./team";
import { UsageSection } from "./usage";
import { UserPageSection } from "./user-page";
import { UsersSection } from "./users";
import { WebhooksSection } from "./webhooks";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/developers",
}));

beforeAll(() => {
  // jsdom has neither; the kit's popover and frame read them.
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const NOW = "2026-10-31T12:00:00.000Z";
const internal: PortalProject = { id: "p1", name: "Dopl App", apiVersion: "2026-10-01", role: "owner", org: { id: "o1", name: "Dopl", internal: true } };
const customer: PortalProject = { ...internal, org: { id: "o2", name: "Acme", internal: false } };

const users: PortalUser[] = [
  {
    id: "usr_1",
    name: "Maya Chen",
    named: true,
    activeDeviceId: "d1",
    lastDeliveryAt: "2026-10-31T11:00:00.000Z",
    lastActiveAt: "2026-10-31T11:59:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    devices: [{ id: "d1", userId: "usr_1", name: "Maya's G2", modelId: "g2", state: "online", firmware: null, lastSeenAt: "2026-10-31T11:59:30.000Z", pairedAt: "2026-10-01T00:00:00.000Z", grants: ["present.*"], deliveries7d: 10, delivered7d: 9 }],
  },
];
const metrics: MetricRow[] = [{ day: "2026-10-31", user: "usr_1", device: "d1", kind: "glasses", key: "k1", calls: 12, errors: 1, deliveries: 10, delivered: 9, failed: 1, last_delivery: "2026-10-31T11:00:00.000Z" }];
const calls: Call[] = [
  { id: "c1", kind: "message", at: "2026-10-31T11:30:00.000Z", userId: "usr_1", deviceId: "d1", modelId: "g2", capability: "input.utterance", status: "received", errorCode: null, title: "Ship the release", text: "Ship the release", latencyMs: 0, steps: [], considered: [], route: null, response: null, webhook: null },
  {
    id: "c2",
    kind: "delivery",
    at: "2026-10-31T11:00:00.000Z",
    userId: "usr_1",
    deviceId: "d1",
    modelId: "g2",
    capability: "present.notify",
    status: "delivered",
    errorCode: null,
    title: "Deploy finished",
    text: "Deploy finished",
    latencyMs: 80,
    steps: [{ key: "picked", label: "Picked up by device", at: 900, state: "done" }],
    considered: [{ deviceId: "d1", verdict: "chosen", reason: "most recently active" }],
    route: "POST /v1/users/usr_1/deliver",
    response: { status: "done" },
    webhook: null,
  },
];
const hook: Call = { ...calls[1], id: "h1", kind: "webhook", status: "failed", title: "action.failed", webhook: { endpointId: "e1", endpointName: "Backend", event: "action.failed", attempts: [{ at: NOW, status: 500, note: "Answered 500" }], payload: { type: "action.failed" } } };
const endpoints: EndpointView[] = [{ id: "e1", name: "Backend", url: "https://x.example/h", events: ["action.failed"], state: "failing", sent7d: 3, delivered7d: 0, failed7d: 3, rate: 0, lastAt: NOW, bars: [0, 0, 0, 0, 0, 0, 100] }];
const issues: Issue[] = [{ id: "error:device_offline", kind: "error_code", title: "Devices offline when called", code: "device_offline", count: 3, countLabel: "calls in 7 days", why: "Offline.", firstSeen: NOW, userIds: ["usr_1"], latestCallId: "c2", action: { label: "Open activity", href: "/activity" } }];
const key = (over: Partial<KeyView>): KeyView => ({ id: "k1", name: "Assistant backend", kind: "secret", prefix: "sk_live_Mx7a", scopes: ["actions:write"], createdAt: "2026-10-01T00:00:00.000Z", createdBy: "a@b.co", lastUsedAt: "2026-10-31T11:50:00.000Z", calls7d: 12, revokedAt: null, expiresAt: null, locked: false, ...over });
const rules = { profileId: "glasses-default", profileVersion: 1, guidance: "Be brief.", format: "plain", maxLines: 5, maxChars: 300, overflow: "Cut to fit", published: [{ id: "present.notify" as const, allowed: true, limits: [["max lines", "4"]] as [string, string][] }] };

const inPortal = (children: ReactNode, project = internal, env: "live" | "test" = "live") =>
  render(
    <PortalProvider data={{ email: "a@b.co", projects: [project], project, env, now: NOW }}>
      {children}
    </PortalProvider>
  );

describe("the portal's pages, on real shapes", () => {
  it("Overview shows the real figures and cuts what was invented", () => {
    inPortal(<OverviewSection users={users} metrics={metrics} endpoints={endpoints} issues={issues} activeKeys={1} />);
    expect(screen.getByText("Deliveries, 7d")).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
    expect(screen.queryByText(/maintenance/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/Ask about/)).toBeNull();
    fireEvent.click(screen.getByText("Which users need a relink?"));
    expect(screen.getByText("None.")).toBeTruthy();
  });

  it("Activity shows a message's own words, and never says seen", () => {
    inPortal(<ActivitySection calls={calls} users={users} initial={{ call: "c2" }} />);
    expect(screen.getByText("Ship the release")).toBeTruthy();
    expect(screen.getByText("Picked up by device")).toBeTruthy();
    expect(screen.queryByText(/seen by device/i)).toBeNull();
  });

  it("Usage labels an internal project and offers no plan", () => {
    inPortal(<UsageSection users={users} metrics={metrics} keys={[key({})]} keyLimit={10} seats={1} endpoints={1} />);
    expect(screen.getByText("Internal, not billed")).toBeTruthy();
    expect(screen.queryByText(/plan|Next bill|Manage/)).toBeNull();
  });

  it("Issues links to the fix instead of pretending to do it", () => {
    inPortal(<IssuesSection issues={issues} users={users} />);
    expect(screen.getAllByText("Devices offline when called").length).toBeGreaterThan(0);
    expect(screen.queryByText("Mute")).toBeNull();
    expect(screen.getByRole("link", { name: /Open activity/ })).toBeTruthy();
  });

  it("Users has no saved views, plan or send test", () => {
    inPortal(<UsersSection users={users} calls={calls} />);
    expect(screen.getByText("Maya Chen")).toBeTruthy();
    expect(screen.queryByText("Views")).toBeNull();
    fireEvent.click(screen.getByText("Maya Chen"));
    expect(screen.queryByText("Send test")).toBeNull();
    expect(screen.queryByText("Relink link")).toBeNull();
  });

  it("a user's page has no controls that do nothing", () => {
    inPortal(<UserPageSection user={users[0]} calls={calls} />);
    expect(screen.getByText("Maya's G2")).toBeTruthy();
    for (const fake of ["Revoke", "Relink", "Preferences", "Send test"]) expect(screen.queryByText(fake)).toBeNull();
  });

  it("Devices lists only what is connected, with no add flow", () => {
    inPortal(<DevicesSection users={users} metrics={metrics} />);
    expect(screen.getByText("G2")).toBeTruthy();
    expect(screen.queryByText("Add device")).toBeNull();
    expect(screen.queryByText("Meta")).toBeNull();
  });

  it("a device page reads its rules, read only", () => {
    inPortal(<IntegrationPageSection integration={INTEGRATIONS[0]} users={users} calls={calls} metrics={metrics} rules={rules} initialTab="receives" />);
    expect(screen.getByText("glasses-default v1")).toBeTruthy();
    expect(screen.queryByText(/quiet hours/i)).toBeNull();
    expect(screen.queryByText("Publish")).toBeNull();
  });

  it("Webhooks shows failing endpoints and the real add flow", () => {
    inPortal(<WebhooksSection endpoints={endpoints} events={[hook]} />);
    expect(screen.getAllByText("Backend").length).toBeGreaterThan(0);
    expect(screen.queryByText("Test")).toBeNull();
    fireEvent.click(screen.getByText("Add endpoint"));
    expect(screen.getByText("Where should events go?")).toBeTruthy();
  });

  it("Keys has no undo, and a locked key offers nothing to press", () => {
    inPortal(<KeysSection keys={[key({ locked: true })]} />);
    expect(screen.getByText("Used by Dopl")).toBeTruthy();
    expect(screen.queryByText("Rotate")).toBeNull();
    expect(screen.queryByText("Revoke")).toBeNull();
  });

  it("an unlocked key can rotate and revoke", () => {
    inPortal(<KeysSection keys={[key({})]} />);
    expect(screen.getByText("Rotate")).toBeTruthy();
    expect(screen.getByText("Revoke")).toBeTruthy();
  });

  it("Team offers no invite in an internal org, and no Viewer anywhere", () => {
    inPortal(<TeamSection members={[{ userId: "u", email: "a@b.co", role: "owner", isOwner: true, isYou: true, lastActiveAt: NOW }]} invites={[]} />);
    expect(screen.queryByText("Invite member")).toBeNull();
    expect(screen.queryByText("Viewer")).toBeNull();
  });

  it("Team offers the invite in a customer org, as a link to copy", () => {
    inPortal(<TeamSection members={[{ userId: "u", email: "a@b.co", role: "owner", isOwner: true, isYou: true, lastActiveAt: NOW }]} invites={[]} />, customer);
    expect(screen.getByText("Invite member")).toBeTruthy();
  });

  it("Connect shows what can pair, with nothing to publish", () => {
    inPortal(<ConnectSection branding={{ name: "Dopl App", accent: null, logoUrl: null }} integrations={[INTEGRATIONS[0]]} />);
    expect(screen.getByText("Even Realities")).toBeTruthy();
    expect(screen.queryByText("Publish")).toBeNull();
    expect(screen.queryByText("Open test link")).toBeNull();
  });

  it("the Playground refuses to run on Live", () => {
    inPortal(<PlaygroundSection />);
    expect(screen.getByText("The Playground uses test data only")).toBeTruthy();
    cleanup();
    inPortal(<PlaygroundSection />, internal, "test");
    expect(screen.getByText("Send")).toBeTruthy();
  });
});
