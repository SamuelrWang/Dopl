import { DEFAULT_PLATFORM } from "../../platforms/registry";
import type { GlassesPlatform } from "../../platforms/types";
import { iso, nowOf, type Clock } from "../clock";
import { isOnline } from "../devices/service";
import type { DeviceStore } from "../devices/types";
import {
  GLASSES_LIMITS as L,
  GlassesValidationError,
  cleanField,
  cleanList,
  cleanSeconds,
  isUuid,
} from "../validation";
import type { GlassesStatus, GlassesStore } from "./types";

/**
 * The lens-notice tools (`glasses_notify|show|get_answer|status`), pure over a
 * {@link GlassesStore} and an injectable clock. Everything is per USER: every
 * active device of the caller receives what is queued here, so text is shaped
 * for the default platform (`platforms/registry.ts`).
 */

/** Longest a single tool call holds for the wearer. Under the MCP route's maxDuration (300). */
export const ASK_HOLD_CAP_SEC = 200;

/** `reply-<channel message id>` cards belong to the reply mirror. */
export const RESERVED_CARD_PREFIX = "reply-";

export interface GlassesDeps extends Clock {
  store: GlassesStore;
  devices: DeviceStore;
  platform?: GlassesPlatform;
  /**
   * The lens NOTICES over the device SDK (W1.2 Gaps #1) for a user whose `sdk_delivery` flag is on;
   * absent = prosumer only. Production: `display/server/sdk-lens.ts › productionSdkNotices`.
   */
  sdkNotices?: GlassesSdkPort;
  /** A lens copy the SDK could not take went through the prosumer queue: put it in the developer log. Never rejects. */
  logFallback?: (userId: string, a: { operation: string; capability: "present.notify" | "present.display"; reason: string }) => Promise<void>;
}

/** One SDK call as the tools read it (`display/server/sdk-lens.ts › SdkNoticeResult`). */
export type GlassesSdkResult<T> = { ok: true; value: T } | { ok: false; code: string; fallback: boolean };

/** One user's SDK notices: their MIGRATED glasses ids, `present.notify` on one, and an action read. */
export interface GlassesSdkUser {
  deviceIds: string[];
  notify(a: { deviceId: string; title: string; body: string; idempotencyKey: string }): Promise<GlassesSdkResult<{ id: string; status: string }>>;
  show(a: { deviceId: string; title: string; lines: string[]; idempotencyKey: string }): Promise<GlassesSdkResult<{ id: string; status: string }>>;
  action(id: string): Promise<GlassesSdkResult<{ id: string; device_id: string; capability: string; status: string; result: Record<string, unknown> | null; updated_at: string }>>;
}

/** Null = flag off. Throws when the flag or key cannot be read: the SDK is unavailable, prosumer path. */
export interface GlassesSdkPort {
  forUser(userId: string): Promise<GlassesSdkUser | null>;
}

/** The SDK's even_g2 notice lifetime (`device-sdk/server/glasses/even-g2-dispatch.ts › SDK_NOTIFY_TTL_S`). */
export const SDK_NOTIFY_TTL_SEC = 60;
/** The SDK's screen lifetime (`even-g2-dispatch.ts › SDK_SCREEN_TTL_S`). */
export const SDK_SHOW_TTL_SEC = 600;

const logNotice = (fields: Record<string, unknown>) => console.info("[glasses] " + JSON.stringify(fields));

/**
 * The user's SDK notices, or why not. 🔒 PER DEVICE, the display seam's rule (`sdk-seam.ts ›
 * sdkLensFor`): only when EVERY active glasses link is migrated; else the prosumer queue, which every
 * device reads (a migrated one through its merged inbox), so no device misses a notice.
 */
async function sdkNoticesFor(
  deps: GlassesDeps,
  userId: string,
): Promise<{ user: GlassesSdkUser; linkIds: string[]; unavailable?: undefined } | { user: null; unavailable?: string }> {
  if (!deps.sdkNotices) return { user: null };
  let user: GlassesSdkUser | null;
  try {
    user = await deps.sdkNotices.forUser(userId);
  } catch (err) {
    return { user: null, unavailable: (err as { code?: unknown })?.code ? String((err as { code: unknown }).code) : "error" };
  }
  if (!user) return { user: null };
  const links = await deps.devices.listDevices(userId);
  if (links.length === 0) return { user: null, unavailable: "no paired glasses" };
  if (links.some((d) => !user.deviceIds.includes(d.id))) return { user: null, unavailable: "unmigrated device" };
  return { user, linkIds: links.map((d) => d.id) };
}

const newKey = () => globalThis.crypto.randomUUID();

export const platformOf = (deps: GlassesDeps): GlassesPlatform => deps.platform ?? DEFAULT_PLATFORM;

export async function glassesNotify(
  deps: GlassesDeps,
  userId: string,
  args: { title?: unknown; body?: unknown; ttl_sec?: unknown },
) {
  const sanitize = platformOf(deps).sanitizeText;
  const title = cleanField(sanitize, "title", args.title, L.title);
  const body = cleanField(sanitize, "body", args.body, L.body);
  const ttl = cleanSeconds("ttl_sec", args.ttl_sec, 60, 5, 86_400);
  const sdk = await sdkNoticesFor(deps, userId);
  let fallbackReason = sdk.unavailable;
  if (sdk.user && ttl !== SDK_NOTIFY_TTL_SEC) fallbackReason = `ttl_sec ${ttl}`; // 🔒 faithful or not at all
  else if (sdk.user) {
    const user = sdk.user;
    const sent = await everyDevice(sdk.linkIds, "glasses_notify", (deviceId, idempotencyKey) => user.notify({ deviceId, title, body, idempotencyKey }));
    if (sent.path === "sdk") {
      logNotice({ evt: "glasses_notify", path: "sdk", devices: sent.devices, ...(sent.status.startsWith("skipped") && { outcome: sent.status }) });
      return { id: sent.id, status: sent.status };
    }
    fallbackReason = sent.reason;
  }
  if (deps.sdkNotices) logNotice({ evt: "glasses_notify", path: fallbackReason ? "prosumer_fallback" : "prosumer", ...(fallbackReason && { fallback_reason: fallbackReason }) });
  if (fallbackReason) await deps.logFallback?.(userId, { operation: "notify.prosumer_fallback", capability: "present.notify", reason: fallbackReason });
  const now = nowOf(deps);
  const row = await deps.store.insert(userId, {
    kind: "notify",
    card_id: null,
    payload: { title, body },
    expires_at: iso(now + ttl * 1000),
    now: iso(now),
  });
  return { id: row.id, status: row.status };
}

/**
 * One lens copy on each migrated device (the prosumer queue reaches every device too). EVERY device
 * is tried: one stale pairing refusing `device_offline` must not keep the notice from a live one.
 * Prosumer fallback ONLY when no device took it and every refusal was proven non-delivery (SDK
 * unavailable, or refused before any lens copy existed); a device that fails after another landed is
 * logged, never re-sent (no double copy). A may-have-landed outcome (unconfirmed, our timeout) or any
 * other refusal reports `skipped:sdk <code>` when no device took it.
 */
async function everyDevice(
  deviceIds: string[],
  evt: "glasses_notify" | "glasses_show",
  send: (deviceId: string, idempotencyKey: string) => Promise<GlassesSdkResult<{ id: string; status: string }>>,
): Promise<{ path: "sdk"; id: string | null; status: string; devices: number } | { path: "prosumer"; reason: string }> {
  const key = newKey();
  let first: { id: string; status: string } | null = null;
  let refusal: string | null = null;
  let proven: string | null = null;
  let landed = 0;
  for (const deviceId of deviceIds) {
    const r = await send(deviceId, `${key}:${deviceId}`);
    if (r.ok) {
      first ??= r.value;
      landed += 1;
    } else {
      if (r.fallback) proven ??= r.code;
      else refusal ??= r.code;
      logNotice({ evt, path: "sdk", device_id: deviceId, outcome: r.code });
    }
  }
  if (!first && proven && !refusal) return { path: "prosumer", reason: proven };
  if (!first) return { path: "sdk", id: null, status: `skipped:sdk ${refusal ?? "no device"}`, devices: 0 };
  return { path: "sdk", id: first.id, status: first.status === "delivered" ? "delivered" : "pending", devices: landed };
}

export async function glassesShow(
  deps: GlassesDeps,
  userId: string,
  args: { title?: unknown; lines?: unknown; card_id?: unknown; ttl_sec?: unknown },
) {
  const sanitize = platformOf(deps).sanitizeText;
  const title = cleanField(sanitize, "title", args.title, L.title);
  const lines = cleanList(sanitize, "lines", args.lines, L.lines, L.line);
  const ttl = cleanSeconds("ttl_sec", args.ttl_sec, 600, 5, 86_400);
  let cardId: string | null = null;
  if (args.card_id !== undefined && args.card_id !== null) {
    if (typeof args.card_id !== "string" || !args.card_id.trim()) {
      throw new GlassesValidationError("card_id must be a non-empty string");
    }
    cardId = args.card_id.trim().slice(0, 64);
    if (cardId.startsWith(RESERVED_CARD_PREFIX)) {
      throw new GlassesValidationError(`card_id may not start with "${RESERVED_CARD_PREFIX}" (reserved for agent replies)`);
    }
  }
  // 🔒 Faithful or not at all: the SDK has no replace-by-id (Gap #11) and screens live SDK_SHOW_TTL_SEC.
  const sdk = await sdkNoticesFor(deps, userId);
  let fallbackReason = sdk.unavailable;
  if (sdk.user && cardId) fallbackReason = "card_id";
  else if (sdk.user && ttl !== SDK_SHOW_TTL_SEC) fallbackReason = `ttl_sec ${ttl}`;
  else if (sdk.user) {
    const user = sdk.user;
    const sent = await everyDevice(sdk.linkIds, "glasses_show", (deviceId, idempotencyKey) => user.show({ deviceId, title, lines, idempotencyKey }));
    if (sent.path === "sdk") {
      logNotice({ evt: "glasses_show", path: "sdk", devices: sent.devices, ...(sent.status.startsWith("skipped") && { outcome: sent.status }) });
      return { id: sent.id, card_id: null, status: sent.status };
    }
    fallbackReason = sent.reason;
  }
  if (deps.sdkNotices) logNotice({ evt: "glasses_show", path: fallbackReason ? "prosumer_fallback" : "prosumer", ...(fallbackReason && { fallback_reason: fallbackReason }) });
  if (fallbackReason) await deps.logFallback?.(userId, { operation: "show.prosumer_fallback", capability: "present.display", reason: fallbackReason });
  const now = nowOf(deps);
  const payload = { title, lines };
  const expiresAt = iso(now + ttl * 1000);
  const existing = cardId ? await deps.store.findActiveCard(userId, cardId, iso(now)) : null;
  const row = existing
    ? await deps.store.refreshCard(userId, existing.id, payload, expiresAt, iso(now))
    : await deps.store.insert(userId, { kind: "show", card_id: cardId, payload, expires_at: expiresAt, now: iso(now) });
  return { id: row.id, card_id: row.card_id, status: row.status };
}

export async function glassesGetAnswer(deps: GlassesDeps, userId: string, args: { id?: unknown }) {
  if (typeof args.id !== "string" || !args.id.trim()) {
    throw new GlassesValidationError("id must be the id glasses_ask / glasses_render returned");
  }
  const id = args.id.trim();
  const row = isUuid(id) ? await deps.store.get(userId, id) : null;
  // SDK action ids are `dev_actions.id` uuids too: a non-uuid id cannot be either, so no SDK read.
  if (!row && isUuid(id)) return sdkGetAnswer(deps, userId, id);
  if (!row) throw new GlassesValidationError(`no glasses message with id ${args.id}`);
  let status: GlassesStatus = row.status;
  const now = nowOf(deps);
  if ((status === "pending" || status === "delivered") && Date.parse(row.expires_at) <= now) {
    if (await deps.store.transition(userId, row.id, ["pending", "delivered"], "expired", iso(now))) status = "expired";
  }
  return { id: row.id, status, answer: row.answer };
}

/**
 * `glasses_get_answer` for an id the prosumer queue does not hold: an SDK action (an ask the display
 * seam put on a migrated G2) read over `actions.get`, in the prosumer result shape. 🔒 Only actions on
 * the caller's own migrated devices are found (`sdk-lens.ts › sdkUserNotices.action`).
 */
async function sdkGetAnswer(deps: GlassesDeps, userId: string, id: string) {
  const missing = (why?: string) => new GlassesValidationError(`no glasses message with id ${id}${why ? ` (device SDK unavailable: ${why})` : ""}`);
  // No per-device rule here: a read, and the port only finds actions on the user's MIGRATED devices.
  if (!deps.sdkNotices) throw missing();
  let user: GlassesSdkUser | null;
  try {
    user = await deps.sdkNotices.forUser(userId);
  } catch (err) {
    throw missing((err as { code?: unknown })?.code ? String((err as { code: unknown }).code) : "error");
  }
  if (!user) throw missing();
  const r = await user.action(id);
  if (!r.ok) throw missing(r.fallback ? r.code : undefined);
  const a = r.value;
  logNotice({ evt: "glasses_get_answer", path: "sdk", status: a.status });
  const res = a.result ?? {};
  if (a.status === "done" && a.capability.startsWith("ask.")) {
    if (res.dismissed === true) return { id: a.id, status: "dismissed" as GlassesStatus, answer: null };
    if (typeof res.index === "number" && typeof res.label === "string") {
      const at = typeof res.answered_at === "string" ? res.answered_at : a.updated_at;
      return { id: a.id, status: "answered" as GlassesStatus, answer: { choice: res.label, index: res.index, at } };
    }
  }
  const status: GlassesStatus = a.status === "failed" ? "expired" : a.status === "queued" || a.status === "needs_confirmation" ? "pending" : "delivered";
  return { id: a.id, status, answer: null };
}

export async function glassesStatus(deps: GlassesDeps, userId: string) {
  const now = nowOf(deps);
  const [devices, activeCount] = await Promise.all([
    deps.devices.listDevices(userId),
    deps.store.countActive(userId, iso(now)),
  ]);
  const lastSeen =
    devices
      .map((d) => d.last_seen)
      .filter((x): x is string => x !== null)
      .sort()
      .at(-1) ?? null;
  return {
    online: devices.some((d) => isOnline(d, now)),
    last_seen: lastSeen,
    active_count: activeCount,
    devices: devices.map((d) => ({ id: d.id, name: d.name, online: isOnline(d, now), last_seen: d.last_seen })),
  };
}
