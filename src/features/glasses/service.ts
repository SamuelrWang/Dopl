import {
  GLASSES_LIMITS as L,
  GlassesValidationError,
  cleanField,
  cleanList,
  cleanSeconds,
  isUuid,
} from "./text";
import type { GlassesAnswer, GlassesStatus, GlassesStore } from "./types";

/**
 * The five agent-facing operations behind `/api/mcp/glasses`. Pure over a
 * {@link GlassesStore} plus an injectable clock/sleep, so the hold loop is
 * testable without a database or real time.
 */

/** Longest a single `glasses_ask` call holds. Under the route's maxDuration (300). */
export const ASK_HOLD_CAP_SEC = 200;
export const ASK_POLL_MS = 1000;
export const ONLINE_WINDOW_MS = 60_000;

export interface GlassesDeps {
  store: GlassesStore;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const iso = (ms: number) => new Date(ms).toISOString();

function clock(deps: GlassesDeps) {
  return deps.now ?? Date.now;
}

export async function glassesNotify(
  deps: GlassesDeps,
  userId: string,
  args: { title?: unknown; body?: unknown; ttl_sec?: unknown },
) {
  const title = cleanField("title", args.title, L.title);
  const body = cleanField("body", args.body, L.body);
  const ttl = cleanSeconds("ttl_sec", args.ttl_sec, 60, 5, 86_400);
  const now = clock(deps)();
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
  const title = cleanField("title", args.title, L.title);
  const lines = cleanList("lines", args.lines, L.lines, L.line);
  const ttl = cleanSeconds("ttl_sec", args.ttl_sec, 600, 5, 86_400);
  let cardId: string | null = null;
  if (args.card_id !== undefined && args.card_id !== null) {
    if (typeof args.card_id !== "string" || !args.card_id.trim()) {
      throw new GlassesValidationError("card_id must be a non-empty string");
    }
    cardId = args.card_id.trim().slice(0, 64);
  }
  const now = clock(deps)();
  const payload = { title, lines };
  const expiresAt = iso(now + ttl * 1000);
  const existing = cardId
    ? await deps.store.findActiveCard(userId, cardId, iso(now))
    : null;
  const row = existing
    ? await deps.store.refreshCard(userId, existing.id, payload, expiresAt, iso(now))
    : await deps.store.insert(userId, {
        kind: "show",
        card_id: cardId,
        payload,
        expires_at: expiresAt,
        now: iso(now),
      });
  return { id: row.id, card_id: row.card_id, status: row.status };
}

export type AskResult =
  | { id: string; status: "answered"; answer: GlassesAnswer }
  | { id: string; status: "timeout"; answer: null }
  | { id: string; status: "dismissed"; answer: null }
  | { id: string; status: "pending"; answer: null; note: string };

export async function glassesAsk(
  deps: GlassesDeps,
  userId: string,
  args: { question?: unknown; options?: unknown; timeout_sec?: unknown },
  signal?: AbortSignal,
): Promise<AskResult> {
  const question = cleanField("question", args.question, L.question);
  const options = cleanList("options", args.options, L.options, L.option);
  const timeout = cleanSeconds("timeout_sec", args.timeout_sec, 120, 5, 86_400);
  const now = clock(deps);
  const sleep = deps.sleep ?? defaultSleep;
  const start = now();
  const row = await deps.store.insert(userId, {
    kind: "ask",
    card_id: null,
    payload: { question, options },
    expires_at: iso(start + timeout * 1000),
    now: iso(start),
  });

  const holdMs = Math.min(timeout, ASK_HOLD_CAP_SEC) * 1000;
  while (now() - start < holdMs) {
    if (signal?.aborted) break;
    await sleep(ASK_POLL_MS);
    const current = await deps.store.get(userId, row.id);
    const settled = settle(row.id, current?.status, current?.answer ?? null);
    if (settled) return settled;
  }

  if (timeout <= ASK_HOLD_CAP_SEC && !signal?.aborted) {
    const expired = await deps.store.transition(
      userId,
      row.id,
      ["pending", "delivered"],
      "expired",
      iso(now()),
    );
    if (!expired) {
      // Answered in the gap between the last poll and the expiry write.
      const current = await deps.store.get(userId, row.id);
      const settled = settle(row.id, current?.status, current?.answer ?? null);
      if (settled) return settled;
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

function settle(
  id: string,
  status: GlassesStatus | undefined,
  answer: GlassesAnswer | null,
): AskResult | null {
  if (status === "answered" && answer) return { id, status: "answered", answer };
  if (status === "expired") return { id, status: "timeout", answer: null };
  if (status === "dismissed") return { id, status: "dismissed", answer: null };
  return null;
}

export async function glassesGetAnswer(
  deps: GlassesDeps,
  userId: string,
  args: { id?: unknown },
) {
  if (typeof args.id !== "string" || !args.id.trim()) {
    throw new GlassesValidationError("id must be the id glasses_ask returned");
  }
  const id = args.id.trim();
  const row = isUuid(id) ? await deps.store.get(userId, id) : null;
  if (!row) throw new GlassesValidationError(`no glasses message with id ${args.id}`);
  let status = row.status;
  if ((status === "pending" || status === "delivered") && Date.parse(row.expires_at) <= clock(deps)()) {
    const moved = await deps.store.transition(
      userId,
      row.id,
      ["pending", "delivered"],
      "expired",
      iso(clock(deps)()),
    );
    if (moved) status = "expired";
  }
  return { id: row.id, status, answer: row.answer };
}

export async function glassesStatus(deps: GlassesDeps, userId: string) {
  const now = clock(deps)();
  const [lastSeen, activeCount] = await Promise.all([
    deps.store.lastSeen(userId),
    deps.store.countActive(userId, iso(now)),
  ]);
  const online = lastSeen !== null && now - Date.parse(lastSeen) <= ONLINE_WINDOW_MS;
  return { online, last_seen: lastSeen, active_count: activeCount };
}
