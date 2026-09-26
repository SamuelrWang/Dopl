import { HttpError } from "@/shared/lib/http-error";
import { json } from "./cors";
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
}

export const PAIR_START_RPM = 10;
const UNAUTHORIZED = { error: "Unauthorized" };

/** The calling device, stamped as seen; null → answer 401. */
export async function authedDevice(deps: DeviceHandlerDeps, request: Request): Promise<GlassesDevice | null> {
  const device = await deviceFromBearer(deps.devices, request);
  if (device) await deps.devices.touchDevice(device.id, new Date((deps.now ?? Date.now)()).toISOString());
  return device;
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

export function createDeviceHandlers(deps: DeviceHandlerDeps) {
  return {
    async inbox(request: Request): Promise<Response> {
      const device = await authedDevice(deps, request);
      if (!device) return json(request, UNAUTHORIZED, 401);
      const parsed = parseInboxQuery(new URL(request.url));
      if ("error" in parsed) return json(request, { error: parsed.error }, 400);
      try {
        // The linked channel's agent replies ride this same long-poll (reply-mirror.ts).
        let cursor = device.reply_cursor_seq;
        const beforeRead = device.linked_channel_id
          ? async () => {
              const r = await mirrorReplies(deps, { ...device, reply_cursor_seq: cursor });
              cursor = r.cursor;
            }
          : undefined;
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
      const url = new URL(request.url);
      const pairId = url.searchParams.get("pair_id") ?? "";
      // Prefer `Authorization: Bearer <poll_secret>`: a query string lands in access
      // logs. `?poll_secret=` stays accepted because the v1 contract names it.
      const secret = bearerOf(request) ?? url.searchParams.get("poll_secret") ?? "";
      if (!pairId || !secret) return json(request, { error: "pair_id and poll_secret are required" }, 400);
      try {
        return json(request, await pairingStatus(deps, pairId, secret));
      } catch (err) {
        return fromError(request, err, "pair status");
      }
    },
  };
}
