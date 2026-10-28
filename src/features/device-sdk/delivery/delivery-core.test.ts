/**
 * A5 pure core: profile precedence, the policy engine (grant / tier / T4 / rate), the router's
 * table (presence, capability, grant, urgency) and D3 enforcement (truncate vs send_to vs callback).
 */
import { describe, expect, it } from "vitest";
import { GLASSES_REPLY_GUIDANCE } from "./glasses-guidance";
import { GLASSES_REPLY_GUIDANCE as MCP_COPY } from "../../../../packages/mcp-server/src/tools/channel-source";
import { createSimulatorAdapter } from "../adapters/simulator";
import { ContextProfileSchema, DEVICE_KINDS, type ContextProfile, type Device, type DeviceKind } from "../types";
import { DOPL_KIND_PROFILES, DOPL_MODEL_PROFILES } from "./default-profiles";
import { enforce, limitsFor, truncateText } from "./enforce";
import { checkGrant, checkRateLimit, evaluatePolicy, type DeviceGrant } from "./policy";
import { resolveProfile, scopeCovers, UnknownProfileError } from "./resolve-profile";
import { route, type RouteCandidate } from "./router";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const sim = createSimulatorAdapter({ now: () => NOW });

function device(kind: DeviceKind, over: Partial<Device> = {}): Device {
  const base: Device = {
    id: over.id ?? `${kind}-1`,
    kind,
    vendor: "dopl",
    model: over.model ?? `sim_${kind}`,
    firmware: null,
    adapter_id: "simulator",
    adapter_version: "0.1.0",
    capabilities: [],
    online: true,
    last_seen_at: new Date(NOW - 10_000).toISOString(),
    ...over,
  };
  return { ...base, capabilities: over.capabilities ?? sim.describe(base) };
}

const ALL: DeviceGrant = {
  scopes: (["state.*", "present.*", "ask.*", "capture.*", "input.*", "act.*", "act.motion.*"] as const).map((scope) => ({ scope, maxTier: "T4" })),
  status: "active",
  expiresAt: null,
  revokedAt: null,
};
const cand = (d: Device, grant: DeviceGrant | null = ALL, profile: ContextProfile = DOPL_KIND_PROFILES[d.kind]): RouteCandidate => ({ device: d, grant, profile });
const base = { capabilities: ["present.display", "present.notify"] as const, urgency: "normal" as const, lastSourceKind: null, now: NOW, target: "auto" };

describe("default profiles", () => {
  it("one per device kind, each a valid frozen-contract profile; T4 never `none`", () => {
    for (const k of DEVICE_KINDS) {
      const p = ContextProfileSchema.parse(DOPL_KIND_PROFILES[k]);
      expect(p.match.kind).toBe(k);
      expect(p.confirmation?.T4).toBe("deny");
    }
    for (const p of DOPL_MODEL_PROFILES) ContextProfileSchema.parse(p);
  });

  it("🔒 the glasses default IS GLASSES_REPLY_GUIDANCE (byte-identical to the MCP copy)", () => {
    expect(DOPL_KIND_PROFILES.glasses.prompt_append).toBe(GLASSES_REPLY_GUIDANCE);
    expect(MCP_COPY).toBe(GLASSES_REPLY_GUIDANCE);
  });

  it("glasses are concise, a laptop is long", () => {
    expect(DOPL_KIND_PROFILES.glasses.output.max_lines).toBe(5);
    expect(DOPL_KIND_PROFILES.desktop.output.max_chars).toBeUndefined();
  });
});

describe("resolveProfile precedence: project override → Dopl model default → per-kind fallback", () => {
  const subject = { kind: "glasses" as const, model: "even_g2", posture: "glanceable" as const };
  const ar: ContextProfile = {
    id: "my-ar",
    version: 2,
    match: { kind: "glasses" },
    prompt_append: "User is on AR glasses. Reply in one line.",
    output: { max_lines: 1 },
    allowed_capabilities: ["present.*"],
    overflow: "callback",
  };

  it("project override wins, and can append its own system prompt", () => {
    const r = resolveProfile(subject, [ar]);
    expect(r).toMatchObject({ source: "project", profile: { id: "my-ar", prompt_append: ar.prompt_append } });
  });
  it("then the Dopl model default, then the per-kind fallback", () => {
    expect(resolveProfile(subject, []).profile.id).toBe("even_g2-default");
    expect(resolveProfile({ ...subject, model: "other" }, []).profile.id).toBe("glasses-default");
    expect(resolveProfile({ kind: "robot", model: "x", posture: "unknown" }, []).source).toBe("dopl_kind");
  });
  it("most specific project match wins; a non-matching override is ignored", () => {
    const model: ContextProfile = { ...ar, id: "g2-only", match: { kind: "glasses", model: "even_g2" } };
    const phone: ContextProfile = { ...ar, id: "phone", match: { kind: "phone" } };
    expect(resolveProfile(subject, [ar, model, phone]).profile.id).toBe("g2-only");
    expect(resolveProfile({ ...subject, model: "x" }, [phone]).profile.id).toBe("glasses-default");
  });
  it("an explicit profile id must exist in the project", () => {
    expect(resolveProfile(subject, [ar], "my-ar").source).toBe("requested");
    expect(() => resolveProfile(subject, [], "nope")).toThrow(UnknownProfileError);
  });
  it("scopes: family wildcard covers its own family only", () => {
    expect(scopeCovers("present.*", "present.display")).toBe(true);
    expect(scopeCovers("act.*", "act.motion.move")).toBe(false);
    expect(scopeCovers("act.motion.*", "act.motion.move")).toBe(true);
  });
});

describe("policy engine (light C7)", () => {
  it("grant present, unexpired, active, covering scope and tier", () => {
    expect(checkGrant(null, "present.display", NOW)).toMatchObject({ ok: false, code: "grant_missing" });
    expect(checkGrant({ ...ALL, expiresAt: new Date(NOW - 1).toISOString() }, "present.display", NOW)).toMatchObject({ code: "grant_expired" });
    expect(checkGrant({ ...ALL, status: "needs_reauth" }, "present.display", NOW)).toMatchObject({ code: "needs_reauth" });
    expect(checkGrant({ ...ALL, revokedAt: new Date(NOW).toISOString() }, "present.display", NOW)).toMatchObject({ code: "grant_missing" });
    const t1 = { ...ALL, scopes: [{ scope: "act.*" as const, maxTier: "T1" as const }] };
    expect(checkGrant(t1, "act.set", NOW)).toMatchObject({ ok: false, code: "grant_missing" });
    expect(checkGrant(ALL, "act.set", NOW)).toEqual({ ok: true });
  });

  it("🔒 T4 is denied by default, even with a T4 grant", () => {
    const r = evaluatePolicy({ capability: "act.lock", grant: ALL, profile: DOPL_KIND_PROFILES.home_device, now: NOW });
    expect(r).toMatchObject({ ok: false, code: "confirmation_denied" });
  });
  it("T4 with confirmation configured → needs confirmation on every call (never `none`)", () => {
    const p = { ...DOPL_KIND_PROFILES.home_device, confirmation: { T4: "trusted_surface" as const } };
    expect(evaluatePolicy({ capability: "act.lock", grant: ALL, profile: p, now: NOW })).toMatchObject({ ok: true, confirmation: { required: true } });
    const sneaky = { ...p, confirmation: { T4: "none" } } as unknown as ContextProfile;
    expect(evaluatePolicy({ capability: "act.lock", grant: ALL, profile: sneaky, now: NOW })).toMatchObject({ ok: false, code: "confirmation_denied" });
  });
  it("T1 allowed; T3 allowed unless the profile asks for confirmation", () => {
    expect(evaluatePolicy({ capability: "present.display", grant: ALL, profile: DOPL_KIND_PROFILES.phone, now: NOW })).toMatchObject({ ok: true, confirmation: { required: false } });
    const p = { ...DOPL_KIND_PROFILES.home_device, confirmation: { T3: "on_device" as const, T4: "deny" as const } };
    expect(evaluatePolicy({ capability: "act.set", grant: ALL, profile: p, now: NOW })).toMatchObject({ ok: true, confirmation: { required: true } });
  });
  it("rate limit per project", () => {
    expect(checkRateLimit(9, { max: 10, windowMs: 1000 })).toEqual({ ok: true });
    expect(checkRateLimit(10, { max: 10, windowMs: 1000 })).toMatchObject({ ok: false, code: "rate_limited" });
  });
});

describe("router (C5 steps 1–4)", () => {
  it("presence: offline devices are filtered; none online → device_offline", () => {
    const r = route({ ...base, candidates: [cand(device("phone", { online: false })), cand(device("glasses"))] });
    expect(r.ok && r.chosen[0].candidate.device.kind).toBe("glasses");
    expect(route({ ...base, candidates: [cand(device("phone", { online: false }))] })).toMatchObject({ ok: false, code: "device_offline" });
  });
  it("capability: a device without the capability (or whose profile disallows it) is skipped", () => {
    const r = route({ ...base, candidates: [cand(device("home_device")), cand(device("watch"))] });
    expect(r.ok && r.chosen[0].candidate.device.kind).toBe("watch");
    expect(route({ ...base, candidates: [cand(device("home_device"))] })).toMatchObject({ ok: false, code: "capability_unsupported" });
  });
  it("grant: an ungranted device is skipped; none granted → the grant's code", () => {
    const newer = device("glasses", { last_seen_at: new Date(NOW - 1000).toISOString() });
    const r = route({ ...base, candidates: [cand(newer, null), cand(device("phone"))] });
    expect(r.ok && r.chosen[0].candidate.device.kind).toBe("phone");
    const expired = { ...ALL, expiresAt: new Date(NOW - 5).toISOString() };
    expect(route({ ...base, candidates: [cand(newer, expired)] })).toMatchObject({ ok: false, code: "grant_expired" });
  });
  it("rank: last message source, then most recently active", () => {
    const older = device("glasses", { last_seen_at: new Date(NOW - 60_000).toISOString() });
    const newer = device("phone", { last_seen_at: new Date(NOW - 1_000).toISOString() });
    const r1 = route({ ...base, candidates: [cand(older), cand(newer)] });
    expect(r1.ok && r1.chosen[0].candidate.device.kind).toBe("phone");
    expect(r1.ok && r1.decision.reason).toMatch(/most recently active/);
    const r2 = route({ ...base, lastSourceKind: "glasses", candidates: [cand(older), cand(newer)] });
    expect(r2.ok && r2.chosen[0].candidate.device.kind).toBe("glasses");
    expect(r2.decision.candidates).toEqual([older.id, newer.id]);
  });
  it("urgency: high fans out, low waits for the active device", () => {
    const g = device("glasses", { last_seen_at: new Date(NOW - 1_000).toISOString() });
    const p = device("phone", { last_seen_at: new Date(NOW - 50_000).toISOString() });
    const high = route({ ...base, urgency: "high", candidates: [cand(g), cand(p)] });
    expect(high.ok && high.chosen.map((c) => c.candidate.device.id)).toEqual([g.id, p.id]);
    const low = route({ ...base, urgency: "low", candidates: [cand(g), cand(p)] });
    expect(low.ok && low.chosen[0].candidate.device.id).toBe(g.id);
    const lowNoGrant = route({ ...base, urgency: "low", candidates: [cand(g, null), cand(p)] });
    expect(lowNoGrant).toMatchObject({ ok: false, code: "device_offline" });
  });
  it("target: a kind or a device id narrows the set", () => {
    const g = device("glasses");
    const p = device("phone");
    const r = route({ ...base, target: "phone", candidates: [cand(g), cand(p)] });
    expect(r.ok && r.chosen[0].candidate.device.id).toBe(p.id);
    expect(route({ ...base, target: "nope", candidates: [cand(g)] })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("enforcement (D3: never rewrite)", () => {
  const long = Array.from({ length: 9 }, (_, i) => `line ${i + 1} é`).join("\n");
  const glasses = DOPL_KIND_PROFILES.glasses;

  it("truncate keeps an exact prefix: no ellipsis, no added or changed character", () => {
    const p = { ...glasses, overflow: "truncate" as const };
    const out = enforce({ text: long }, p, limitsFor(p, null));
    expect(out.kind).toBe("truncated");
    const text = out.kind === "truncated" ? out.content.text! : "";
    expect(long.startsWith(text)).toBe(true);
    expect(text.split("\n")).toHaveLength(5);
  });
  it("byte limits never split a code point", () => {
    expect(truncateText("aé", { max_bytes: 2 })).toBe("a");
    expect(truncateText("aé", { max_bytes: 3 })).toBe("aé");
  });
  it("send_to: content unchanged, the target kind named", () => {
    const out = enforce({ text: long }, glasses, limitsFor(glasses, null));
    expect(out).toMatchObject({ kind: "send_to", to: "phone" });
  });
  it("callback: nothing delivered, limits handed back", () => {
    const p = { ...glasses, overflow: "callback" as const };
    const out = enforce({ text: long }, p, limitsFor(p, null));
    expect(out).toMatchObject({ kind: "callback", limits: { max_lines: 5, max_chars: 300 }, measured: { lines: 9 } });
  });
  it("fits → untouched; descriptor limits tighten the profile's", () => {
    expect(enforce({ text: "hi" }, glasses, limitsFor(glasses, null))).toEqual({ kind: "fits", content: { text: "hi" } });
    const d = { capability: "present.display" as const, limits: { max_blocks: 2, max_text_bytes: 4 }, latency_class: "interactive" as const, risk_tier: "T1" as const, since_adapter: "x@1" };
    expect(limitsFor(glasses, d)).toMatchObject({ max_blocks: 2, max_bytes: 4, max_lines: 5 });
  });
});
