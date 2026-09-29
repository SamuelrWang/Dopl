import { z } from "zod";
import { HttpError } from "@/shared/lib/http-error";
import { nowOf, sleepOf } from "../clock";
import { json, readJson } from "../http";
import { TtlCache } from "../ttl-cache";
import { authedDevice, resolveDeviceDeps, type DeviceHandlerDeps } from "../messages/device-handlers";
import type { GlassesDevice } from "../devices/types";
import { isUuid } from "../validation";
import { AGENT_ID_RE } from "../voice/target";
import type { MenuGateway } from "./types";
import {
  PAGE_MAX,
  POLL_MAX_SEC,
  answerChannelDisplay,
  channelAgents,
  launchAgent,
  launchOptions,
  launchStatus,
  menuHome,
  pollChannel,
  readChannel,
  setTarget,
  type MenuDeps,
} from "./service";

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
/** More empty long-poll answers than this within the window and each further one is held a minimum. */
const EMPTY_POLL_BURST = 5;
const EMPTY_POLL_WINDOW_MS = 5_000;
const EMPTY_POLL_MIN_HOLD_MS = 1_000;
export const LAUNCH_RPM = 5;

const err = (request: Request, status: number, code: string, message: string, extra: Record<string, string> = {}) =>
  json(request, { error: { code, message } }, status, extra);

function fail(request: Request, e: unknown, label: string): Response {
  if (e instanceof HttpError) return err(request, e.status, e.code, e.message);
  // The channels service's own not-found (a revoked membership or a deleted channel mid-read).
  if (e instanceof Error && e.name === "ChannelNotFoundError") {
    return err(request, 404, "CHANNEL_NOT_FOUND", "Channel not found.");
  }
  if (e instanceof Error && e.name === "ChannelForbiddenError") return err(request, 403, "FORBIDDEN", e.message);
  console.error(`[glasses] ${label} failed`, e);
  return err(request, 500, "INTERNAL", `${label} failed`);
}

const LaunchSchema = z.object({
  channel_id: z.string().uuid(),
  runtime: z.string().min(1).max(32),
  model: z.string().max(100).nullable().optional(),
  name: z.string().max(200).nullable().optional(),
});
const DisplayAnswerSchema = z.object({
  index: z.number().int().min(0).max(1000),
  block_id: z.string().max(32).nullable().optional(),
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

  /** Auth + a rate limit; the device, or a ready error response. */
  async function gate(request: Request, limit: (id: string) => Promise<boolean>): Promise<GlassesDevice | Response> {
    const device = await authedDevice(deps, request);
    if (!device) return err(request, 401, "UNAUTHORIZED", "Unauthorized");
    if (!(await limit(device.id))) {
      return err(request, 429, "RATE_LIMITED", "Too many requests; try again in a minute.", { "Retry-After": "60" });
    }
    return device;
  }

  async function body<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
    const parsed = schema.safeParse(await readJson(request));
    if (!parsed.success) throw new HttpError(400, "VALIDATION_FAILED", parsed.error.issues[0]?.message ?? "Invalid body.");
    return parsed.data;
  }

  const channelParam = (channelId: string) => {
    if (!isUuid(channelId)) throw new HttpError(404, "CHANNEL_NOT_FOUND", "Channel not found.");
    return channelId;
  };

  /** Gate, run `fn`, and answer its result as JSON or its error as `{error:{code, message}}`. */
  const handle =
    <A extends unknown[]>(
      limit: (id: string) => Promise<boolean>,
      label: string,
      fn: (request: Request, device: GlassesDevice, ...args: A) => Promise<unknown>,
    ) =>
    async (request: Request, ...args: A): Promise<Response> => {
      const device = await gate(request, limit);
      if (device instanceof Response) return device;
      try {
        return json(request, await fn(request, device, ...args));
      } catch (e) {
        return fail(request, e, label);
      }
    };
  // A client that re-polls on every empty answer would spin; slow it to one answer per second.
  const emptyPolls = new TtlCache<string, number>(EMPTY_POLL_WINDOW_MS, 10_000);
  async function guardEmptyPoll(key: string, empty: boolean) {
    if (!empty) return;
    const count = (emptyPolls.get(key, nowOf(deps)) ?? 0) + 1;
    emptyPolls.set(key, count, nowOf(deps));
    if (count > EMPTY_POLL_BURST) await sleepOf(deps)(EMPTY_POLL_MIN_HOLD_MS);
  }
  const channelIdParam = (request: Request) => channelParam(new URL(request.url).searchParams.get("channel_id") ?? "");

  return {
    home: handle(deps.allowRead, "home", (_request, device) => menuHome(menuDeps, device)),

    agents: handle(deps.allowRead, "agents", (_request, device, channelId: string) =>
      channelAgents(menuDeps, device, channelParam(channelId)),
    ),

    /** `?before=&limit=` pages back; `?after=&wait=[&activity=]` long-polls (and wakes on an activity
     *  change when `activity` is the version the caller holds); `&agent=` narrows to a conversation. */
    messages: handle(deps.allowRead, "messages", async (request, device, channelId: string) => {
      const url = new URL(request.url);
      const before = intParam(url, "before");
      const after = intParam(url, "after");
      const limit = intParam(url, "limit");
      const wait = intParam(url, "wait");
      const agent = url.searchParams.get("agent");
      const activity = url.searchParams.get("activity");
      if ([before, after, limit, wait].some((v) => Number.isNaN(v))) {
        throw new HttpError(400, "BAD_QUERY", "before, after, limit and wait are whole numbers.");
      }
      if (agent !== null && !AGENT_ID_RE.test(agent)) throw new HttpError(400, "BAD_AGENT", "Unknown agent.");
      if (limit !== undefined && (limit < 1 || limit > PAGE_MAX)) throw new HttpError(400, "BAD_QUERY", `limit is 1-${PAGE_MAX}.`);
      const id = channelParam(channelId);
      if (after === undefined) return readChannel(menuDeps, device, id, { before, limit, agent });
      if (activity !== null && !/^[0-9a-f]{1,40}$/.test(activity)) {
        throw new HttpError(400, "BAD_QUERY", "activity is the activity_version from a previous response.");
      }
      const waitSec = Math.min(wait ?? POLL_MAX_SEC, POLL_MAX_SEC);
      const result = await pollChannel(menuDeps, device, id, { after, waitSec, agent, activity }, request.signal);
      await guardEmptyPoll(`${device.id}:${id}`, waitSec > 0 && result.messages.length === 0);
      return result;
    }),

    launchOptions: handle(deps.allowRead, "launch options", (request, device) =>
      launchOptions(menuDeps, device, channelIdParam(request)),
    ),

    launch: handle(deps.allowLaunch, "launch", async (request, device) =>
      launchAgent(menuDeps, device, await body(request, LaunchSchema)),
    ),

    /** `GET /launch/:directiveId?channel_id=`: a launch still `launching` after the POST's hold. */
    launchStatus: handle(deps.allowRead, "launch status", async (request, device, directiveId: string) => {
      if (!isUuid(directiveId)) throw new HttpError(404, "LAUNCH_NOT_FOUND", "Launch not found.");
      return launchStatus(menuDeps, device, channelIdParam(request), directiveId);
    }),

    target: handle(deps.allowRead, "target", async (request, device) =>
      setTarget(menuDeps, device, await body(request, TargetSchema)),
    ),

    /** `POST /channels/:id/messages/:messageId/display/answer {index, block_id?}`: a tap on a display's options. */
    displayAnswer: handle(deps.allowRead, "display answer", async (request, device, channelId: string, messageId: string) => {
      const id = channelParam(channelId);
      if (!isUuid(messageId)) throw new HttpError(404, "DISPLAY_NOT_FOUND", "No display on that message.");
      return answerChannelDisplay(menuDeps, device, id, messageId, await body(request, DisplayAnswerSchema));
    }),
  };
}
