import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  GlassesAnswer,
  GlassesMessage,
  GlassesPayload,
  GlassesStatus,
  GlassesStore,
  NewGlassesMessage,
} from "./types";

/**
 * Service-role access to `glasses_messages` / `glasses_devices`
 * (`20261025120000_glasses_messages.sql`). ⚠ Bypasses RLS, so EVERY query is
 * filtered on `user_id` here — the callers pass the authenticated user.
 *
 * ⚠ ONE CLOCK: every timestamp is written from the app's clock (the `now`
 * argument), never the DB's `now()`, because the device inbox compares
 * `updated_at` against a cursor the app handed out.
 */

const COLS =
  "id, kind, card_id, payload, status, answer, created_at, updated_at, expires_at";
const MESSAGES = "glasses_messages";
const ACTIVE: GlassesStatus[] = ["pending", "delivered"];

function fail(op: string, error: { message: string }): never {
  throw new Error(`glasses ${op} failed: ${error.message}`);
}

export const glassesRepository: GlassesStore = {
  async insert(userId: string, row: NewGlassesMessage) {
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .insert({
        user_id: userId,
        kind: row.kind,
        card_id: row.card_id,
        payload: row.payload,
        status: "pending",
        expires_at: row.expires_at,
        created_at: row.now,
        updated_at: row.now,
      })
      .select(COLS)
      .single();
    if (error) fail("insert", error);
    return data as GlassesMessage;
  },

  async get(userId: string, id: string) {
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .select(COLS)
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail("get", error);
    return (data as GlassesMessage | null) ?? null;
  },

  async findActiveCard(userId: string, cardId: string, now: string) {
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .select(COLS)
      .eq("user_id", userId)
      .eq("kind", "show")
      .eq("card_id", cardId)
      .in("status", ACTIVE)
      .gt("expires_at", now)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) fail("findActiveCard", error);
    return (data as GlassesMessage | null) ?? null;
  },

  async refreshCard(
    userId: string,
    id: string,
    payload: GlassesPayload,
    expiresAt: string,
    now: string,
  ) {
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .update({ payload, status: "pending", expires_at: expiresAt, updated_at: now })
      .eq("user_id", userId)
      .eq("id", id)
      .select(COLS)
      .single();
    if (error) fail("refreshCard", error);
    return data as GlassesMessage;
  },

  async transition(
    userId: string,
    id: string,
    from: GlassesStatus[],
    to: GlassesStatus,
    now: string,
    answer?: GlassesAnswer,
  ) {
    const patch: Record<string, unknown> = { status: to, updated_at: now };
    if (answer) patch.answer = answer;
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .update(patch)
      .eq("user_id", userId)
      .eq("id", id)
      .in("status", from)
      .select(COLS)
      .maybeSingle();
    if (error) fail("transition", error);
    return (data as GlassesMessage | null) ?? null;
  },

  async expireStale(userId: string, now: string) {
    const { error } = await supabaseAdmin()
      .from(MESSAGES)
      .update({ status: "expired", updated_at: now })
      .eq("user_id", userId)
      .in("status", ACTIVE)
      .lte("expires_at", now);
    if (error) fail("expireStale", error);
  },

  async listInbox(userId: string, now: string, after: string | null) {
    let query = supabaseAdmin()
      .from(MESSAGES)
      .select(COLS)
      .eq("user_id", userId)
      .in("status", ACTIVE)
      .gt("expires_at", now);
    if (after) query = query.gt("updated_at", after);
    const { data, error } = await query
      .order("updated_at", { ascending: true })
      .limit(50);
    if (error) fail("listInbox", error);
    return (data as GlassesMessage[] | null) ?? [];
  },

  async markDelivered(userId: string, ids: string[]) {
    if (ids.length === 0) return;
    const { error } = await supabaseAdmin()
      .from(MESSAGES)
      .update({ status: "delivered" })
      .eq("user_id", userId)
      .eq("status", "pending")
      .in("id", ids);
    if (error) fail("markDelivered", error);
  },

  async countActive(userId: string, now: string) {
    const { count, error } = await supabaseAdmin()
      .from(MESSAGES)
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .in("status", ACTIVE)
      .gt("expires_at", now);
    if (error) fail("countActive", error);
    return count ?? 0;
  },

  async touchDevice(userId: string, now: string) {
    const { error } = await supabaseAdmin()
      .from("glasses_devices")
      .upsert({ user_id: userId, last_seen: now }, { onConflict: "user_id" });
    if (error) fail("touchDevice", error);
  },

  async lastSeen(userId: string) {
    const { data, error } = await supabaseAdmin()
      .from("glasses_devices")
      .select("last_seen")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) fail("lastSeen", error);
    return (data as { last_seen: string } | null)?.last_seen ?? null;
  },
};
