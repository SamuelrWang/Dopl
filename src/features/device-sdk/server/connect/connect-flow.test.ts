/**
 * The Connect flow end to end at the service seam (C2, A4): create session → pre-check → pair
 * (simulator + G2 through the glasses pairing core) → consent by tier → exchange → list → revoke,
 * plus the expiry, downgrade, one-time and tenant-isolation edges. The HTTP surface is covered by
 * `src/app/api/v1/connections/connect-routes.test.ts`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { ConnectionSchema, ConnectionExchangeResponseSchema } from "@dopl/contracts/device-sdk";
import { deviceAdapters } from "../../adapters/registry";
import { pairingStatus, startPairing, type ConnectPairingPort } from "@/features/glasses/core/devices/pairing";
import { createFakeDeviceStore } from "@/features/glasses/core/testing/fake-device-store";
import { CONNECT_SESSION_TTL_MS, ConnectError, PUBLIC_TOKEN_TTL_MS, hashToken } from "./dto";
import { createFakeConnectStore } from "./fake-connect-store";
import { claimConnectPairing, connectPageView, consentConnect, startConnectPairing } from "./hosted";
import { createConnectSession, exchangePublicToken, listConnections, revokeConnection, type ConnectDeps } from "./service";
import { capabilitiesOfScope, tierOfScope } from "./scopes";

const T = { projectId: "11111111-1111-4111-8111-111111111111", env: "test" as const };
const ORIGIN = "https://www.usedopl.com";

let t = Date.parse("2026-10-27T12:00:00.000Z");
const now = () => t;

/** A ConnectPairingPort over the fake glasses store's pairings (mirrors pairing-port.ts). */
function fakePort(pairings: ReturnType<typeof createFakeDeviceStore>["pairings"]) {
  const sdk = new Map<string, string>();
  const tokens = new Map<string, string>();
  const port: ConnectPairingPort = {
    async claimPairing(id, deviceId, at) {
      const p = pairings.find((x) => x.id === id && x.status === "pending" && x.device_id === null && x.expires_at > at);
      if (!p || sdk.has(id)) return false;
      p.status = "claimed";
      sdk.set(id, deviceId);
      return true;
    },
    async sdkDeviceFor(id) {
      return sdk.get(id) ?? null;
    },
    async setTokenHash(deviceId, hash) {
      tokens.set(deviceId, hash);
    },
  };
  return { port, tokens };
}

function setup() {
  const fake = createFakeConnectStore();
  const glasses = createFakeDeviceStore();
  const { port, tokens } = fakePort(glasses.pairings);
  const deps: ConnectDeps = { store: fake.store, adapters: deviceAdapters, now, glasses: { devices: glasses.devices, port } };
  return { ...fake, glasses, port, tokens, deps };
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e) => e instanceof ConnectError && e.code === code);
}

const tokenOf = (url: string) => url.split("/connect/")[1];

beforeEach(() => {
  t = Date.parse("2026-10-27T12:00:00.000Z");
});

describe("scopes", () => {
  it("a family's tier is its highest member's (act.* holds act.lock → T4)", () => {
    expect(tierOfScope("present.*")).toBe("T1");
    expect(tierOfScope("act.*")).toBe("T4");
    expect(tierOfScope("capture.photo")).toBe("T2");
    expect(capabilitiesOfScope("act.*")).not.toContain("act.motion.move");
  });
});

describe("Connect flow (simulator)", () => {
  it("create → pre-check → pair → consent → exchange → list → revoke", async () => {
    const s = setup();
    s.branding.set(T.projectId, { display_name: "Acme", accent_color: "#112233" });
    const created = await createConnectSession(
      s.deps,
      T,
      {
        external_user_id: "user-42",
        allowed_kinds: ["glasses"],
        requested_scopes: ["present.*", "capture.photo", "act.lock"],
        redirect_uri: "https://acme.example/done",
        branding: { display_name: "Acme Glasses" },
      },
      ORIGIN
    );
    const token = tokenOf(created.url);
    expect(created.connect_token).toBe(token);
    expect(created.expires_at).toBe(new Date(t + CONNECT_SESSION_TTL_MS).toISOString());
    // 🔒 Only the hash is stored.
    expect(s.sessions[0].token_hash).toBe(hashToken(token));
    expect(JSON.stringify(s.sessions)).not.toContain(token);
    expect(s.endUsers).toHaveLength(1);

    // Step 1: pre-check from describe(). Glasses only (allowed_kinds); act.lock unsupported.
    const choose = await connectPageView(s.deps, token);
    expect(choose?.state).toBe("choose");
    if (choose?.state !== "choose") throw new Error("unreachable");
    expect(choose.branding).toEqual({ display_name: "Acme Glasses", accent_color: "#112233" });
    const sim = choose.candidates.find((c) => c.adapter_id === "simulator")!;
    expect(sim).toMatchObject({ kind: "glasses", pairing: "display_code", unsupported: ["act.lock"] });
    expect(choose.candidates.map((c) => c.adapter_id).sort()).toEqual(["even_g2", "simulator"]);

    // Step 2: the simulator displays its code; the (simulated) device enters it.
    const flow = await startConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "glasses" });
    expect(flow).toMatchObject({ method: "display_code", code: "SIM234" });
    await expectCode(claimConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "glasses", code: "WRONG1" }), "invalid_request");
    await claimConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "glasses", code: "sim234" });
    expect(s.devices[0]).toMatchObject({ adapter_id: "simulator", project_id: T.projectId, env: "test", end_user_id: s.endUsers[0].id });

    // Step 3: consent by tier. T1 pre-ticked, T2 not; unsupported act.lock not offered.
    const consent = await connectPageView(s.deps, token);
    if (consent?.state !== "consent") throw new Error(`expected consent, got ${consent?.state}`);
    expect(consent.scopes).toEqual([
      { scope: "present.*", tier: "T1", checked: true },
      { scope: "capture.photo", tier: "T2", checked: false },
    ]);
    const { redirect_url } = await consentConnect(s.deps, token, { scopes: ["present.*", "capture.photo"] });
    const publicToken = new URL(redirect_url!).searchParams.get("public_token")!;
    expect(publicToken).toMatch(/^public-test-/);
    expect(JSON.stringify(s.sessions)).not.toContain(publicToken);
    expect(s.connections[0]).toMatchObject({ granted_scopes: ["present.*", "capture.photo"], tier_grants: { "present.*": "T1", "capture.photo": "T2" } });
    expect(s.outbox.map((o) => o.event_type)).toEqual(["connection.created"]);
    expect((await connectPageView(s.deps, token))?.state).toBe("done");

    // Step 4: exchange — once.
    const ex = await exchangePublicToken(s.deps, T, { public_token: publicToken });
    expect(ConnectionExchangeResponseSchema.parse(ex).connection_id).toBe(s.connections[0].id);
    expect(ex.device.capabilities.map((c) => c.capability)).toContain("present.display");
    await expectCode(exchangePublicToken(s.deps, T, { public_token: publicToken }), "invalid_request");

    const listed = await listConnections(s.deps, T, "user-42");
    expect(listed.data).toHaveLength(1);
    expect(ConnectionSchema.parse(listed.data[0])).toMatchObject({ status: "active", external_user_id: "user-42", revoked_at: null });

    const revoked = await revokeConnection(s.deps, T, ex.connection_id);
    expect(revoked.status).toBe("revoked");
    expect(s.outbox.map((o) => o.event_type)).toEqual(["connection.created", "connection.revoked"]);
    // Revoked shows in the list; a second revoke is idempotent and enqueues nothing.
    expect((await listConnections(s.deps, T, "user-42")).data[0].status).toBe("revoked");
    expect((await revokeConnection(s.deps, T, ex.connection_id)).status).toBe("revoked");
    expect(s.outbox).toHaveLength(2);
  });

  it("an expired session refuses every step and the page says expired", async () => {
    const s = setup();
    const { url } = await createConnectSession(s.deps, T, { external_user_id: "u", requested_scopes: ["present.notify"] }, ORIGIN);
    const token = tokenOf(url);
    t += CONNECT_SESSION_TTL_MS + 1;
    expect((await connectPageView(s.deps, token))?.state).toBe("expired");
    await expectCode(startConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "phone" }), "invalid_request");
    await expectCode(claimConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "phone", code: "SIM234" }), "invalid_request");
  });

  it("scope downgrade at consent: only what was ticked is granted; nothing unrequested can be", async () => {
    const s = setup();
    const { url } = await createConnectSession(
      s.deps,
      T,
      { external_user_id: "u", allowed_kinds: ["phone"], requested_scopes: ["present.notify", "capture.audio", "state.read"] },
      ORIGIN
    );
    const token = tokenOf(url);
    await claimConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "phone", code: "SIM234" });
    await expectCode(consentConnect(s.deps, token, { scopes: [] }), "invalid_request");
    await expectCode(consentConnect(s.deps, token, { scopes: ["present.notify", "act.lock"] }), "invalid_request");
    const out = await consentConnect(s.deps, token, { scopes: ["present.notify"] });
    expect(out.redirect_url).toBeNull();
    const listed = await listConnections(s.deps, T, "u");
    expect(listed.data[0].grants.map((g) => g.scope)).toEqual(["present.notify"]);
  });

  it("a public token expires, and never crosses tenants", async () => {
    const s = setup();
    const { url } = await createConnectSession(
      s.deps,
      T,
      { external_user_id: "u", requested_scopes: ["present.notify"], redirect_uri: "https://a.example/cb" },
      ORIGIN
    );
    const token = tokenOf(url);
    await claimConnectPairing(s.deps, token, { adapter_id: "simulator", kind: "phone", code: "SIM234" });
    const pt = new URL((await consentConnect(s.deps, token, { scopes: ["present.notify"] })).redirect_url!).searchParams.get("public_token")!;
    await expectCode(exchangePublicToken(s.deps, { ...T, env: "live" }, { public_token: pt }), "invalid_request");
    await expectCode(listConnections(s.deps, { ...T, env: "live" }, "u"), "not_found");
    t += PUBLIC_TOKEN_TTL_MS + 1;
    await expectCode(exchangePublicToken(s.deps, T, { public_token: pt }), "invalid_request");
  });

  it("rejects a bad body, a non-http redirect, an unknown user and an unknown connection", async () => {
    const s = setup();
    await expectCode(createConnectSession(s.deps, T, { external_user_id: "u" }, ORIGIN), "invalid_request");
    await expectCode(
      createConnectSession(s.deps, T, { external_user_id: "u", requested_scopes: ["present.*"], redirect_uri: "javascript:alert(1)" }, ORIGIN),
      "invalid_request"
    );
    await expectCode(listConnections(s.deps, T, "nobody"), "not_found");
    await expectCode(revokeConnection(s.deps, T, "not-a-uuid"), "not_found");
    await expectCode(revokeConnection(s.deps, T, "22222222-2222-4222-8222-222222222222"), "not_found");
    expect(await connectPageView(s.deps, "ct_unknown")).toBeNull();
  });

  it("the simulator is not offered in live", async () => {
    const s = setup();
    const live = { ...T, env: "live" as const };
    const { url } = await createConnectSession(s.deps, live, { external_user_id: "u", requested_scopes: ["present.*"] }, ORIGIN);
    const view = await connectPageView(s.deps, tokenOf(url));
    if (view?.state !== "choose") throw new Error("unreachable");
    expect(view.candidates.map((c) => c.adapter_id)).toEqual(["even_g2"]);
  });
});

describe("Connect flow (Even G2 through the glasses pairing core)", () => {
  it("the end user types the lens code; the glasses' poll collects a token for the SDK device", async () => {
    const s = setup();
    const { url } = await createConnectSession(s.deps, T, { external_user_id: "u", requested_scopes: ["present.display"] }, ORIGIN);
    const token = tokenOf(url);
    expect(await startConnectPairing(s.deps, token, { adapter_id: "even_g2", kind: "glasses" })).toEqual({ method: "enter_code" });

    const pairDeps = { devices: s.glasses.devices, now, connect: s.port, code: () => "ABC234" };
    const started = await startPairing(pairDeps);
    await expectCode(claimConnectPairing(s.deps, token, { adapter_id: "even_g2", kind: "glasses", code: "ZZZ999" }), "invalid_request");
    await claimConnectPairing(s.deps, token, { adapter_id: "even_g2", kind: "glasses", code: "abc-234" });

    const sdkDevice = s.devices[0];
    expect(sdkDevice).toMatchObject({ adapter_id: "even_g2", vendor: "even_realities", end_user_id: s.endUsers[0].id });
    // 🔒 No prosumer device row: D1, the end user has no Dopl account.
    expect(s.glasses.deviceRows).toHaveLength(0);

    const polled = await pairingStatus(pairDeps, started.pair_id, started.poll_secret);
    expect(polled).toMatchObject({ status: "claimed", device_id: sdkDevice.id });
    expect(s.tokens.get(sdkDevice.id)).toMatch(/^[0-9a-f]{64}$/);
    // Collected once, never a second copy.
    expect(await pairingStatus(pairDeps, started.pair_id, started.poll_secret)).toEqual({ status: "claimed" });

    await consentConnect(s.deps, token, { scopes: ["present.display"] });
    expect(s.connections[0].device_id).toBe(sdkDevice.id);
  });

  it("caps wrong-code attempts per session", async () => {
    const s = setup();
    const { url } = await createConnectSession(s.deps, T, { external_user_id: "u", requested_scopes: ["present.display"] }, ORIGIN);
    const token = tokenOf(url);
    for (let i = 0; i < 10; i++) {
      await expectCode(claimConnectPairing(s.deps, token, { adapter_id: "even_g2", kind: "glasses", code: "ZZZ999" }), "invalid_request");
    }
    await expectCode(claimConnectPairing(s.deps, token, { adapter_id: "even_g2", kind: "glasses", code: "ZZZ999" }), "rate_limited");
  });
});
