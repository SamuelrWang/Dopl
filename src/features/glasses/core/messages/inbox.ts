import { iso, nowOf, sleepOf, type Clock } from "../clock";
import { isUuid } from "../validation";
import { REC_MARK } from "@/features/display/core/degrade";
import type { GlassesMessage, GlassesStatus, GlassesStore, ScreenPayload } from "./types";

/**
 * The glasses' side of the message queue: long-poll inbox, answer, dismiss.
 * Everything here is per USER, so every active device of the user sees the
 * same queue.
 */

const INBOX_MAX_WAIT_SEC = 25;
const INBOX_POLL_MS = 2000;
/** How far before `after` the inbox looks again (clock skew / late-committed rows). */
const INBOX_OVERLAP_MS = 15_000;

export interface InboxDeps extends Clock {
  store: GlassesStore;
  /** Runs before each inbox read (the channel reply mirror). Its failure never fails the poll. */
  beforeRead?: () => Promise<void>;
}

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

/**
 * Long-poll the user's queue.
 *
 * CURSOR CONTRACT: `after` is the `updated_at` of the newest message the device
 * holds. The server answers with every row touched in the last
 * {@link INBOX_OVERLAP_MS} before `after` too — terminal ones included, so a
 * message answered or dismissed on another device clears here — and the device
 * dedupes by `(id, updated_at)`. The overlap catches a row whose write committed
 * after a later one's. The hold ends as soon as any row is strictly newer than
 * `after` (or anything is queued, without a cursor).
 */
export async function readInbox(
  deps: InboxDeps,
  userId: string,
  after: string | null,
  waitSec: number,
  signal?: AbortSignal,
): Promise<{ messages: GlassesMessage[]; server_time: string }> {
  const sleep = sleepOf(deps);
  const start = nowOf(deps);
  await deps.store.expireStale(userId, iso(start));
  const afterMs = after ? Date.parse(after) : null;
  const since = afterMs === null ? null : iso(afterMs - INBOX_OVERLAP_MS);

  for (;;) {
    if (deps.beforeRead) {
      try {
        await deps.beforeRead();
      } catch (err) {
        console.error("[glasses] inbox pre-read hook failed", err);
      }
    }
    const t = iso(nowOf(deps));
    const rows = await deps.store.listInbox(userId, t, since);
    const fresh = afterMs === null ? rows : rows.filter((r) => Date.parse(r.updated_at) > afterMs);
    const done = signal?.aborted || nowOf(deps) - start + INBOX_POLL_MS > waitSec * 1000;
    if (fresh.length > 0 || done) {
      const pendingIds = rows.filter((r) => r.status === "pending").map((r) => r.id);
      await deps.store.markDelivered(userId, pendingIds);
      return {
        messages: rows.map((r) => (r.status === "pending" ? { ...r, status: "delivered" } : r)),
        server_time: t,
      };
    }
    await sleep(INBOX_POLL_MS);
  }
}

/** `message`: the answered row, for its linked channel decision (`display/server/answer.ts › answerFromLens`). */
export type AnswerOutcome = { ok: true; message?: GlassesMessage } | { ok: false; status: 400 | 404 | 409; error: string };

type AnswerBody = { id?: unknown; choice?: unknown; index?: unknown; block_id?: unknown };

async function findMessage(deps: InboxDeps, userId: string, body: unknown) {
  const b = (body ?? {}) as AnswerBody;
  if (typeof b.id !== "string" || !b.id) return { b, row: null, missingId: true };
  return { b, row: isUuid(b.id) ? await deps.store.get(userId, b.id) : null, missingId: false };
}

const intOr = (v: unknown, fallback: number) => (typeof v === "number" && Number.isInteger(v) ? v : fallback);

/** Expire a stale row, else move it to `answered`; a lost race answers 409. */
async function settleAnswer(
  deps: InboxDeps,
  userId: string,
  row: GlassesMessage,
  from: GlassesStatus[],
  answer: { choice: string; index: number; block_id?: string | null },
): Promise<AnswerOutcome> {
  const nowMs = nowOf(deps);
  const at = iso(nowMs);
  if (Date.parse(row.expires_at) <= nowMs) {
    await deps.store.transition(userId, row.id, from, "expired", at);
    return { ok: false, status: 409, error: `${row.kind} expired` };
  }
  const moved = await deps.store.transition(userId, row.id, from, "answered", at, { ...answer, at });
  return moved ? { ok: true, message: moved } : { ok: false, status: 409, error: `${row.kind} already ${row.status}` };
}

export async function answerAsk(deps: InboxDeps, userId: string, body: unknown): Promise<AnswerOutcome> {
  const { b, row, missingId } = await findMessage(deps, userId, body);
  if (missingId) return { ok: false, status: 400, error: "id required" };
  if (row?.kind === "screen") return answerScreen(deps, userId, row, b);
  if (!row || row.kind !== "ask") return { ok: false, status: 404, error: "no such ask" };
  const options = (row.payload as { options: string[] }).options ?? [];
  let index = intOr(b.index, -1);
  if (index < 0 || index >= options.length) index = typeof b.choice === "string" ? options.indexOf(b.choice) : -1;
  if (index < 0) return { ok: false, status: 400, error: `index must be 0-${options.length - 1}` };
  return settleAnswer(deps, userId, row, ["pending", "delivered"], { choice: options[index], index });
}

/**
 * A tap on an agent-built screen. Unlike an ask, a screen may be tapped again
 * (the latest input wins) until it expires, because it stays on the glasses — except a choice
 * linked to a channel decision, which is answered once.
 * `index` resolves from `choice` against the list's items when missing: a
 * platform may deliver index 0 as undefined.
 */
async function answerScreen(deps: InboxDeps, userId: string, row: GlassesMessage, b: AnswerBody): Promise<AnswerOutcome> {
  const containers = (row.payload as ScreenPayload).containers ?? [];
  let container = containers.find((c) => c.capture) ?? null;
  if (b.block_id !== undefined && b.block_id !== null) {
    container = containers.find((c) => c.block_id === b.block_id) ?? null;
    if (!container) return { ok: false, status: 400, error: `no block '${String(b.block_id)}' on this screen` };
  }
  let choice = typeof b.choice === "string" && b.choice ? b.choice.slice(0, 200) : "click";
  let index = intOr(b.index, -1);
  if (container?.kind === "list") {
    const items = container.items ?? [];
    if (index < 0 || index >= items.length) index = items.indexOf(choice);
    if (index < 0) return { ok: false, status: 400, error: `index must be 0-${items.length - 1}` };
    // The lens's own marker is display text, never part of the answer (the label is authoritative).
    choice = items[index].endsWith(REC_MARK) ? items[index].slice(0, -REC_MARK.length) : items[index];
  } else if (index < 0) {
    index = 0;
  }
  // ⚠ A CHOICE LINKED TO A CHANNEL DECISION IS ANSWERED ONCE (unified display): its answer is the
  // decision's, so a second tap is a 409 like a second press — never a new answer on the lens only.
  const once = !!row.channel_message_id && container?.kind === "list";
  const from: GlassesStatus[] = once ? ["pending", "delivered"] : ["pending", "delivered", "answered"];
  return settleAnswer(deps, userId, row, from, { choice, index, block_id: container?.block_id ?? null });
}

export async function dismissMessage(deps: InboxDeps, userId: string, body: unknown): Promise<AnswerOutcome> {
  const { row, missingId } = await findMessage(deps, userId, body);
  if (missingId) return { ok: false, status: 400, error: "id required" };
  if (!row) return { ok: false, status: 404, error: "no such message" };
  await deps.store.transition(userId, row.id, ["pending", "delivered"], "dismissed", iso(nowOf(deps)));
  return { ok: true };
}
