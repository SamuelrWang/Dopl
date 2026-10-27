import { HttpError } from "@/shared/lib/http-error";
import { claimPairingForConnect } from "@/features/glasses/core/devices/pairing";
import type { ConnectBranding, Device, DeviceAdapter, DeviceKind, RiskTier } from "../../types";
import { ConnectError, MAX_CLAIM_ATTEMPTS, PUBLIC_TOKEN_TTL_MS, hashToken, newToken, publicTokenPrefix, toConnection } from "./dto";
import { defaultGranted, scopeSupported, tierGrants, tierOfScope } from "./scopes";
import { nowOf, sessionByToken, sessionExpired, type ConnectDeps } from "./service";
import type { ConnectSessionRow, Tenant } from "./store-types";
import { enqueueWebhookEvent } from "./webhooks";

/**
 * THE HOSTED PAGE'S SIDE OF CONNECT (`/connect/{token}`, C2 widget steps 1–4). The raw connect
 * token is the only credential: no Dopl session is read anywhere here (D1).
 *
 *   1. pre-check — each adapter × kind the session allows, with what its `describe()` supports
 *   2. pair      — per adapter: the simulator DISPLAYS its code (the simulated device enters it);
 *                  the G2 shows its code on the lens and the end user types it here
 *   3. consent   — the requested scopes the device supports, grouped by risk tier; T2+ unticked
 *   4. done      — a `connections` row, `connection.created` in the outbox, and a one-time
 *                  public token on the redirect
 */

/** How each Connect-capable adapter pairs. Adapters absent here are not offered on the page. */
const PAIRING_STYLE: Record<string, "display_code" | "enter_code"> = {
  simulator: "display_code",
  even_g2: "enter_code",
};

const LABELS: Record<string, string> = { even_g2: "Even G2" };
const kindLabel = (k: DeviceKind) => k.replace("_", " ");
const deviceLabel = (adapterId: string, kind: DeviceKind) =>
  LABELS[adapterId] ?? (adapterId === "simulator" ? `Simulated ${kindLabel(kind)}` : kindLabel(kind));

export interface ConnectCandidate {
  adapter_id: string;
  kind: DeviceKind;
  label: string;
  pairing: "display_code" | "enter_code";
  /** Requested scopes this model supports / does not (the compatibility pre-check). */
  supported: string[];
  unsupported: string[];
}

export interface ConsentScope {
  scope: string;
  tier: RiskTier;
  checked: boolean;
}

export type ConnectPageView =
  | { state: "expired" | "done"; branding: ConnectBranding }
  | { state: "choose"; branding: ConnectBranding; candidates: ConnectCandidate[] }
  | { state: "consent"; branding: ConnectBranding; device: string; scopes: ConsentScope[] };

/** A device stand-in for `describe()` before one exists (descriptors depend on kind only). */
const prototype = (adapter: DeviceAdapter, kind: DeviceKind): Device => ({
  id: "precheck",
  kind,
  vendor: adapter.id,
  model: adapter.id,
  firmware: null,
  adapter_id: adapter.id,
  adapter_version: adapter.version,
  capabilities: [],
  online: false,
  last_seen_at: null,
});

const tenantOf = (s: ConnectSessionRow): Tenant => ({ projectId: s.project_id, env: s.env });
const brandingOf = (s: ConnectSessionRow): ConnectBranding => s.branding as ConnectBranding;

function candidates(deps: ConnectDeps, s: ConnectSessionRow): ConnectCandidate[] {
  const out: ConnectCandidate[] = [];
  for (const adapter of deps.adapters.list({ env: s.env })) {
    const pairing = PAIRING_STYLE[adapter.id];
    if (!pairing) continue;
    for (const kind of adapter.kinds.filter((k) => s.allowed_kinds.includes(k))) {
      const descriptors = adapter.describe(prototype(adapter, kind));
      out.push({
        adapter_id: adapter.id,
        kind,
        label: deviceLabel(adapter.id, kind),
        pairing,
        supported: s.requested_scopes.filter((sc) => scopeSupported(sc, descriptors)),
        unsupported: s.requested_scopes.filter((sc) => !scopeSupported(sc, descriptors)),
      });
    }
  }
  return out;
}

/** The scopes the consent screen offers for the paired device, highest tier last. */
async function consentScopes(deps: ConnectDeps, s: ConnectSessionRow): Promise<{ label: string; scopes: ConsentScope[] }> {
  const device = s.device_id ? await deps.store.getDevice(s.device_id) : null;
  const adapter = device ? deps.adapters.get(device.adapter_id) : null;
  if (!device || !adapter) throw new ConnectError("not_found", "The paired device is gone. Start again.");
  const descriptors = adapter.describe(prototype(adapter, device.kind));
  const scopes = s.requested_scopes
    .filter((sc) => scopeSupported(sc, descriptors))
    .map((scope) => ({ scope, tier: tierOfScope(scope), checked: defaultGranted(tierOfScope(scope)) }))
    .sort((a, b) => a.tier.localeCompare(b.tier));
  return { label: device.display_name, scopes };
}

/** What the page renders for a token; null = unknown token (the page 404s, not an oracle). */
export async function connectPageView(deps: ConnectDeps, token: string): Promise<ConnectPageView | null> {
  const s = await sessionByToken(deps, token);
  if (!s) return null;
  const branding = brandingOf(s);
  if (s.status === "consented" || s.status === "exchanged") return { state: "done", branding };
  if (sessionExpired(deps, s)) return { state: "expired", branding };
  if (s.status === "open") return { state: "choose", branding, candidates: candidates(deps, s) };
  const { label, scopes } = await consentScopes(deps, s);
  return { state: "consent", branding, device: label, scopes };
}

/** A live session in `status`, or a ConnectError. */
async function liveSession(deps: ConnectDeps, token: string, status: ConnectSessionRow["status"]): Promise<ConnectSessionRow> {
  const s = await sessionByToken(deps, token);
  if (!s) throw new ConnectError("not_found", "Unknown Connect session.");
  if (sessionExpired(deps, s)) throw new ConnectError("invalid_request", "This Connect session has expired.");
  if (s.status !== status) throw new ConnectError("invalid_request", "This step is already done.");
  return s;
}

function pickCandidate(deps: ConnectDeps, s: ConnectSessionRow, adapterId: unknown, kind: unknown) {
  const c = candidates(deps, s).find((x) => x.adapter_id === adapterId && x.kind === kind);
  const adapter = c && deps.adapters.get(c.adapter_id);
  if (!c || !adapter) throw new ConnectError("invalid_request", "That device is not available in this session.");
  return { candidate: c, adapter };
}

/** Step 2a: what the page shows to pair. Stateless; the claim re-derives it. */
export async function startConnectPairing(
  deps: ConnectDeps,
  token: string,
  input: { adapter_id?: unknown; kind?: unknown }
): Promise<{ method: "display_code"; code: string; expires_at: string } | { method: "enter_code" }> {
  const s = await liveSession(deps, token, "open");
  const { candidate, adapter } = pickCandidate(deps, s, input.adapter_id, input.kind);
  if (candidate.pairing === "enter_code") return { method: "enter_code" };
  const flow = await adapter.pair({ connect_session_id: s.id, project_id: s.project_id, external_user_id: s.external_user_id, env: s.env });
  if (flow.method !== "code") throw new ConnectError("capability_unsupported", `${adapter.id} pairs by ${flow.method}, not supported here yet.`);
  return { method: "display_code", code: flow.code, expires_at: flow.expires_at };
}

/** Step 2b: the code is entered → an SDK-owned `devices` row; session open → paired. */
export async function claimConnectPairing(
  deps: ConnectDeps,
  token: string,
  input: { adapter_id?: unknown; kind?: unknown; code?: unknown }
): Promise<{ ok: true }> {
  const s = await liveSession(deps, token, "open");
  if (s.claim_attempts >= MAX_CLAIM_ATTEMPTS) throw new ConnectError("rate_limited", "Too many attempts. Start a new Connect session.");
  const { candidate, adapter } = pickCandidate(deps, s, input.adapter_id, input.kind);
  const code = typeof input.code === "string" ? input.code : "";
  const wrongCode = async (message: string) => {
    await deps.store.bumpClaimAttempts(s.id);
    return new ConnectError("invalid_request", message);
  };
  const createDevice = async (now: string) =>
    (
      await deps.store.insertDevice({
        kind: candidate.kind,
        vendor: adapter.id === "simulator" ? "dopl" : adapter.id === "even_g2" ? "even_realities" : adapter.id,
        model: adapter.id === "simulator" ? `simulated_${candidate.kind}` : adapter.id,
        adapter_id: adapter.id,
        adapter_version: adapter.version,
        display_name: candidate.label,
        project_id: s.project_id,
        env: s.env,
        end_user_id: s.end_user_id,
        now,
      })
    ).id;
  const discardDevice = (id: string, now: string) => deps.store.revokeDevice(id, now);

  let deviceId: string;
  if (candidate.pairing === "display_code") {
    const flow = await adapter.pair({ connect_session_id: s.id, project_id: s.project_id, external_user_id: s.external_user_id, env: s.env });
    if (flow.method !== "code" || code.trim().toUpperCase() !== flow.code) throw await wrongCode("That code does not match.");
    deviceId = await createDevice(new Date(nowOf(deps)).toISOString());
  } else {
    if (!deps.glasses) throw new ConnectError("capability_unsupported", "Glasses pairing is not available.");
    try {
      ({ device_id: deviceId } = await claimPairingForConnect(
        { devices: deps.glasses.devices, connect: deps.glasses.port, now: deps.now },
        { code, createDevice, discardDevice }
      ));
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) throw await wrongCode(err.message);
      throw err;
    }
  }
  if (!(await deps.store.transitionSession(s.id, "open", { status: "paired", device_id: deviceId }))) {
    await discardDevice(deviceId, new Date(nowOf(deps)).toISOString());
    throw new ConnectError("invalid_request", "This step is already done.");
  }
  return { ok: true };
}

/**
 * Step 3: consent. `scopes` must be requested AND supported; anything unticked is simply not granted
 * (a downgrade). A T4 grant records consent only — every T4 call still needs confirmation (C7, A5).
 */
export async function consentConnect(
  deps: ConnectDeps,
  token: string,
  input: { scopes?: unknown }
): Promise<{ redirect_url: string | null }> {
  const s = await liveSession(deps, token, "paired");
  const { scopes: offered } = await consentScopes(deps, s);
  const allowed = new Set(offered.map((o) => o.scope));
  const chosen = Array.isArray(input.scopes) ? [...new Set(input.scopes.filter((x): x is string => typeof x === "string"))] : [];
  if (chosen.length === 0) throw new ConnectError("invalid_request", "Grant at least one permission.");
  const stray = chosen.find((x) => !allowed.has(x));
  if (stray) throw new ConnectError("invalid_request", `${stray} was not requested or is not supported by this device.`);

  const now = new Date(nowOf(deps));
  const tenant = tenantOf(s);
  const connection = await deps.store.insertConnection({
    project_id: s.project_id,
    env: s.env,
    end_user_id: s.end_user_id,
    device_id: s.device_id!,
    granted_scopes: chosen,
    tier_grants: tierGrants(chosen),
    expires_at: null,
    now: now.toISOString(),
  });
  const publicToken = newToken(publicTokenPrefix(s.env));
  const won = await deps.store.transitionSession(s.id, "paired", {
    status: "consented",
    connection_id: connection.id,
    public_token_hash: hashToken(publicToken),
    public_token_expires_at: new Date(now.getTime() + PUBLIC_TOKEN_TTL_MS).toISOString(),
  });
  if (!won) {
    await deps.store.revokeConnection(tenant, connection.id, now.toISOString());
    throw new ConnectError("invalid_request", "This step is already done.");
  }
  const device = await deps.store.getDevice(connection.device_id);
  if (device) {
    const dto = await toConnection(connection, device, s.external_user_id, deps.adapters);
    await enqueueWebhookEvent(deps.store, tenant, "connection.created", dto as unknown as Record<string, unknown>, now);
  }
  if (!s.redirect_uri) return { redirect_url: null };
  const url = new URL(s.redirect_uri);
  url.searchParams.set("public_token", publicToken);
  return { redirect_url: url.toString() };
}
