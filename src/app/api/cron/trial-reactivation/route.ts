import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logConversionEvent } from "@/features/analytics/server/conversion-events";

/**
 * Hourly cron (vercel.json). Two jobs in one endpoint:
 *
 *   1. Trial expiry flip: users whose trial_expires_at has passed and
 *      who are still 'trialing' → flip to 'expired' and log the event.
 *
 *   2. Reactivation email: users whose trial_expires_at was 48h ago,
 *      who are 'expired' (not subscribed), and haven't been emailed yet
 *      → send one reactivation email and stamp reactivation_email_sent_at.
 *
 * Protected by CRON_SECRET header check (Vercel sets this automatically
 * if configured; accept the bearer-style header they send).
 */

const REACTIVATION_DELAY_MS = 48 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  // Simple shared-secret auth. Set CRON_SECRET in env; Vercel Cron will
  // send it as Authorization: Bearer <secret>.
  const auth = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const now = new Date().toISOString();

  // ── Job 1: flip expired trials ───────────────────────────────────
  // Select a batch so we can log events for each (set-based UPDATE
  // doesn't give us the list of affected rows in one round-trip without
  // a RETURNING clause, which the supabase-js update() does expose).
  const { data: expiringUsers, error: expError } = await supabase
    .from("profiles")
    .update({ subscription_status: "expired" })
    .eq("subscription_status", "trialing")
    .lt("trial_expires_at", now)
    .select("id");

  if (expError) {
    console.error(`[cron.trial] expiry flip failed: ${expError.message}`);
  } else {
    for (const row of expiringUsers ?? []) {
      await logConversionEvent({
        userId: row.id as string,
        eventType: "trial_expired",
      });
    }
  }
  const expiredCount = expiringUsers?.length ?? 0;

  // ── Job 2: send reactivation emails ──────────────────────────────
  // 48h after expiry, one email, stamp so we never email twice.
  const reactivationThreshold = new Date(
    Date.now() - REACTIVATION_DELAY_MS
  ).toISOString();

  const { data: toEmail, error: emailError } = await supabase
    .from("profiles")
    .select("id, email, trial_expires_at")
    .eq("subscription_status", "expired")
    .is("reactivation_email_sent_at", null)
    .lt("trial_expires_at", reactivationThreshold)
    .limit(100); // cap each tick

  if (emailError) {
    console.error(
      `[cron.trial] reactivation email query failed: ${emailError.message}`
    );
  }

  let emailedCount = 0;
  for (const user of toEmail ?? []) {
    const sent = await sendReactivationEmail({
      userId: user.id as string,
      email: user.email as string | null,
    });

    // Stamp even if send failed — we'll fix/retry manually rather than
    // hammering the user on every tick after a transient bounce.
    await supabase
      .from("profiles")
      .update({ reactivation_email_sent_at: new Date().toISOString() })
      .eq("id", user.id);

    if (sent) {
      await logConversionEvent({
        userId: user.id as string,
        eventType: "reactivation_email_sent",
      });
      emailedCount++;
    }
  }

  return NextResponse.json({
    ok: true,
    expired_flipped: expiredCount,
    reactivation_emails_sent: emailedCount,
  });
}

/**
 * Send a reactivation email via Resend. No-op (returns false) if
 * RESEND_API_KEY isn't set so the cron still exercises the expiry flip
 * in dev. Replace the Resend import with your provider if you switch.
 */
async function sendReactivationEmail(params: {
  userId: string;
  email: string | null;
}): Promise<boolean> {
  if (!params.email) return false;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[cron.trial] RESEND_API_KEY not set — skipping email to ${params.email}`
    );
    return false;
  }

  const discountCode = process.env.REACTIVATION_DISCOUNT_CODE || "COMEBACK30";
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://www.usedopl.com";
  const fromAddress = process.env.RESEND_FROM || "Dopl <noreply@usedopl.com>";

  const subject = "Come back to Dopl — 30% off your first month";
  const body =
    `Hey,\n\nYour 24-hour Dopl trial wrapped up 2 days ago.\n\n` +
    `Use code ${discountCode} at checkout for 30% off your first month — ` +
    `just $5.59 to start.\n\n${appUrl}/pricing\n\n— The Dopl team`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [params.email],
        subject,
        text: body,
      }),
    });
    if (!res.ok) {
      console.error(
        `[cron.trial] Resend send failed for ${params.email}: ${res.status}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[cron.trial] Resend send threw for ${params.email}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return false;
  }
}
