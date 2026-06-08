import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getUser } from "@/shared/supabase/server";
import { getStripe } from "@/features/billing/server/stripe";
import { getUserSubscription } from "@/features/billing/server/subscriptions";

export async function DELETE() {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = supabaseAdmin();

    // ── Shared-workspace guard (BEFORE billing/storage so we can bail
    // early without side effects). If the caller owns any workspace
    // that still has other active members, refuse the delete. Cascading
    // the workspace away here would vaporize co-members' KBs / skills /
    // clusters / conversations along with it. Force the user to either
    // transfer ownership or remove the other members first.
    //
    // Two-query manual join — PostgREST `!inner` joins have been
    // returning opaque 500s on this schema since the May 2026
    // workspace_id denormalization migrations (see attachments.ts:256
    // for the rationale). Robust regardless of schema-cache state.
    const { data: ownedWorkspaces, error: ownedError } = await admin
      .from("workspaces")
      .select("id, name")
      .eq("owner_id", user.id);
    if (ownedError) {
      console.error(
        `[delete-account] Failed to list owned workspaces for user ${user.id}:`,
        ownedError
      );
      return NextResponse.json(
        { error: "Failed to verify account state — please retry." },
        { status: 500 }
      );
    }
    const ownedIds = (ownedWorkspaces ?? []).map(
      (w) => (w as { id: string }).id
    );
    if (ownedIds.length > 0) {
      const { data: coMembers, error: coMembersError } = await admin
        .from("workspace_members")
        .select("workspace_id")
        .in("workspace_id", ownedIds)
        .neq("user_id", user.id)
        .eq("status", "active");
      if (coMembersError) {
        console.error(
          `[delete-account] Failed to check for co-members for user ${user.id}:`,
          coMembersError
        );
        return NextResponse.json(
          { error: "Failed to verify account state — please retry." },
          { status: 500 }
        );
      }
      const sharedIds = new Set(
        (coMembers ?? []).map((m) => (m as { workspace_id: string }).workspace_id)
      );
      if (sharedIds.size > 0) {
        const names = (ownedWorkspaces ?? [])
          .filter((w) => sharedIds.has((w as { id: string }).id))
          .map((w) => (w as { name: string }).name)
          .filter(Boolean);
        return NextResponse.json(
          {
            error:
              "You still own workspaces with other members: " +
              names.join(", ") +
              ". Transfer ownership or remove the other members before deleting your account.",
            code: "OWNER_HAS_SHARED_WORKSPACES",
            workspaces: names,
          },
          { status: 409 }
        );
      }
    }

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
    ]).catch(() => {});

    // Delete the auth user — all per-user data cascades automatically:
    // profiles, api_keys, canvas_panels, user-scoped clusters, chat_attachments,
    // user_preferences
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
