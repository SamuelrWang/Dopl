import { isUuid } from "./text";
import type { GlassesMessage, GlassesStore, ScreenPayload } from "./types";

/**
 * The glasses' side of the message queue: long-poll inbox, answer, dismiss.
 * Auth (`devices-service.ts › deviceFromBearer`) and CORS (`cors.ts`) happen in
 * the route files, which are thin wrappers; everything here is per USER, so
 * every active device of the user sees the same queue.
 */

export const INBOX_MAX_WAIT_SEC = 25;
export const INBOX_POLL_MS = 1000;

export interface DeviceDeps {
  store: GlassesStore;
  /** Runs before each inbox read, e.g. the channel reply mirror. Its failure never fails the poll. */
  beforeRead?: () => Promise<void>;
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
  await deps.store.expireStale(userId, new Date(start).toISOString());

  for (;;) {
    if (deps.beforeRead) {
      try {
        await deps.beforeRead();
      } catch (err) {
        console.error("[glasses] inbox pre-read hook failed", err);
      }
    }
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
