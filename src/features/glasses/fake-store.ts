import type { GlassesMessage, GlassesStatus, GlassesStore } from "./types";

/** In-memory {@link GlassesStore} for tests — mirrors `repository.ts` query semantics. */
export function createFakeGlassesStore() {
  const rows: (GlassesMessage & { user_id: string })[] = [];
  const devices = new Map<string, string>();
  let seq = 0;
  const active = (r: GlassesMessage, now: string) =>
    (r.status === "pending" || r.status === "delivered") && r.expires_at > now;
  const strip = (r: GlassesMessage & { user_id: string }): GlassesMessage => {
    const m: Partial<typeof r> = { ...r };
    delete m.user_id;
    return m as GlassesMessage;
  };
  const find = (userId: string, id: string) =>
    rows.find((r) => r.user_id === userId && r.id === id);

  const store: GlassesStore = {
    async insert(userId, row) {
      seq += 1;
      const r = {
        id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
        user_id: userId,
        kind: row.kind,
        card_id: row.card_id,
        payload: row.payload,
        status: "pending" as GlassesStatus,
        answer: null,
        created_at: row.now,
        updated_at: row.now,
        expires_at: row.expires_at,
      };
      rows.push(r);
      return strip(r);
    },
    async get(userId, id) {
      const r = find(userId, id);
      return r ? strip(r) : null;
    },
    async findActiveCard(userId, cardId, now) {
      const r = rows
        .filter((x) => x.user_id === userId && x.kind === "show" && x.card_id === cardId && active(x, now))
        .at(-1);
      return r ? strip(r) : null;
    },
    async refreshCard(userId, id, payload, expiresAt, now) {
      const r = find(userId, id)!;
      Object.assign(r, { payload, status: "pending", expires_at: expiresAt, updated_at: now });
      return strip(r);
    },
    async transition(userId, id, from, to, now, answer) {
      const r = find(userId, id);
      if (!r || !from.includes(r.status)) return null;
      Object.assign(r, { status: to, updated_at: now }, answer ? { answer } : {});
      return strip(r);
    },
    async expireStale(userId, now) {
      for (const r of rows) {
        if (r.user_id === userId && (r.status === "pending" || r.status === "delivered") && r.expires_at <= now) {
          Object.assign(r, { status: "expired", updated_at: now });
        }
      }
    },
    async listInbox(userId, now, after) {
      return rows
        .filter((r) => r.user_id === userId && active(r, now) && (!after || r.updated_at > after))
        .sort((a, b) => a.updated_at.localeCompare(b.updated_at))
        .map(strip);
    },
    async markDelivered(userId, ids) {
      for (const r of rows) {
        if (r.user_id === userId && r.status === "pending" && ids.includes(r.id)) r.status = "delivered";
      }
    },
    async countActive(userId, now) {
      return rows.filter((r) => r.user_id === userId && active(r, now)).length;
    },
    async touchDevice(userId, now) {
      devices.set(userId, now);
    },
    async lastSeen(userId) {
      return devices.get(userId) ?? null;
    },
  };
  return { store, rows, devices };
}

/** A controllable clock whose `sleep` just advances time. */
export function fakeClock(startIso = "2026-09-26T12:00:00.000Z") {
  let t = Date.parse(startIso);
  const hooks: (() => void | Promise<void>)[] = [];
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    onSleep: (fn: () => void | Promise<void>) => hooks.push(fn),
    sleep: async (ms: number) => {
      t += ms;
      for (const h of hooks) await h();
    },
  };
}
