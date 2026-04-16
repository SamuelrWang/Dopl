import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getUser } from "@/lib/supabase-server";
import { getStripe } from "@/lib/billing/stripe";
import { getUserSubscription } from "@/lib/billing/subscriptions";

export async function DELETE() {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // ── Stripe subscription cancellation (FIRST, aborts on failure) ──
    // If a user deletes their account we MUST stop the recurring billing
    // first — otherwise Stripe keeps charging their card while their
    // Supabase row is gone. We abort the delete if cancellation fails
    // so the user can retry rather than silently losing the ability to
    // cancel their subscription from the UI.
    const sub = await getUserSubscription(user.id).catch(() => null);
    if (sub?.stripe_subscription_id) {
      try {
        const stripe = getStripe();
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } catch (err) {
        console.error(
          `[delete-account] Stripe subscription cancel failed for user ${user.id}:`,
          err
        );
        return NextResponse.json(
          {
            error:
              "We couldn't cancel your Stripe subscription. Please try again in a moment, or contact support if the problem persists.",
          },
          { status: 500 }
        );
      }
    }

    // Clean up chat attachment storage objects before cascade deletes the DB rows.
    // List all files in the user's folder and delete them.
    const { data: userFiles } = await admin.storage
      .from("chat-attachments")
      .list(user.id, { limit: 1000 });

    if (userFiles && userFiles.length > 0) {
      // List files in each subfolder (panel_id level)
      const allPaths: string[] = [];
      for (const item of userFiles) {
        if (item.id === null) {
          // It's a folder — list its contents
          const { data: subFiles } = await admin.storage
            .from("chat-attachments")
            .list(`${user.id}/${item.name}`, { limit: 1000 });
          if (subFiles) {
            for (const f of subFiles) {
              allPaths.push(`${user.id}/${item.name}/${f.name}`);
            }
          }
        } else {
          allPaths.push(`${user.id}/${item.name}`);
        }
      }
      if (allPaths.length > 0) {
        await admin.storage.from("chat-attachments").remove(allPaths);
      }
    }

    // Also clean up community thumbnail storage
    const { data: thumbFiles } = await admin.storage
      .from("community-thumbnails")
      .list(user.id, { limit: 100 });
    if (thumbFiles && thumbFiles.length > 0) {
      const thumbPaths = thumbFiles.map((f) => `${user.id}/${f.name}`);
      await admin.storage.from("community-thumbnails").remove(thumbPaths);
    }

    // Explicit belt-and-suspenders cleanup of tables whose FK cascade
    // behavior isn't visible in the local migration set. If the FK is
    // already CASCADE these are no-ops (rows already gone by the time
    // we get here). If it isn't, this prevents orphaned user data.
    // Best-effort — we proceed with the delete either way.
    await Promise.all([
      admin.from("conversations").delete().eq("user_id", user.id),
      admin.from("published_clusters").delete().eq("user_id", user.id),
    ]).catch(() => {});

    // Delete the auth user — all per-user data cascades automatically:
    // profiles, api_keys, canvas_panels, user-scoped clusters, chat_attachments,
    // user_credits, credit_ledger, user_preferences
    // entries.ingested_by is SET NULL (preserves global entries)
    // mcp_events.user_id / system_events.user_id are SET NULL (analytics retained)
    const { error } = await admin.auth.admin.deleteUser(user.id);

    if (error) {
      console.error("Failed to delete user:", error);
      return NextResponse.json(
        { error: "Failed to delete account" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Account deletion error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
