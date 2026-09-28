import { HttpError } from "@/shared/lib/http-error";
import { iso, nowOf, type Clock } from "../clock";
import { deviceFromBearer, type ChannelLinker } from "../devices/service";
import type { DeviceStore, GlassesDevice } from "../devices/types";
import { pairingStatus, startPairing } from "../devices/pairing";
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
import type { GlassesStore } from "./types";

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

  /** Device-token auth, then `fn`; errors become `{error, code}`. */
  const authed =
    (
      label: string,
      fn: (request: Request, device: GlassesDevice) => Promise<Response>,
    ) =>
    async (request: Request): Promise<Response> => {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      try {
        return await fn(request, device);
      } catch (err) {
        return fromError(request, err, label);
      }
    };

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
    }),

    answer: authed("answer", async (request, device) =>
      outcomeResponse(
        request,
        await answerAsk(deps, device.user_id, await readJson(request)),
      ),
    ),

    dismiss: authed("dismiss", async (request, device) =>
      outcomeResponse(
        request,
        await dismissMessage(deps, device.user_id, await readJson(request)),
      ),
    ),

    /** The device signs itself out: its token dies with the revoke. */
    unpair: authed("unpair", async (request, device) => {
      await deps.devices.revokeDevice(
        device.user_id,
        device.id,
        iso(nowOf(deps)),
      );
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
