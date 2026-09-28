import { DEFAULT_PLATFORM } from "../../platforms/registry";
import type { GlassesPlatform } from "../../platforms/types";
import { iso, nowOf, sleepOf, type Clock } from "../clock";
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
import type { GlassesAnswer, GlassesMessage, GlassesStatus, GlassesStore } from "./types";
import { linkMirror, postMirror, type ChannelDisplays } from "../screens/channel-mirror";
import { askDisplaySpec } from "../screens/display";

/**
 * The message tools (`glasses_notify|show|ask|get_answer|status`), pure over a
 * {@link GlassesStore} and an injectable clock. Everything is per USER: every
 * active device of the caller receives what is queued here, so text is shaped
 * for the default platform (`platforms/registry.ts`).
 */

/** Longest a single tool call holds for the wearer. Under the MCP route's maxDuration (300). */
export const ASK_HOLD_CAP_SEC = 200;
const ASK_POLL_MS = 1500;

/** `reply-<channel message id>` cards belong to the reply mirror. */
export const RESERVED_CARD_PREFIX = "reply-";

export interface GlassesDeps extends Clock {
  store: GlassesStore;
  devices: DeviceStore;
  platform?: GlassesPlatform;
  /** The channel mirror of screens/asks (`screens/channel-mirror.ts`); absent = none. */
  displays?: ChannelDisplays;
}

export const platformOf = (deps: GlassesDeps): GlassesPlatform => deps.platform ?? DEFAULT_PLATFORM;

/**
 * Re-read message `id` every {@link ASK_POLL_MS} for up to `holdSec` (capped),
 * returning the first result `settle` gives, or null when the hold ends first.
 */
export async function holdFor<T>(
  deps: GlassesDeps,
  userId: string,
  id: string,
  holdSec: number,
  settle: (row: GlassesMessage | null) => T | null,
  signal?: AbortSignal,
): Promise<T | null> {
  const sleep = sleepOf(deps);
  const start = nowOf(deps);
  const holdMs = Math.min(holdSec, ASK_HOLD_CAP_SEC) * 1000;
  while (nowOf(deps) - start < holdMs && !signal?.aborted) {
    await sleep(ASK_POLL_MS);
    const settled = settle(await deps.store.get(userId, id));
    if (settled) return settled;
  }
  return null;
}

export async function glassesNotify(
  deps: GlassesDeps,
  userId: string,
  args: { title?: unknown; body?: unknown; ttl_sec?: unknown },
) {
  const sanitize = platformOf(deps).sanitizeText;
  const title = cleanField(sanitize, "title", args.title, L.title);
  const body = cleanField(sanitize, "body", args.body, L.body);
  const ttl = cleanSeconds("ttl_sec", args.ttl_sec, 60, 5, 86_400);
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
  const now = nowOf(deps);
  const payload = { title, lines };
  const expiresAt = iso(now + ttl * 1000);
  const existing = cardId ? await deps.store.findActiveCard(userId, cardId, iso(now)) : null;
  const row = existing
    ? await deps.store.refreshCard(userId, existing.id, payload, expiresAt, iso(now))
    : await deps.store.insert(userId, { kind: "show", card_id: cardId, payload, expires_at: expiresAt, now: iso(now) });
  return { id: row.id, card_id: row.card_id, status: row.status };
}

type AskResult =
  | { id: string; status: "answered"; answer: GlassesAnswer }
  | { id: string; status: "timeout"; answer: null }
  | { id: string; status: "dismissed"; answer: null }
  | { id: string; status: "pending"; answer: null; note: string };

function settleAsk(id: string, row: GlassesMessage | null): AskResult | null {
  if (row?.status === "answered" && row.answer) return { id, status: "answered", answer: row.answer };
  if (row?.status === "expired") return { id, status: "timeout", answer: null };
  if (row?.status === "dismissed") return { id, status: "dismissed", answer: null };
  return null;
}

export async function glassesAsk(
  deps: GlassesDeps,
  userId: string,
  args: { question?: unknown; options?: unknown; timeout_sec?: unknown },
  signal?: AbortSignal,
): Promise<AskResult> {
  const sanitize = platformOf(deps).sanitizeText;
  const question = cleanField(sanitize, "question", args.question, L.question);
  const options = cleanList(sanitize, "options", args.options, L.options, L.option);
  const timeout = cleanSeconds("timeout_sec", args.timeout_sec, 120, 5, 86_400);
  const start = nowOf(deps);
  // Mirrored into the calling channel as a selectable display (device-aware messages).
  const mirrored = await postMirror(deps, askDisplaySpec(question, options), `ask-${start.toString(36)}`, true);
  const row = await deps.store.insert(userId, {
    kind: "ask",
    card_id: null,
    payload: { question, options },
    expires_at: iso(start + timeout * 1000),
    now: iso(start),
    channel_message_id: mirrored,
  });
  await linkMirror(deps, userId, mirrored, row);
  const settle = (r: GlassesMessage | null) => settleAsk(row.id, r);
  const settled = await holdFor(deps, userId, row.id, timeout, settle, signal);
  if (settled) return settled;

  if (timeout <= ASK_HOLD_CAP_SEC && !signal?.aborted) {
    const expired = await deps.store.transition(userId, row.id, ["pending", "delivered"], "expired", iso(nowOf(deps)));
    // Not expired: it was answered in the gap between the last poll and the expiry write.
    if (!expired) {
      const late = settle(await deps.store.get(userId, row.id));
      if (late) return late;
    }
    return { id: row.id, status: "timeout", answer: null };
  }
  return {
    id: row.id,
    status: "pending",
    answer: null,
    note: "Still waiting on the wearer. Call glasses_get_answer with this id later.",
  };
}

export async function glassesGetAnswer(deps: GlassesDeps, userId: string, args: { id?: unknown }) {
  if (typeof args.id !== "string" || !args.id.trim()) {
    throw new GlassesValidationError("id must be the id glasses_ask returned");
  }
  const id = args.id.trim();
  const row = isUuid(id) ? await deps.store.get(userId, id) : null;
  if (!row) throw new GlassesValidationError(`no glasses message with id ${args.id}`);
  let status: GlassesStatus = row.status;
  const now = nowOf(deps);
  if ((status === "pending" || status === "delivered") && Date.parse(row.expires_at) <= now) {
    if (await deps.store.transition(userId, row.id, ["pending", "delivered"], "expired", iso(now))) status = "expired";
  }
  return { id: row.id, status, answer: row.answer };
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
