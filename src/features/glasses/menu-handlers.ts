import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { json } from "./cors";
import { authedDevice, resolveDeviceDeps, type DeviceHandlerDeps } from "./device-handlers";
import type { GlassesDevice } from "./devices-types";
import type { MenuGateway } from "./menu-types";
import {
  PAGE_MAX,
  POLL_MAX_SEC,
  channelAgents,
  launchAgent,
  launchOptions,
  launchStatus,
  menuHome,
  pollChannel,
  readChannel,
  setTarget,
  type MenuDeps,
} from "./menu-service";
import { isUuid } from "./text";
import { AGENT_ID_RE } from "./voice-target";

/**
 * HTTP for the glasses menu (`/api/glasses/device/{home, channels/:id/…,
 * launch-options, launch, target}`). Device-token auth, per-device rate limits,
 * and errors as `{error:{code, message}}` so the lens can show `message`.
 */

export interface MenuHandlerDeps extends DeviceHandlerDeps {
  menu: MenuGateway;
  /** Per-device limiter for menu reads (polls included); true = within. */
  allowRead: (deviceId: string) => Promise<boolean>;
  /** Per-device limiter for launches; true = within. */
  allowLaunch: (deviceId: string) => Promise<boolean>;
}

export const MENU_READ_RPM = 120;
export const LAUNCH_RPM = 5;

const err = (request: Request, status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  json(request, { error: { code, message } }, status, extra);

function fail(request: Request, e: unknown, label: string): Response {
  if (e instanceof HttpError) return err(request, e.status, e.code, e.message);
  // The channels service's own not-found (a revoked membership or a deleted channel mid-read).
  if (e instanceof Error && (e.name === "ChannelNotFoundError" || e.name === "ChannelGoneError")) {
    return err(request, 404, "CHANNEL_NOT_FOUND", "Channel not found.");
  }
  console.error(`[glasses] ${label} failed`, e);
  return err(request, 500, "INTERNAL", `${label} failed`);
}

const LaunchSchema = z.object({
  channel_id: z.string().uuid(),
  runtime: z.string().min(1).max(32),
  model: z.string().max(100).nullable().optional(),
});
const TargetSchema = z.object({
  channel_id: z.string().uuid().nullable(),
  agent_session_id: z.string().regex(AGENT_ID_RE).nullable().optional(),
});

const intParam = (url: URL, key: string): number | undefined => {
  const raw = url.searchParams.get(key);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

export function createMenuHandlers(input: MenuHandlerDeps) {
  const deps = resolveDeviceDeps(input);
  const menuDeps: MenuDeps = { gateway: deps.menu, linker: deps.linker, devices: deps.devices, now: deps.now, sleep: deps.sleep };

  /** Auth + read limit; the device, or a ready error response. */
  async function gate(request: Request, limit: (id: string) => Promise<boolean>): Promise<GlassesDevice | Response> {
    const device = await authedDevice(deps, request);
    if (!device) return err(request, 401, "UNAUTHORIZED", "Unauthorized");
    if (!(await limit(device.id))) {
      return err(request, 429, "RATE_LIMITED", "Too many requests; try again in a minute.", { "Retry-After": "60" });
    }
    return device;
  }

  async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new HttpError(400, "INVALID_JSON", "Body must be JSON.");
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid body.");
    return parsed.data;
  }

  const channelParam = (channelId: string) => {
    if (!isUuid(channelId)) throw new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found.");
    return channelId;
  };

  return {
    async home(request: Request): Promise<Response> {
      const device = await gate(request, deps.allowRead);
      if (device instanceof Response) return device;
      try {
        return json(request, await menuHome(menuDeps, device));
      } catch (e) {
        return fail(request, e, "home");
      }
    },

    async agents(request: Request, channelId: string): Promise<Response> {
      const device = await gate(request, deps.allowRead);
      if (device instanceof Response) return device;
      try {
        return json(request, await channelAgents(menuDeps, device, channelParam(channelId)));
      } catch (e) {
        return fail(request, e, "agents");
      }
    },

    /** `?before=&limit=` pages back; `?after=&wait=` long-polls; `&agent=` narrows to a conversation. */
    async messages(request: Request, channelId: string): Promise<Response> {
      const device = await gate(request, deps.allowRead);
      if (device instanceof Response) return device;
      try {
        const url = new URL(request.url);
        const before = intParam(url, "before");
        const after = intParam(url, "after");
        const limit = intParam(url, "limit");
        const wait = intParam(url, "wait");
        const agent = url.searchParams.get("agent");
        if ([before, after, limit, wait].some((v) => Number.isNaN(v))) {
          throw new HttpError(400, "BAD_QUERY", "before, after, limit and wait are whole numbers.");
        }
        if (agent !== null && !AGENT_ID_RE.test(agent)) throw new HttpError(400, "BAD_AGENT", "Unknown agent.");
        if (limit !== undefined && (limit < 1 || limit > PAGE_MAX)) throw new HttpError(400, "BAD_QUERY", `limit is 1-${PAGE_MAX}.`);
        const id = channelParam(channelId);
        if (after !== undefined) {
          const waitSec = Math.min(wait ?? POLL_MAX_SEC, POLL_MAX_SEC);
          return json(request, await pollChannel(menuDeps, device, id, { after, waitSec, agent }, request.signal));
        }
        return json(request, await readChannel(menuDeps, device, id, { before, limit, agent }));
      } catch (e) {
        return fail(request, e, "messages");
      }
    },

    async launchOptions(request: Request): Promise<Response> {
      const device = await gate(request, deps.allowRead);
      if (device instanceof Response) return device;
      try {
        const channelId = new URL(request.url).searchParams.get("channel_id") ?? "";
        return json(request, await launchOptions(menuDeps, device, channelParam(channelId)));
      } catch (e) {
        return fail(request, e, "launch options");
      }
    },

    async launch(request: Request): Promise<Response> {
      const device = await gate(request, deps.allowLaunch);
      if (device instanceof Response) return device;
      try {
        return json(request, await launchAgent(menuDeps, device, await body(request, LaunchSchema)));
      } catch (e) {
        return fail(request, e, "launch");
      }
    },

    /** `GET /launch/:directiveId?channel_id=` — a launch still `launching` after the POST's hold. */
    async launchStatus(request: Request, directiveId: string): Promise<Response> {
      const device = await gate(request, deps.allowRead);
      if (device instanceof Response) return device;
      try {
        const channelId = new URL(request.url).searchParams.get("channel_id") ?? "";
        if (!isUuid(directiveId)) throw new HttpError(404, "LAUNCH_NOT_FOUND", "Launch not found.");
        return json(request, await launchStatus(menuDeps, device, channelParam(channelId), directiveId));
      } catch (e) {
        return fail(request, e, "launch status");
      }
    },

    async target(request: Request): Promise<Response> {
      const device = await gate(request, deps.allowRead);
      if (device instanceof Response) return device;
      try {
        return json(request, await setTarget(menuDeps, device, await body(request, TargetSchema)));
      } catch (e) {
        return fail(request, e, "target");
      }
    },
  };
}
