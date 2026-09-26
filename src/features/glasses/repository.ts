import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  GlassesAnswer,
  GlassesKind,
  GlassesMessage,
  GlassesPayload,
  GlassesStatus,
  GlassesStore,
  GlassesTemplate,
  NewGlassesMessage,
} from "./types";

/**
 * Service-role access to `glasses_messages` / `glasses_templates`
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
const TEMPLATES = "glasses_templates";
const TEMPLATE_COLS = "name, spec, created_at, updated_at";

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
        spec: row.spec ?? null,
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

  async findActiveCard(
    userId: string,
    cardId: string,
    now: string,
    kind: GlassesKind = "show",
    statuses: GlassesStatus[] = ACTIVE,
  ) {
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .select(COLS)
      .eq("user_id", userId)
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

  async refreshCard(
    userId: string,
    id: string,
    payload: GlassesPayload,
    expiresAt: string,
    now: string,
    spec?: unknown,
  ) {
    const patch: Record<string, unknown> = {
      payload,
      status: "pending",
      answer: null,
      expires_at: expiresAt,
      updated_at: now,
    };
    if (spec !== undefined) patch.spec = spec;
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .update(patch)
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

  async getSpec(userId: string, id: string) {
    const { data, error } = await supabaseAdmin()
      .from(MESSAGES)
      .select("spec")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle();
    if (error) fail("getSpec", error);
    return (data as { spec: unknown } | null)?.spec ?? null;
  },

  async saveTemplate(userId: string, name: string, spec: unknown, now: string) {
    const { data, error } = await supabaseAdmin()
      .from(TEMPLATES)
      .upsert({ user_id: userId, name, spec, updated_at: now }, { onConflict: "user_id,name" })
      .select(TEMPLATE_COLS)
      .single();
    if (error) fail("saveTemplate", error);
    return data as GlassesTemplate;
  },

  async listTemplates(userId: string) {
    const { data, error } = await supabaseAdmin()
      .from(TEMPLATES)
      .select(TEMPLATE_COLS)
      .eq("user_id", userId)
      .order("name", { ascending: true });
    if (error) fail("listTemplates", error);
    return (data as GlassesTemplate[] | null) ?? [];
  },

  async getTemplate(userId: string, name: string) {
    const { data, error } = await supabaseAdmin()
      .from(TEMPLATES)
      .select(TEMPLATE_COLS)
      .eq("user_id", userId)
      .eq("name", name)
      .maybeSingle();
    if (error) fail("getTemplate", error);
    return (data as GlassesTemplate | null) ?? null;
  },

  async insertIfAbsent(userId: string, row: NewGlassesMessage) {
    try {
      return await glassesRepository.insert(userId, row);
    } catch (err) {
      // `glasses_messages_reply_card_uidx`: the reply was already mirrored.
      if (err instanceof Error && err.message.includes("duplicate key")) return null;
      throw err;
    }
  },
};
