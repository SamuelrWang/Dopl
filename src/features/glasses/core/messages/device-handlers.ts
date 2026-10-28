import { HttpError } from "@/shared/lib/http-error";
import { iso, nowOf, type Clock } from "../clock";
import { hashCredential } from "../devices/credentials";
import type { SdkGlassesDevice, SdkGlassesPort } from "../devices/sdk-device";
import { deviceFromBearer, type ChannelLinker } from "../devices/service";
import type { DeviceStore, GlassesDevice } from "../devices/types";
import { pairingStatus, startPairing, type ConnectPairingPort } from "../devices/pairing";
import { bearerOf, json, readJson } from "../http";
import { Throttle } from "../ttl-cache";
import type { ChannelGateway } from "../voice/utterance";
import {
  answerAsk,
  dismissMessage,
  parseInboxQuery,
  readInbox,
  type AnswerOutcome,
} from "./inbox";
import { mirrorReplies } from "./reply-mirror";
import type { GlassesMessage, GlassesStore } from "./types";
import { isUuid } from "../validation";

/**
 * Handlers for the device-facing routes (`/api/glasses/device/*`), built over
 * injected deps so tests drive them with fakes; `glasses-runtime.ts` wires the
 * real ones.
 */

export interface DeviceHandlerDeps extends Clock {
  store: GlassesStore;
  devices: DeviceStore;
  gateway: ChannelGateway;
  linker: ChannelLinker;
  /** Per-IP limiter for unauthenticated pairing starts; true = within the limit. */
  allowPairStart: (request: Request) => Promise<boolean>;
  touchThrottle?: Throttle<string>;
  mirrorThrottle?: Throttle<string>;
  /** Device SDK Connect claims (A4): lets the status poll hand a token to an SDK-owned device. */
  connect?: ConnectPairingPort;
  /**
   * Device SDK G2s (A8): a bearer the prosumer lookup does not know is tried against
   * `device_credentials`, and an SDK device reaches inbox / answer / dismiss / unpair on ITS OWN lens
   * queue. Absent = prosumer only. The menu and voice routes take the same port and answer an SDK device
   * a fixed, data-free shape (`menu/handlers.ts › SDK_MENU`, `voice/handlers.ts › SDK_VOICE_REFUSAL`, A8b).
   */
  sdk?: SdkGlassesPort;
  /**
   * A tap on a lens row linked to a channel decision posts the same answer there, as the device
   * owner from glasses (`display/server/answer.ts › answerFromLens`); absent = lens only (tests).
   */
  answerLinked?: (device: GlassesDevice, row: GlassesMessage) => Promise<"ok" | "conflict">;
}

export const PAIR_START_RPM = 10;
/** `last_seen` writes, at most one per device per interval. */
const TOUCH_INTERVAL_MS = 30_000;
/** Reply-mirror passes, at most one per device per interval. */
const MIRROR_INTERVAL_MS = 5_000;
const MAX_TRACKED_DEVICES = 10_000;
export const UNAUTHORIZED = { error: "Unauthorized" };

type ResolvedDeps = DeviceHandlerDeps & {
  touchThrottle: Throttle<string>;
  mirrorThrottle: Throttle<string>;
};

/** The calling device, stamped as seen (throttled); null → answer 401. */
export async function authedDevice(
  deps: ResolvedDeps,
  request: Request,
): Promise<GlassesDevice | null> {
  const device = await deviceFromBearer(deps.devices, request);
  const now = nowOf(deps);
  if (device && deps.touchThrottle.tryAcquire(device.id, now)) {
    await deps.devices.touchDevice(device.id, iso(now));
  }
  return device;
}

/**
 * The Device SDK G2 behind this bearer, stamped as seen (throttled); null when there is no bearer, no
 * port, or no live SDK credential. Callers consult it ONLY after {@link authedDevice} missed, so a
 * prosumer token never reaches `device_credentials` (A8).
 */
export async function authedSdkDevice(
  deps: ResolvedDeps,
  request: Request,
): Promise<SdkGlassesDevice | null> {
  const token = deps.sdk ? bearerOf(request) : null;
  if (!deps.sdk || !token) return null;
  const device = await deps.sdk.deviceFromTokenHash(hashCredential(token));
  const now = nowOf(deps);
  if (device && deps.touchThrottle.tryAcquire(device.id, now)) {
    await deps.sdk.touch(device.id, iso(now));
  }
  return device;
}

export function resolveDeviceDeps<D extends DeviceHandlerDeps>(
  deps: D,
): D & ResolvedDeps {
  return {
    ...deps,
    touchThrottle:
      deps.touchThrottle ??
      new Throttle<string>(TOUCH_INTERVAL_MS, MAX_TRACKED_DEVICES),
    mirrorThrottle:
      deps.mirrorThrottle ??
      new Throttle<string>(MIRROR_INTERVAL_MS, MAX_TRACKED_DEVICES),
  };
}

function fromError(request: Request, err: unknown, label: string): Response {
  if (err instanceof HttpError)
    return json(request, { error: err.message, code: err.code }, err.status);
  console.error(`[glasses] ${label} failed`, err);
  return json(request, { error: `${label} failed` }, 500);
}

const outcomeResponse = (request: Request, o: AnswerOutcome) =>
  o.ok
    ? json(request, { ok: true })
    : json(request, { ok: false, error: o.error }, o.status);

export function createDeviceHandlers(input: DeviceHandlerDeps) {
  const deps = resolveDeviceDeps(input);

  /**
   * Device-token auth, then `fn`; errors become `{error, code}`. A token the PROSUMER lookup does not
   * know is tried as an SDK device credential only when the route has an `sdkFn` and `deps.sdk` is
   * wired, so a prosumer device's path (lookup, touch, handler) is exactly what it was before A8.
   */
  const authed =
    (
      label: string,
      fn: (request: Request, device: GlassesDevice) => Promise<Response>,
      sdkFn?: (request: Request, device: SdkGlassesDevice, port: SdkGlassesPort) => Promise<Response>,
    ) =>
    async (request: Request): Promise<Response> => {
      const device = await authedDevice(deps, request);
      if (!device) {
        if (!sdkFn || !deps.sdk) return json(request, UNAUTHORIZED, 401);
        const port = deps.sdk;
        try {
          const sdk = await authedSdkDevice(deps, request);
          if (!sdk) return json(request, UNAUTHORIZED, 401);
          return await sdkFn(request, sdk, port);
        } catch (err) {
          return fromError(request, err, label);
        }
      }
      try {
        return await fn(request, device);
      } catch (err) {
        return fromError(request, err, label);
      }
    };

  /** The SDK queue, telling the port which rows the inbox hands over (their actions → `delivered`). */
  const sdkQueue = (port: SdkGlassesPort): GlassesStore => ({
    ...port.store,
    async markDelivered(deviceId, ids) {
      await port.store.markDelivered(deviceId, ids);
      if (ids.length > 0) await port.delivered(deviceId, ids);
    },
  });

  return {
    inbox: authed("inbox", async (req, device) => {
      const parsed = parseInboxQuery(new URL(req.url));
      if ("error" in parsed) return json(req, { error: parsed.error }, 400);
      // Agent replies from the device's scope (current target + channels it posted to
      // in 24h) ride this long-poll, at most one pass per MIRROR_INTERVAL_MS.
      const beforeRead = async () => {
        if (!deps.mirrorThrottle.tryAcquire(device.id, nowOf(deps))) return;
        await mirrorReplies(deps, device);
      };
      const result = await readInbox(
        { store: deps.store, beforeRead, now: deps.now, sleep: deps.sleep },
        device.user_id,
        parsed.after,
        parsed.waitSec,
        req.signal,
      );
      return json(req, result);
    }, async (req, device, port) => {
      const parsed = parseInboxQuery(new URL(req.url));
      if ("error" in parsed) return json(req, { error: parsed.error }, 400);
      const result = await readInbox(
        { store: sdkQueue(port), now: deps.now, sleep: deps.sleep },
        device.id,
        parsed.after,
        parsed.waitSec,
        req.signal,
      );
      return json(req, result);
    }),

    answer: authed("answer", async (request, device) => {
      const outcome = await answerAsk(deps, device.user_id, await readJson(request));
      if (outcome.ok && outcome.message && deps.answerLinked) {
        // The channel decision was answered first: the lens now shows THAT answer; the tap lost.
        if ((await deps.answerLinked(device, outcome.message)) === "conflict") {
          return json(request, { ok: false, error: "already answered" }, 409);
        }
      }
      return outcomeResponse(request, outcome);
    }, async (request, device, port) => {
      const outcome = await answerAsk({ store: port.store, now: deps.now }, device.id, await readJson(request));
      if (outcome.ok && outcome.message) await port.settled(device.id, outcome.message);
      return outcomeResponse(request, outcome);
    }),

    dismiss: authed("dismiss", async (request, device) =>
      outcomeResponse(
        request,
        await dismissMessage(deps, device.user_id, await readJson(request)),
      ),
    async (request, device, port) => {
      const body = await readJson(request);
      const outcome = await dismissMessage({ store: port.store, now: deps.now }, device.id, body);
      const id = (body as { id?: unknown } | null)?.id;
      if (outcome.ok && typeof id === "string" && isUuid(id)) {
        const row = await port.store.get(device.id, id);
        if (row?.status === "dismissed") await port.settled(device.id, row);
      }
      return outcomeResponse(request, outcome);
    }),

    /** The device signs itself out: its token dies with the revoke. */
    unpair: authed("unpair", async (request, device) => {
      await deps.devices.revokeDevice(
        device.user_id,
        device.id,
        iso(nowOf(deps)),
      );
      return json(request, { ok: true });
    }, async (request, device, port) => {
      await port.revokeToken(device.id, iso(nowOf(deps)));
      return json(request, { ok: true });
    }),

    async pairStart(request: Request): Promise<Response> {
      try {
        if (!(await deps.allowPairStart(request))) {
          return json(
            request,
            { error: "Too many pairing attempts; try again in a minute." },
            429,
            { "Retry-After": "60" },
          );
        }
        return json(request, await startPairing(deps));
      } catch (err) {
        return fromError(request, err, "pair start");
      }
    },

    async pairStatus(request: Request): Promise<Response> {
      const pairId = new URL(request.url).searchParams.get("pair_id") ?? "";
      // The poll secret rides `Authorization`, never the query string (access logs).
      const secret = bearerOf(request) ?? "";
      if (!pairId || !secret) {
        return json(
          request,
          {
            error:
              "pair_id and Authorization: Bearer <poll_secret> are required",
          },
          400,
        );
      }
      try {
        return json(request, await pairingStatus(deps, pairId, secret));
      } catch (err) {
        return fromError(request, err, "pair status");
      }
    },
  };
}
