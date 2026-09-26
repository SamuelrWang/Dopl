import { timingSafeEqual } from "node:crypto";
import { isUuid } from "./text";
import type { GlassesMessage, GlassesStore, ScreenPayload } from "./types";

/**
 * The G2 plugin's side of the queue: auth, CORS, long-poll inbox, answer,
 * dismiss. Route files in `src/app/api/glasses/device/*` are thin wrappers.
 *
 * PROTOTYPE AUTH: one device, one static bearer (`GLASSES_DEVICE_TOKEN`) mapped
 * to one user (`GLASSES_DEVICE_USER_ID`). No pairing.
 */

export const DEVICE_ALLOWED_ORIGINS = [
  "http://127.0.0.1:5180",
  "http://localhost:5180",
] as const;
export const INBOX_MAX_WAIT_SEC = 25;
export const INBOX_POLL_MS = 1000;

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && (DEVICE_ALLOWED_ORIGINS as readonly string[]).includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

/** The device's user id, or null when the bearer is missing/wrong or env is unset. */
export function authenticateDevice(
  request: Request,
  env: { token?: string; userId?: string } = {
    token: process.env.GLASSES_DEVICE_TOKEN,
    userId: process.env.GLASSES_DEVICE_USER_ID,
  },
): string | null {
  if (!env.token || !env.userId) return null;
  const presented = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!presented) return null;
  const a = Buffer.from(presented);
  const b = Buffer.from(env.token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return env.userId;
}

export interface DeviceDeps {
  store: GlassesStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function parseInboxQuery(url: URL): { after: string | null; waitSec: number } | { error: string } {
  // An unencoded `+00:00` offset arrives as a space; put the plus back.
  const afterRaw = url.searchParams.get("after")?.trim().replace(/ /g, "+");
  let after: string | null = null;
  if (afterRaw) {
    const ms = Date.parse(afterRaw);
    if (Number.isNaN(ms)) return { error: "after must be an ISO timestamp" };
    // Pass the caller's own string through when it round-trips: a DB
    // `updated_at` carries microseconds that Date would truncate.
    after = afterRaw;
  }
  const waitRaw = url.searchParams.get("wait");
  let waitSec = INBOX_MAX_WAIT_SEC;
  if (waitRaw !== null && waitRaw !== "") {
    const n = Number(waitRaw);
    if (!Number.isFinite(n) || n < 0) return { error: "wait must be seconds, 0-25" };
    waitSec = Math.min(Math.floor(n), INBOX_MAX_WAIT_SEC);
  }
  return { after, waitSec };
}

export async function readInbox(
  deps: DeviceDeps,
  userId: string,
  after: string | null,
  waitSec: number,
  signal?: AbortSignal,
): Promise<{ messages: GlassesMessage[]; server_time: string }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const start = now();
  await deps.store.touchDevice(userId, new Date(start).toISOString());
  await deps.store.expireStale(userId, new Date(start).toISOString());

  for (;;) {
    const t = new Date(now()).toISOString();
    const rows = await deps.store.listInbox(userId, t, after);
    if (rows.length > 0) {
      const pendingIds = rows.filter((r) => r.status === "pending").map((r) => r.id);
      await deps.store.markDelivered(userId, pendingIds);
      return {
        messages: rows.map((r) => (r.status === "pending" ? { ...r, status: "delivered" } : r)),
        server_time: t,
      };
    }
    if (signal?.aborted || now() - start + INBOX_POLL_MS > waitSec * 1000) {
      return { messages: [], server_time: t };
    }
    await sleep(INBOX_POLL_MS);
  }
}

export type AnswerOutcome =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function answerAsk(
  deps: DeviceDeps,
  userId: string,
  body: unknown,
): Promise<AnswerOutcome> {
  const b = (body ?? {}) as { id?: unknown; choice?: unknown; index?: unknown; block_id?: unknown };
  if (typeof b.id !== "string" || !b.id) return { ok: false, status: 400, error: "id required" };
  const row = isUuid(b.id) ? await deps.store.get(userId, b.id) : null;
  if (row?.kind === "screen") return answerScreen(deps, userId, row, b);
  if (!row || row.kind !== "ask") return { ok: false, status: 404, error: "no such ask" };
  const options = (row.payload as { options: string[] }).options ?? [];
  let index = typeof b.index === "number" && Number.isInteger(b.index) ? b.index : -1;
  if (index < 0 || index >= options.length) {
    index = typeof b.choice === "string" ? options.indexOf(b.choice) : -1;
  }
  if (index < 0) {
    return { ok: false, status: 400, error: `index must be 0-${options.length - 1}` };
  }
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs).toISOString();
  if (Date.parse(row.expires_at) <= nowMs) {
    await deps.store.transition(userId, row.id, ["pending", "delivered"], "expired", at);
    return { ok: false, status: 409, error: "ask expired" };
  }
  const moved = await deps.store.transition(
    userId,
    row.id,
    ["pending", "delivered"],
    "answered",
    at,
    { choice: options[index], index, at },
  );
  if (!moved) return { ok: false, status: 409, error: `ask already ${row.status}` };
  return { ok: true };
}

/**
 * A tap on an agent-built screen. Unlike an ask, a screen may be tapped again
 * (the latest input wins) until it expires, because it stays on the glasses.
 * `index` resolves from `choice` against the list's items when missing — the
 * G2 delivers index 0 as undefined.
 */
async function answerScreen(
  deps: DeviceDeps,
  userId: string,
  row: GlassesMessage,
  b: { choice?: unknown; index?: unknown; block_id?: unknown },
): Promise<AnswerOutcome> {
  const containers = (row.payload as ScreenPayload).containers ?? [];
  let container = containers.find((c) => c.capture) ?? null;
  if (b.block_id !== undefined && b.block_id !== null) {
    container = containers.find((c) => c.block_id === b.block_id) ?? null;
    if (!container) return { ok: false, status: 400, error: `no block '${String(b.block_id)}' on this screen` };
  }
  const choice = typeof b.choice === "string" && b.choice ? b.choice.slice(0, 200) : "click";
  let index = typeof b.index === "number" && Number.isInteger(b.index) ? b.index : -1;
  if (container?.kind === "list") {
    const items = container.items ?? [];
    if (index < 0 || index >= items.length) index = items.indexOf(choice);
    if (index < 0) return { ok: false, status: 400, error: `index must be 0-${items.length - 1}` };
  } else if (index < 0) {
    index = 0;
  }
  const nowMs = (deps.now ?? Date.now)();
  const at = new Date(nowMs).toISOString();
  if (Date.parse(row.expires_at) <= nowMs) {
    await deps.store.transition(userId, row.id, ["pending", "delivered", "answered"], "expired", at);
    return { ok: false, status: 409, error: "screen expired" };
  }
  const answer = {
    choice: container?.kind === "list" ? (container.items ?? [])[index] : choice,
    index,
    at,
    block_id: container?.block_id ?? null,
  };
  const moved = await deps.store.transition(
    userId,
    row.id,
    ["pending", "delivered", "answered"],
    "answered",
    at,
    answer,
  );
  if (!moved) return { ok: false, status: 409, error: `screen already ${row.status}` };
  return { ok: true };
}

export async function dismissMessage(
  deps: DeviceDeps,
  userId: string,
  body: unknown,
): Promise<AnswerOutcome> {
  const b = (body ?? {}) as { id?: unknown };
  if (typeof b.id !== "string" || !b.id) return { ok: false, status: 400, error: "id required" };
  const row = isUuid(b.id) ? await deps.store.get(userId, b.id) : null;
  if (!row) return { ok: false, status: 404, error: "no such message" };
  const at = new Date((deps.now ?? Date.now)()).toISOString();
  await deps.store.transition(userId, row.id, ["pending", "delivered"], "dismissed", at);
  return { ok: true };
}
