import { HttpError } from "@/shared/lib/http-error";
import { json } from "./cors";
import { Throttle } from "./ttl-cache";
import { bearerOf } from "./credentials";
import { answerAsk, dismissMessage, parseInboxQuery, readInbox } from "./device";
import { deviceFromBearer } from "./devices-service";
import type { DeviceStore, GlassesDevice } from "./devices-types";
import { pairingStatus, startPairing } from "./pairing-service";
import { mirrorReplies } from "./reply-mirror";
import type { ChannelLinker } from "./devices-service";
import type { GlassesStore } from "./types";
import type { ChannelGateway } from "./voice-utterance";

/**
 * Handlers for the device-facing routes (`/api/glasses/device/*`), built over
 * injected deps so tests drive them with fakes. `glasses-runtime.ts` wires the
 * real ones; the route files only bind a method to a handler.
 */

export interface DeviceHandlerDeps {
  store: GlassesStore;
  devices: DeviceStore;
  gateway: ChannelGateway;
  linker: ChannelLinker;
  /** Per-IP limiter for unauthenticated pairing starts; true = within the limit. */
  allowPairStart: (request: Request) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** `last_seen` writes, at most one per device per 30s (defaults per handler set). */
  touchThrottle?: Throttle<string>;
  /** Reply-mirror passes, at most one per device per 5s. */
  mirrorThrottle?: Throttle<string>;
}

export const PAIR_START_RPM = 10;
export const TOUCH_INTERVAL_MS = 30_000;
export const MIRROR_INTERVAL_MS = 5_000;
const MAX_TRACKED_DEVICES = 10_000;
const UNAUTHORIZED = { error: "Unauthorized" };

type ResolvedDeps = DeviceHandlerDeps & { touchThrottle: Throttle<string>; mirrorThrottle: Throttle<string> };

/** The calling device, stamped as seen (throttled); null → answer 401. */
export async function authedDevice(deps: ResolvedDeps, request: Request): Promise<GlassesDevice | null> {
  const device = await deviceFromBearer(deps.devices, request);
  const now = (deps.now ?? Date.now)();
  if (device && deps.touchThrottle.tryAcquire(device.id, now)) {
    await deps.devices.touchDevice(device.id, new Date(now).toISOString());
  }
  return device;
}

export function resolveDeviceDeps<D extends DeviceHandlerDeps>(deps: D): D & ResolvedDeps {
  return {
    ...deps,
    touchThrottle: deps.touchThrottle ?? new Throttle<string>(TOUCH_INTERVAL_MS, MAX_TRACKED_DEVICES),
    mirrorThrottle: deps.mirrorThrottle ?? new Throttle<string>(MIRROR_INTERVAL_MS, MAX_TRACKED_DEVICES),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "body must be JSON");
  }
}

function fromError(request: Request, err: unknown, label: string): Response {
  if (err instanceof HttpError) return json(request, { error: err.message, code: err.code }, err.status);
  console.error(`[glasses] ${label} failed`, err);
  return json(request, { error: `${label} failed` }, 500);
}

export function createDeviceHandlers(input: DeviceHandlerDeps) {
  const deps = resolveDeviceDeps(input);
  return {
    async inbox(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      const parsed = parseInboxQuery(new URL(request.url));
      if ("error" in parsed) return json(request, { error: parsed.error }, 400);
      try {
        // The linked channel's agent replies ride this same long-poll (reply-mirror.ts),
        // checked at most every MIRROR_INTERVAL_MS per device.
        const current = { ...device };
        const beforeRead = async () => {
          if (!current.linked_channel_id) return;
          if (!deps.mirrorThrottle.tryAcquire(device.id, (deps.now ?? Date.now)())) return;
          const r = await mirrorReplies(deps, current);
          current.reply_cursor_seq = r.cursor;
          if (r.unlinked) current.linked_channel_id = null;
        };
        const result = await readInbox(
          { store: deps.store, beforeRead, now: deps.now, sleep: deps.sleep },
          device.user_id,
          parsed.after,
          parsed.waitSec,
          request.signal,
        );
        return json(request, result);
      } catch (err) {
        return fromError(request, err, "inbox");
      }
    },

    async answer(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      try {
        const outcome = await answerAsk(deps, device.user_id, await readJson(request));
        return outcome.ok ? json(request, { ok: true }) : json(request, { ok: false, error: outcome.error }, outcome.status);
      } catch (err) {
        return fromError(request, err, "answer");
      }
    },

    async dismiss(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      try {
        const outcome = await dismissMessage(deps, device.user_id, await readJson(request));
        return outcome.ok ? json(request, { ok: true }) : json(request, { ok: false, error: outcome.error }, outcome.status);
      } catch (err) {
        return fromError(request, err, "dismiss");
      }
    },

    /** The device signs itself out: revoke the calling device (its token dies with it). */
    async unpair(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      try {
        await deps.devices.revokeDevice(device.user_id, device.id, new Date((deps.now ?? Date.now)()).toISOString());
        return json(request, { ok: true });
      } catch (err) {
        return fromError(request, err, "unpair");
      }
    },

    async pairStart(request: Request): Promise<Response> {
      try {
        if (!(await deps.allowPairStart(request))) {
          return json(request, { error: "Too many pairing attempts; try again in a minute." }, 429, {
            "Retry-After": "60",
          });
        }
        return json(request, await startPairing(deps));
      } catch (err) {
        return fromError(request, err, "pair start");
      }
    },

    async pairStatus(request: Request): Promise<Response> {
      const pairId = new URL(request.url).searchParams.get("pair_id") ?? "";
      // The poll secret rides `Authorization: Bearer`, never the query string (access logs).
      const secret = bearerOf(request) ?? "";
      if (!pairId || !secret) {
        return json(request, { error: "pair_id and Authorization: Bearer <poll_secret> are required" }, 400);
      }
      try {
        return json(request, await pairingStatus(deps, pairId, secret));
      } catch (err) {
        return fromError(request, err, "pair status");
      }
    },
  };
}
