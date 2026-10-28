import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  GlassesAnswer,
  GlassesKind,
  GlassesMessage,
  GlassesPayload,
  GlassesStatus,
  GlassesStore,
  NewGlassesMessage,
} from "@/features/glasses/core/messages/types";

/**
 * The {@link GlassesStore} contract over `dev_device_messages` (A8): the lens queue of an SDK-owned
 * G2, keyed by the SDK DEVICE id where the prosumer repository (`glasses/core/messages/repository.ts`)
 * keys by Dopl user. Same query semantics, same DB-stamped `updated_at` (the migration reuses the
 * prosumer trigger function), so `inbox.ts` reads it unchanged.
 *
 * ⚠ Service role, RLS bypassed: EVERY query filters on `device_id` here. The first argument of every
 * method is the device id the caller AUTHENTICATED (a device credential) or delivered to (the delivery
 * layer, already scoped to the project); nothing else reaches a row.
 *
 * SDK devices have no templates and no channel messages: those methods answer empty / no-op.
 */

const COLS = "id, kind, card_id, payload, status, answer, created_at, updated_at, expires_at";
const MESSAGES = "dev_device_messages";
const ACTIVE: GlassesStatus[] = ["pending", "delivered"];

const db = () => supabaseAdmin();

function fail(op: string, error: { message: string }): never {
  throw new Error(`[device-sdk] dev_device_messages ${op} failed: ${error.message}`);
}

const insertRow = (deviceId: string, row: NewGlassesMessage) => ({
  device_id: deviceId,
  kind: row.kind,
  card_id: row.card_id,
  payload: row.payload,
  status: "pending",
  expires_at: row.expires_at,
  spec: row.spec ?? null,
});

export const sdkGlassesStore: GlassesStore = {
  async insert(deviceId, row) {
    const { data, error } = await db().from(MESSAGES).insert(insertRow(deviceId, row)).select(COLS).single();
    if (error) fail("insert", error);
    return data as GlassesMessage;
  },

  async insertIfAbsent(deviceId, row) {
    return sdkGlassesStore.insert(deviceId, row);
  },

  async get(deviceId, id) {
    const { data, error } = await db().from(MESSAGES).select(COLS).eq("device_id", deviceId).eq("id", id).maybeSingle();
    if (error) fail("get", error);
    return (data as GlassesMessage | null) ?? null;
  },

  async findActiveCard(deviceId, cardId, now, kind: GlassesKind = "show", statuses: GlassesStatus[] = ACTIVE) {
    const { data, error } = await db()
      .from(MESSAGES)
      .select(COLS)
      .eq("device_id", deviceId)
      .eq("kind", kind)
      .eq("card_id", cardId)
      .in("status", statuses)
      .gt("expires_at", now)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("findActiveCard", error);
    return (data as GlassesMessage | null) ?? null;
  },

  async refreshCard(deviceId, id, payload: GlassesPayload, expiresAt, _now, spec?: unknown) {
    const patch: Record<string, unknown> = { payload, status: "pending", answer: null, expires_at: expiresAt };
    if (spec !== undefined) patch.spec = spec;
    const { data, error } = await db().from(MESSAGES).update(patch).eq("device_id", deviceId).eq("id", id).select(COLS).single();
    if (error) fail("refreshCard", error);
    return data as GlassesMessage;
  },

  async getSpec(deviceId, id) {
    const { data, error } = await db().from(MESSAGES).select("spec").eq("device_id", deviceId).eq("id", id).maybeSingle();
    if (error) fail("getSpec", error);
    return (data as { spec: unknown } | null)?.spec ?? null;
  },

  async transition(deviceId, id, from: GlassesStatus[], to: GlassesStatus, _now, answer?: GlassesAnswer) {
    const patch: Record<string, unknown> = { status: to };
    if (answer) patch.answer = answer;
    const { data, error } = await db()
      .from(MESSAGES)
      .update(patch)
      .eq("device_id", deviceId)
      .eq("id", id)
      .in("status", from)
      .select(COLS)
      .maybeSingle();
    if (error) fail("transition", error);
    return (data as GlassesMessage | null) ?? null;
  },

  async expireStale(deviceId, now) {
    const { error } = await db().from(MESSAGES).update({ status: "expired" }).eq("device_id", deviceId).in("status", ACTIVE).lte("expires_at", now);
    if (error) fail("expireStale", error);
  },

  async listInbox(deviceId, now, since) {
    let query = db().from(MESSAGES).select(COLS).eq("device_id", deviceId);
    query = since ? query.gt("updated_at", since) : query.in("status", ACTIVE).gt("expires_at", now);
    const { data, error } = await query.order("updated_at", { ascending: true }).limit(50);
    if (error) fail("listInbox", error);
    return (data as GlassesMessage[] | null) ?? [];
  },

  async markDelivered(deviceId, ids) {
    if (ids.length === 0) return;
    const { error } = await db().from(MESSAGES).update({ status: "delivered" }).eq("device_id", deviceId).eq("status", "pending").in("id", ids);
    if (error) fail("markDelivered", error);
  },

  async countActive(deviceId, now) {
    const { count, error } = await db()
      .from(MESSAGES)
      .select("id", { count: "exact", head: true })
      .eq("device_id", deviceId)
      .in("status", ACTIVE)
      .gt("expires_at", now);
    if (error) fail("countActive", error);
    return count ?? 0;
  },

  async linkChannelMessage() {},

  async saveTemplate() {
    throw new Error("[device-sdk] SDK devices have no glasses templates");
  },
  async listTemplates() {
    return [];
  },
  async getTemplate() {
    return null;
  },
};
