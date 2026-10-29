import "server-only";
import { Dopl, DoplError, type Action, type DeliverResponse, type DisplayBlock as SdkBlock } from "@dopl/sdk";
import { sdkDeliveryFor } from "@/features/device-sdk/server/sdk-delivery-flag";
import type { DisplayBlock, Positioned } from "../core/types";

/**
 * **THE LENS COPY OVER `@dopl/sdk`** (Plan "Dopl SDK Split" §7.1, W1.2). For a Dopl user whose
 * `sdk_delivery` flag is on, the display seam reaches their glasses the way any developer would: the
 * app backend calls `/api/v1` with the Dopl App project's secret key (`DOPL_APP_SDK_KEY`, SERVER ONLY;
 * the desktop and the browser never hold it), `external_user_id` = the Dopl user id. Every call shows
 * in the developer portal's log, and is timed here (`[display] {"evt":"sdk_lens",…}`).
 *
 * 🔒 NO HELD FUNCTION (gap #3). Every call sends `Prefer: respond-async`, so an ask returns as soon as
 * it is delivered; nothing waits on the wearer here or in `/api/v1`. The answer is read later: the
 * glasses' answer route bridges it to the channel decision (`answer.ts › answerFromSdkLens`), and a
 * `wait` hold reads it with {@link SdkUserLens.askOutcome}.
 *
 * 🔒 FAILURE CLASSES (gap #6; the caller acts on {@link SdkLensError}):
 *   - `fallback`: PROVEN that nothing was delivered (no key, flag lookup failed, key refused 401/403,
 *     or the connection never opened). The caller takes the prosumer lens path, which a migrated G2
 *     still reads through its legacy token (`device-handlers.ts › mergedQueue`). One copy.
 *   - `unconfirmed`: the call MAY have landed (HTTP 5xx, connection lost after it opened, our timeout,
 *     an unreadable 2xx). A write is replayed ONCE with the same idempotency key, which `/api/v1`
 *     dedupes: the replay either returns the first delivery or makes it. Still unknown after that =
 *     a refusal `unconfirmed`, never the prosumer path: a second lens copy is worse than none.
 *   - refusal: the SDK ANSWERED no (device offline, content refused, rate limited). The caller reports
 *     `skipped:sdk <code>`; never a second copy.
 * A READ (`state`) delivers nothing, so an unconfirmed read is simply unavailable (fallback).
 */

/** A context / connections / show / ask call that takes longer is abandoned (classed unconfirmed). */
export const SDK_CALL_TIMEOUT_MS = 10_000;

/** RFC 7240: `/api/v1` answers an ask at once instead of holding it ≤200s (`delivery-routes.ts`). */
export const SDK_LENS_HEADERS = { Prefer: "respond-async" } as const;

export interface LensDevices {
  paired: boolean;
  online: boolean;
}

/** A started SDK ask: the action to read its answer from. */
export interface SdkAskTicket {
  deliveryId: string;
  deviceId: string | null;
}

/** A SETTLED SDK ask (an open one reads as null). */
export type SdkAskOutcome =
  | { status: "answered"; index: number; label: string; deviceId: string | null }
  | { status: "dismissed"; deviceId: string | null }
  | { status: "refused"; code: string };

export class SdkLensError extends Error {
  constructor(
    readonly code: string,
    /** True: PROVEN nothing was delivered; take the prosumer path. */
    readonly fallback: boolean,
    /** True: the call may have landed; a write replays once with the same key (never a fallback). */
    readonly unconfirmed = false,
  ) {
    super(`sdk lens: ${code}`);
    this.name = "SdkLensError";
  }
}

/** One user's lens over the SDK. */
export interface SdkUserLens {
  state(): Promise<LensDevices>;
  screen(a: { blocks: Positioned<DisplayBlock>[]; idempotencyKey: string }): Promise<DeliverResponse>;
  /** Delivers the ask card and returns; never waits for the wearer. Throws {@link SdkLensError}. */
  startAsk(a: { question: string; options: string[]; idempotencyKey: string }): Promise<SdkAskTicket>;
  /** One read of a started ask: its outcome once settled, null while open or when the read failed (logged). */
  askOutcome(deliveryId: string): Promise<SdkAskOutcome | null>;
}

export interface SdkLens {
  /**
   * The user's SDK lens when their flag is on, with the ids of their MIGRATED glasses (the seam routes
   * per device: `sdk-seam.ts › sdkLensFor`); null when off. Throws {@link SdkLensError} (fallback).
   */
  forUser(userId: string): Promise<{ lens: SdkUserLens; deviceIds: string[] } | null>;
}

const log = (fields: Record<string, unknown>) => console.info("[display] " + JSON.stringify({ evt: "sdk_lens", ...fields }));

/**
 * Connection-phase failures: the request never left this process (DNS, refused, unreachable, connect
 * timeout, TLS handshake). Anything else (a reset, a socket closed mid-response) may have been read.
 */
const PRE_SEND_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/** True when every error in `err`'s cause chain that names a code names a connection-phase one. */
export function isPreSendFailure(err: unknown, depth = 0): boolean {
  if (depth > 4 || !err || typeof err !== "object") return false;
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string") return PRE_SEND_CODES.has(e.code);
  // Happy eyeballs: one AggregateError per address, all of them must have failed to connect.
  if (Array.isArray(e.errors) && e.errors.length > 0) return e.errors.every((x) => isPreSendFailure(x, depth + 1));
  return isPreSendFailure(e.cause, depth + 1);
}

/**
 * The SDK maps every fetch throw to `network_error` and keeps only its message, so the lens's own fetch
 * records, per call (keyed by the call's own AbortSignal), whether the request never left.
 */
const preSendFailed = new WeakSet<AbortSignal>();

export function preSendAwareFetch(inner: (input: string, init: RequestInit) => Promise<Response>) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    try {
      return await inner(input, init);
    } catch (err) {
      if (init.signal && !init.signal.aborted && isPreSendFailure(err)) preSendFailed.add(init.signal);
      throw err;
    }
  };
}

/** Which class an SDK failure falls in. `timedOut`: OUR timeout fired; `preSend`: it never left. */
export function classify(err: unknown, o: { timedOut?: boolean; preSend?: boolean } = {}): SdkLensError {
  if (o.timedOut) return new SdkLensError("timeout", false, true);
  if (!(err instanceof DoplError)) return new SdkLensError("error", false, true);
  if (err.code === "network_error") return o.preSend ? new SdkLensError("network_error", true) : new SdkLensError("network_error", false, true);
  if (err.status !== null && err.status >= 500) return new SdkLensError(String(err.code), false, true);
  // Rejected at the key check, before any write (`with-developer-key.ts`).
  if (err.type === "authentication_error" || err.type === "permission_error") return new SdkLensError(String(err.code), true);
  // A 2xx we could not read: it landed.
  if (err.status !== null && err.status < 300) return new SdkLensError(String(err.code), false, true);
  return new SdkLensError(String(err.code), false);
}

/** Positions (`x`/`y`/`w`/`h`) are the app's absolute layout; the contract's blocks are a stack. */
export function toSdkBlocks(blocks: Positioned<DisplayBlock>[]): SdkBlock[] {
  return blocks.map((b) => {
    const rest: Record<string, unknown> = { ...b };
    for (const k of ["x", "y", "w", "h"]) delete rest[k];
    return rest as SdkBlock;
  });
}

/** Time one SDK call, log it, and map any failure to {@link SdkLensError}. */
async function timed<T>(op: string, fn: (signal: AbortSignal) => Promise<T>, extra: (r: T) => Record<string, unknown> = () => ({})): Promise<T> {
  const started = Date.now();
  const timeout = AbortSignal.timeout(SDK_CALL_TIMEOUT_MS);
  try {
    const r = await fn(timeout);
    log({ op, ms: Date.now() - started, outcome: "ok", ...extra(r) });
    return r;
  } catch (err) {
    const e = classify(err, { timedOut: timeout.aborted, preSend: preSendFailed.has(timeout) });
    log({ op, ms: Date.now() - started, outcome: e.code, fallback: e.fallback, ...(e.unconfirmed && { unconfirmed: true }) });
    throw e;
  }
}

/** A read delivers nothing: "may have landed" means nothing here, so it is plainly unavailable. */
async function read<T>(op: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  try {
    return await timed(op, fn);
  } catch (err) {
    if (err instanceof SdkLensError && err.unconfirmed) throw new SdkLensError(err.code, true);
    throw err;
  }
}

/**
 * A WRITE that puts a copy on the lens, delivered AT MOST ONCE: one call, and when its outcome is
 * unknown ONE replay with the same idempotency key (same body), which `/api/v1` answers from the stored
 * action if the first one landed. A replay that cannot settle it is `unconfirmed`: a refusal, not a
 * fallback, since proof that the REPLAY never left says nothing about the first call.
 */
async function deliverOnce<T>(op: string, fn: (signal: AbortSignal) => Promise<T>, extra: (r: T) => Record<string, unknown>): Promise<T> {
  try {
    return await timed(op, fn, extra);
  } catch (first) {
    if (!(first instanceof SdkLensError) || !first.unconfirmed) throw first;
    try {
      return await timed(`${op}_replay`, fn, (r) => ({ ...extra(r), after: first.code }));
    } catch (again) {
      if (again instanceof SdkLensError && !again.fallback && !again.unconfirmed) throw again;
      throw new SdkLensError("unconfirmed", false);
    }
  }
}

const deliveryFields = (r: DeliverResponse) => ({ delivery_id: r.delivery_id, status: r.status });

/** A settled action's outcome; null while it is open. */
export function askOutcomeOf(a: Pick<Action, "status" | "result" | "error" | "device_id">): SdkAskOutcome | null {
  const deviceId = a.device_id || null;
  if (a.status === "failed") return { status: "refused", code: a.error?.code ?? "vendor_error" };
  if (a.status !== "done") return null;
  const r = a.result ?? {};
  if (r.dismissed === true) return { status: "dismissed", deviceId };
  if (typeof r.index === "number" && typeof r.label === "string") return { status: "answered", index: r.index, label: r.label, deviceId };
  return { status: "refused", code: "unexpected_answer" };
}

/**
 * An SDK lens for one user, over a ready client. Exported for the round-trip suite. Production builds
 * the client with {@link SDK_LENS_HEADERS} and {@link preSendAwareFetch} (`createSdkLens`).
 */
export function sdkUserLens(dopl: Dopl, userId: string): SdkUserLens {
  return {
    async state() {
      try {
        const ctx = await read("context", (signal) => dopl.users.context(userId, { signal }));
        if (ctx.available.some((d) => d.kind === "glasses")) return { paired: true, online: true };
        const list = await read("connections", (signal) => dopl.connections.list(userId, { signal }));
        return { paired: list.data.some((c) => c.status === "active" && c.device.kind === "glasses"), online: false };
      } catch (err) {
        // No end user yet under the Dopl App project = nothing paired through the SDK.
        if (err instanceof SdkLensError && err.code === "not_found") return { paired: false, online: false };
        throw err;
      }
    },

    screen({ blocks, idempotencyKey }) {
      return deliverOnce("show", (signal) => dopl.show(userId, { blocks: toSdkBlocks(blocks), target: "glasses", idempotencyKey, signal }), deliveryFields);
    },

    async startAsk({ question, options, idempotencyKey }) {
      // `users.deliver`, not the `ask` helper: the helper polls until answered, which is the hold this avoids.
      const r = await deliverOnce(
        "ask",
        (signal) =>
          dopl.users.deliver(
            userId,
            { intent: "ask", content: { text: question, options: options.map((label) => ({ label })) }, target: "glasses", urgency: "normal" },
            { idempotencyKey, signal },
          ),
        deliveryFields,
      );
      // Accepted but not on the lens (over the profile's limits, or held for a confirmation): nothing shows.
      if (r.status === "failed" || r.status === "needs_confirmation") throw new SdkLensError(r.status, false);
      return { deliveryId: r.delivery_id, deviceId: r.routed_to?.device_id ?? null };
    },

    async askOutcome(deliveryId) {
      try {
        return askOutcomeOf(await timed("ask_read", (signal) => dopl.actions.get(deliveryId, { signal }), (a) => ({ status: a.status })));
      } catch {
        // Logged by `timed`; the hold reads again on its next pass.
        return null;
      }
    },
  };
}

let warnedNoKey = false;

/** Production: the `sdk_delivery` flag (W1.1) and the Dopl App client from the server env. */
export function createSdkLens(env: { key?: string; baseUrl?: string; fetch?: (input: string, init: RequestInit) => Promise<Response> } = {}): SdkLens {
  let client: Dopl | null = null;
  return {
    async forUser(userId) {
      let state: { on: boolean; deviceIds: string[] };
      try {
        state = await sdkDeliveryFor(userId);
      } catch (err) {
        console.error("[display] sdk_delivery lookup failed; prosumer lens path", err);
        throw new SdkLensError("flag_lookup_failed", true);
      }
      if (!state.on) return null;
      const key = env.key ?? process.env.DOPL_APP_SDK_KEY;
      if (!key) {
        if (!warnedNoKey) console.error("[display] sdk_delivery is on but DOPL_APP_SDK_KEY is not set; prosumer lens path");
        warnedNoKey = true;
        throw new SdkLensError("no_key", true);
      }
      const baseUrl = env.baseUrl ?? process.env.DOPL_APP_SDK_BASE_URL;
      // `baseUrl`: the in-repo `@dopl/sdk`'s option; the standalone SDK names it `baseURL` (rename at W2.2).
      client ??= new Dopl({
        apiKey: key,
        ...(baseUrl && { baseUrl }),
        headers: { ...SDK_LENS_HEADERS },
        fetch: preSendAwareFetch(env.fetch ?? ((input, init) => globalThis.fetch(input, init))),
      });
      return { lens: sdkUserLens(client, userId), deviceIds: state.deviceIds };
    },
  };
}

// ── Lens NOTICES over the SDK (W1.2 Gaps #1) ─────────────────────────────────────────────────────

/** One SDK call's result as the glasses tools read it: no throw crosses into `glasses/core`. */
export type SdkNoticeResult<T> = { ok: true; value: T } | { ok: false; code: string; fallback: boolean };

/** An SDK action as `glasses_get_answer` reads it. */
export interface SdkNoticeAction {
  id: string;
  device_id: string;
  capability: string;
  status: string;
  result: Record<string, unknown> | null;
  updated_at: string;
}

/**
 * One user's lens NOTICES over the SDK: `glasses_notify` (`present.notify` on ONE device, so the title
 * rides along; `deliver` carries only text) and `glasses_get_answer` for an SDK action id.
 * Structurally the `GlassesSdkUser` port of `glasses/core/messages/service.ts`.
 */
export interface SdkUserNotices {
  deviceIds: string[];
  notify(a: { deviceId: string; title: string; body: string; idempotencyKey: string }): Promise<SdkNoticeResult<{ id: string; status: string }>>;
  /** The action, or `not_found` when it is unknown OR on a device that is not one of {@link deviceIds}. */
  action(id: string): Promise<SdkNoticeResult<SdkNoticeAction>>;
}

const settle = async <T>(p: Promise<T>): Promise<SdkNoticeResult<T>> => {
  try {
    return { ok: true, value: await p };
  } catch (err) {
    const e = err instanceof SdkLensError ? err : classify(err);
    return { ok: false, code: e.code, fallback: e.fallback };
  }
};

/** Notices for one user over a ready client. Exported for the suites. */
export function sdkUserNotices(dopl: Dopl, userId: string, deviceIds: string[]): SdkUserNotices {
  return {
    deviceIds,
    notify({ deviceId, title, body, idempotencyKey }) {
      return settle(
        timed(
          "notify",
          (signal) => dopl.devices.action(deviceId, "present.notify", { title, body }, { idempotencyKey, signal }),
          (r) => ({ action_id: r.action_id, status: r.status }),
        ).then((r) => ({ id: r.action_id, status: r.status })),
      );
    },
    async action(id) {
      const r = await settle(timed("action", (signal) => dopl.actions.get(id, { signal }), (a) => ({ status: a.status })));
      if (!r.ok) return r;
      // 🔒 The Dopl App project holds EVERY user's actions; an id on another user's device is unknown here.
      if (!deviceIds.includes(r.value.device_id)) return { ok: false, code: "not_found", fallback: false };
      const a = r.value;
      return { ok: true, value: { id: a.action_id, device_id: a.device_id, capability: a.capability, status: a.status, result: a.result, updated_at: a.updated_at } };
    },
  };
}

/** Production notices: the same flag and key as {@link createSdkLens}. Null = flag off. Throws {@link SdkLensError} (fallback). */
export function createSdkNotices(env: { key?: string; baseUrl?: string } = {}): { forUser(userId: string): Promise<SdkUserNotices | null> } {
  let client: Dopl | null = null;
  return {
    async forUser(userId) {
      let state: { on: boolean; deviceIds: string[] };
      try {
        state = await sdkDeliveryFor(userId);
      } catch (err) {
        console.error("[display] sdk_delivery lookup failed; prosumer notice path", err);
        throw new SdkLensError("flag_lookup_failed", true);
      }
      if (!state.on) return null;
      const key = env.key ?? process.env.DOPL_APP_SDK_KEY;
      if (!key) {
        if (!warnedNoKey) console.error("[display] sdk_delivery is on but DOPL_APP_SDK_KEY is not set; prosumer notice path");
        warnedNoKey = true;
        throw new SdkLensError("no_key", true);
      }
      const baseUrl = env.baseUrl ?? process.env.DOPL_APP_SDK_BASE_URL;
      client ??= new Dopl({ apiKey: key, ...(baseUrl && { baseUrl }) });
      return sdkUserNotices(client, userId, state.deviceIds);
    },
  };
}

/** Production: the glasses tools' notice port (`glasses/core/mcp/exposure.ts`). */
export const productionSdkNotices = createSdkNotices();
