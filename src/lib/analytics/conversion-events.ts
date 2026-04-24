import { supabaseAdmin } from "@/shared/supabase/admin";

/**
 * Append-only funnel event log. Fire-and-forget — never throws. Feeds
 * the admin analytics dashboard.
 */

export type ConversionEventType =
  | "signup"
  | "trial_started"
  | "first_cluster_built"
  | "first_ingest_completed"
  | "trial_expired"
  | "subscribed"
  | "reactivation_email_sent"
  | "reactivated"
  | "churned";

export async function logConversionEvent(params: {
  userId: string;
  eventType: ConversionEventType;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await supabaseAdmin().from("conversion_events").insert({
      user_id: params.userId,
      event_type: params.eventType,
      metadata: params.metadata ?? {},
    });
  } catch (err) {
    // Fire-and-forget. Never break the caller.
    console.error(
      `[conversion-events] log failed for ${params.eventType}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Check if a user has ever fired a given event. Used to avoid duplicate
 * "first_cluster_built" / "first_ingest_completed" events on the 2nd+
 * occurrence.
 */
export async function hasFiredEvent(
  userId: string,
  eventType: ConversionEventType
): Promise<boolean> {
  const { data } = await supabaseAdmin()
    .from("conversion_events")
    .select("id")
    .eq("user_id", userId)
    .eq("event_type", eventType)
    .limit(1)
    .maybeSingle();
  return !!data;
}
