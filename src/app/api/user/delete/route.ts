import { NextResponse } from "next/server";
import { withUserAuth } from "@/shared/auth/with-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { getStripe } from "@/features/billing/server/stripe";
import { getProfileBillingRef } from "@/features/billing/server/subscriptions";

export const DELETE = withUserAuth(async (_request, { userId }) => {
  try {
    // sessionOnly (wrapper below) refuses any MCP agent token before this handler runs.
    const user = { id: userId };

    const admin = supabaseAdmin();

    // ⚠ Shared-workspace guard runs BEFORE billing/storage so it bails with no side effects.
    // Cascading a workspace with other active members would vaporize co-members' KBs/skills.
    // ⚠ Two-query manual join: PostgREST `!inner` joins return opaque 500s on this schema since
    // the May 2026 workspace_id denormalization migrations (rationale in attachments.ts).
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

    // ⚠ Stripe cancellation FIRST, and it aborts the delete on failure — otherwise Stripe keeps
    // charging a card whose Supabase row is gone, with no UI left to cancel from.
    // Two sources: legacy per-user subscription (profiles) + per-workspace subs on owned
    // workspaces (all solo, per the guard above).
    const subscriptionIds = new Set<string>();
    const profileRef = await getProfileBillingRef(user.id).catch(() => null);
    if (profileRef?.stripeSubscriptionId) {
      subscriptionIds.add(profileRef.stripeSubscriptionId);
    }
    if (ownedIds.length > 0) {
      const { data: ownedBilling } = await admin
        .from("workspace_billing")
        .select("stripe_subscription_id")
        .in("workspace_id", ownedIds)
        .not("stripe_subscription_id", "is", null);
      for (const row of (ownedBilling ?? []) as Array<{
        stripe_subscription_id: string | null;
      }>) {
        if (row.stripe_subscription_id)
          subscriptionIds.add(row.stripe_subscription_id);
      }
    }
    if (subscriptionIds.size > 0) {
      try {
        const stripe = getStripe();
        for (const subscriptionId of subscriptionIds) {
          await stripe.subscriptions.cancel(subscriptionId);
        }
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

    const { data: thumbFiles } = await admin.storage
      .from("community-thumbnails")
      .list(user.id, { limit: 100 });
    if (thumbFiles && thumbFiles.length > 0) {
      const thumbPaths = thumbFiles.map((f) => `${user.id}/${f.name}`);
      await admin.storage.from("community-thumbnails").remove(thumbPaths);
    }

    // Cascades profiles / user-scoped clusters / user_preferences.
    // mcp_events.user_id + system_events.user_id are SET NULL (analytics retained).
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
}, { sessionOnly: true });
